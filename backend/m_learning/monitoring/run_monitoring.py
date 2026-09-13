"""Weekly drift monitor (Scaling module A4).

Runs per tenant per forecast target, writes one DriftReport row, and flags
alarm tenants so their next forecast carries `stale_model: true` and they are
prioritised in the next retrain.
"""

from __future__ import annotations

import argparse
import logging
import os
import uuid
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import create_engine, text

from m_learning.data.normalizer import TenantNormalizer
from m_learning.monitoring.calibration import classify_coverage, trailing_coverage
from m_learning.monitoring.drift_detector import (
    classify_psi,
    combined_status,
    worst_feature,
)
from m_learning.registry.tiers import FORECAST_TARGETS
from m_learning.storage.feature_store import FeatureStore
from m_learning.storage.forecast_store import ForecastStore

logger = logging.getLogger(__name__)

RECENT_WEEKS = 8
TRAILING_COVERAGE_WEEKS = 12


def _engine():
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return create_engine(url.replace("postgresql://", "postgresql+psycopg2://"))


def elapsed_forecasts(record: dict, frame: pd.DataFrame, target: str) -> tuple[list, dict]:
    """Forecast weeks that have since happened, paired with what actually did.

    A forecast can only be scored once its week is in the past — this is the
    rolling-window self-labelling from the TFT spec, reused for monitoring.
    """
    column = FORECAST_TARGETS[target].source_feature
    if column not in frame.columns:
        return [], {}

    actuals = {
        pd.Timestamp(idx).date().isoformat(): float(value)
        for idx, value in zip(frame.index, frame[column].to_numpy())
    }

    quantiles = record.get("quantiles", {})
    weeks = record.get("weeks", [])
    forecasts = []
    for i, week in enumerate(weeks):
        if week not in actuals:
            continue
        try:
            forecasts.append(
                {
                    "week": week,
                    "p10": quantiles["0.1"][i],
                    "p50": quantiles["0.5"][i],
                    "p90": quantiles["0.9"][i],
                }
            )
        except (KeyError, IndexError):
            continue

    return forecasts, actuals


def monitor_tenant_target(
    tenant_id: str,
    target: str,
    features: FeatureStore,
    forecasts: ForecastStore,
) -> dict | None:
    frame = features.read(tenant_id)
    if frame.empty:
        return None

    record = forecasts.read(tenant_id, target)
    normalised = TenantNormalizer().fit(frame, frame.index[-1]).transform(frame)

    # --- signal 1: calibration ---
    coverage_value = None
    if record:
        elapsed, actuals = elapsed_forecasts(record, normalised, target)
        coverage_value = trailing_coverage(elapsed, actuals, TRAILING_COVERAGE_WEEKS)
    coverage_status = classify_coverage(coverage_value)

    # --- signal 2: distribution shift ---
    train_slice = normalised.iloc[:-RECENT_WEEKS] if len(normalised) > RECENT_WEEKS else normalised
    recent_slice = normalised.tail(RECENT_WEEKS)
    feature_name, psi_value = worst_feature(train_slice, recent_slice)
    psi_status = classify_psi(psi_value)

    return {
        "tenant_id": tenant_id,
        "target": target,
        "week": pd.Timestamp(frame.index[-1]).date().isoformat(),
        "coverage_12w": coverage_value,
        "worst_psi_feature": feature_name,
        "worst_psi_value": psi_value,
        "status": combined_status(coverage_status, psi_status),
    }


def persist(engine, report: dict) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                'INSERT INTO "DriftReport" (id, "userId", week, target, "coverage12w", '
                '"worstPsiFeature", "worstPsiValue", status) '
                "VALUES (:id, :tenant, :week, :target, :coverage, :feature, :psi, :status) "
                'ON CONFLICT ("userId", week, target) DO UPDATE SET '
                '"coverage12w"=EXCLUDED."coverage12w", '
                '"worstPsiFeature"=EXCLUDED."worstPsiFeature", '
                '"worstPsiValue"=EXCLUDED."worstPsiValue", status=EXCLUDED.status'
            ),
            {
                "id": str(uuid.uuid4()),
                "tenant": report["tenant_id"],
                "week": report["week"],
                "target": report["target"],
                "coverage": report["coverage_12w"],
                "feature": report["worst_psi_feature"],
                "psi": report["worst_psi_value"],
                "status": report["status"],
            },
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Weekly drift monitor")
    parser.add_argument("--tenants", nargs="*", default=None)
    parser.add_argument("--targets", nargs="*", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    features = FeatureStore()
    forecasts = ForecastStore()
    engine = None if args.dry_run else _engine()

    tenants = args.tenants or features.list_tenants()
    targets = args.targets or list(FORECAST_TARGETS)

    alarms = 0
    for tenant_id in tenants:
        for target in targets:
            report = monitor_tenant_target(tenant_id, target, features, forecasts)
            if report is None:
                continue

            coverage_text = (
                f"{report['coverage_12w']:.2f}" if report["coverage_12w"] is not None else "n/a"
            )
            psi_text = (
                f"{report['worst_psi_feature']}={report['worst_psi_value']:.3f}"
                if report["worst_psi_value"] is not None
                else "too few weeks"
            )
            print(
                f"{tenant_id[:12]} {target:<18} status={report['status']:<18} "
                f"coverage={coverage_text} worst_psi={psi_text}"
            )

            if report["status"] == "alarm":
                alarms += 1
            if engine is not None:
                persist(engine, report)

    print(f"\n{alarms} alarm(s) — these tenants are prioritised in the next retrain.")


if __name__ == "__main__":
    main()

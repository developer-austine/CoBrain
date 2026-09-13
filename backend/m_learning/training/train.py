"""CLI entrypoint: python -m m_learning.training.train --target delivery_velocity"""

from __future__ import annotations

import argparse
import logging

from m_learning.config import CFG
from m_learning.data.dataset import TenantSeries
from m_learning.data.normalizer import TenantNormalizer
from m_learning.models.tft import CoBrainTFT
from m_learning.registry.covariates import VOCAB_SIZES, TenantProfile
from m_learning.registry.tiers import FORECAST_TARGETS, N_FEATURES
from m_learning.storage.feature_store import FeatureStore
from m_learning.training.trainer import Trainer


def load_series(store: FeatureStore, tenant_ids: list[str] | None) -> list[TenantSeries]:
    series = []
    for tenant_id in tenant_ids or store.list_tenants():
        frame = store.read(tenant_id)
        if frame.empty:
            continue

        meta = store.read_meta(tenant_id)
        # Rule 6: statistics come from the training window only. The holdout is
        # the last HORIZON weeks, so the fit ends before it starts.
        train_end = frame.index[max(len(frame) - CFG.HORIZON, 1) - 1]
        normalised = TenantNormalizer().fit(frame, train_end).transform(frame)

        series.append(
            TenantSeries(
                tenant_id=tenant_id,
                frame=normalised,
                profile=TenantProfile(
                    tenant_id=tenant_id,
                    industry=meta.get("industry", "unknown"),
                    country=meta.get("country", "unknown"),
                    size_band=meta.get("size_band", "unknown"),
                    currency=meta.get("currency", "unknown"),
                ),
            )
        )
    return series


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the CoBrain TFT")
    parser.add_argument("--target", default="delivery_velocity", choices=sorted(FORECAST_TARGETS))
    parser.add_argument("--tenants", nargs="*", default=None)
    parser.add_argument("--epochs", type=int, default=CFG.MAX_EPOCHS)
    parser.add_argument("--holdout-weeks", type=int, default=CFG.HORIZON)
    parser.add_argument("--device", default=None)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    series = load_series(FeatureStore(), args.tenants)
    if not series:
        raise SystemExit("No tenant features found — run scripts/build_features.py first")

    print(f"Training on {len(series)} tenant(s), target={args.target}")

    model = CoBrainTFT(N_FEATURES, VOCAB_SIZES)
    trainer = Trainer(model, device=args.device)
    history = trainer.fit(
        series, target=args.target, holdout_weeks=args.holdout_weeks, max_epochs=args.epochs
    )

    best = min(history, key=lambda r: r.val_loss)
    print(f"Best epoch {best.epoch}: val={best.val_loss:.4f} per_quantile={best.per_quantile}")


if __name__ == "__main__":
    main()

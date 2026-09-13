"""Batch feature build for all tenants."""

from __future__ import annotations

import argparse
import logging

from m_learning.data.event_loader import load_events, load_tenant_ids
from m_learning.data.external_signals import attach_geo_features
from m_learning.data.feature_builder import build_weekly_features
from m_learning.storage.feature_store import FeatureStore

logger = logging.getLogger(__name__)


def build_for_tenant(tenant_id: str, store: FeatureStore, country: str = "unknown") -> int:
    events = load_events(tenant_id)
    if events.empty:
        return 0

    frame = build_weekly_features(events, tenant_id)
    if frame.empty:
        return 0

    if country and country != "unknown":
        frame = attach_geo_features(frame, country)

    store.write(tenant_id, frame)
    return len(frame)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build weekly features for every tenant")
    parser.add_argument("--tenants", nargs="*", default=None)
    parser.add_argument("--country", default="unknown")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    store = FeatureStore()

    for tenant_id in args.tenants or load_tenant_ids():
        weeks = build_for_tenant(tenant_id, store, args.country)
        print(f"{tenant_id}: {weeks} weeks")


if __name__ == "__main__":
    main()

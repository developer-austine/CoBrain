"""Historical feature backfill."""

from __future__ import annotations

import argparse
import logging
from datetime import datetime, timedelta, timezone

from m_learning.data.event_loader import load_events, load_tenant_ids
from m_learning.data.feature_builder import build_weekly_features
from m_learning.storage.feature_store import FeatureStore


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill weekly features from history")
    parser.add_argument("--weeks", type=int, default=104)
    parser.add_argument("--tenants", nargs="*", default=None)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    since = datetime.now(timezone.utc) - timedelta(weeks=args.weeks)
    store = FeatureStore()

    for tenant_id in args.tenants or load_tenant_ids():
        events = load_events(tenant_id, since=since)
        if events.empty:
            print(f"{tenant_id}: no events")
            continue

        frame = build_weekly_features(events, tenant_id)
        store.write(tenant_id, frame)
        print(f"{tenant_id}: {len(frame)} weeks from {since.date()}")


if __name__ == "__main__":
    main()

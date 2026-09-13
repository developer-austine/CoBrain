"""Namespaced forecast persistence (FIX 4)."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from m_learning.config import CFG
from m_learning.storage.feature_store import TenantIsolationError, _validate


def namespace_for(tenant_id: str) -> str:
    return CFG.FORECAST_NAMESPACE.format(tenant_id=_validate(tenant_id))


class ForecastStore:
    def __init__(self, root: str | os.PathLike[str] | None = None):
        self.root = Path(root or os.getenv("FORECAST_STORE_ROOT", "m_learning/.forecast_store"))

    def _dir(self, tenant_id: str) -> Path:
        path = self.root / namespace_for(tenant_id).replace(":", "__")
        path.mkdir(parents=True, exist_ok=True)
        return path

    def write(self, tenant_id: str, target: str, forecast: dict) -> Path:
        _validate(tenant_id)
        if forecast.get("tenant_id", tenant_id) != tenant_id:
            raise TenantIsolationError(
                f"Forecast for {forecast.get('tenant_id')!r} cannot be written under {tenant_id!r}"
            )

        record = {
            **forecast,
            "tenant_id": tenant_id,
            "target": target,
            "written_at": datetime.now(timezone.utc).isoformat(),
        }
        path = self._dir(tenant_id) / f"{target}.json"
        path.write_text(json.dumps(record, indent=2), encoding="utf-8")
        return path

    def read(self, tenant_id: str, target: str) -> dict | None:
        _validate(tenant_id)
        path = self._dir(tenant_id) / f"{target}.json"
        if not path.exists():
            return None

        record = json.loads(path.read_text(encoding="utf-8"))
        if record.get("tenant_id") != tenant_id:
            raise TenantIsolationError(
                f"Stored forecast belongs to {record.get('tenant_id')!r}, not {tenant_id!r}"
            )
        return record

    def list_targets(self, tenant_id: str) -> list[str]:
        return sorted(p.stem for p in self._dir(_validate(tenant_id)).glob("*.json"))

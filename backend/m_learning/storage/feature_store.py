"""Namespaced feature read/write (FIX 4).

Every accessor REQUIRES a tenant_id. There is no code path that reads or writes
features without one, and a namespace mismatch raises rather than returning
another tenant's rows.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

import pandas as pd

from m_learning.config import CFG


class TenantIsolationError(RuntimeError):
    """Raised when an access would cross a tenant boundary."""


_TENANT_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


def _validate(tenant_id: str) -> str:
    if not isinstance(tenant_id, str) or not _TENANT_RE.match(tenant_id):
        raise TenantIsolationError(f"Invalid tenant_id: {tenant_id!r}")
    return tenant_id


def namespace_for(tenant_id: str) -> str:
    return CFG.FEATURE_NAMESPACE.format(tenant_id=_validate(tenant_id))


class FeatureStore:
    """Parquet-backed feature store, one directory per tenant namespace."""

    def __init__(self, root: str | os.PathLike[str] | None = None):
        self.root = Path(root or os.getenv("FEATURE_STORE_ROOT", "m_learning/.feature_store"))

    def _dir(self, tenant_id: str) -> Path:
        path = self.root / namespace_for(tenant_id).replace(":", "__")
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _frame_path(self, tenant_id: str) -> Path:
        return self._dir(tenant_id) / "features.parquet"

    def _meta_path(self, tenant_id: str) -> Path:
        return self._dir(tenant_id) / "meta.json"

    def write(self, tenant_id: str, df: pd.DataFrame) -> Path:
        _validate(tenant_id)

        # A frame carrying another tenant's rows must never be written under
        # this namespace, whatever the caller intended.
        if "tenant_id" in df.columns:
            foreign = set(df["tenant_id"].dropna().unique()) - {tenant_id}
            if foreign:
                raise TenantIsolationError(
                    f"Frame for {tenant_id!r} contains rows for {sorted(foreign)!r}"
                )

        out = df.copy()
        out["tenant_id"] = tenant_id
        path = self._frame_path(tenant_id)
        out.to_parquet(path)
        return path

    def read(self, tenant_id: str) -> pd.DataFrame:
        _validate(tenant_id)
        path = self._frame_path(tenant_id)
        if not path.exists():
            return pd.DataFrame()

        df = pd.read_parquet(path)
        if "tenant_id" in df.columns:
            foreign = set(df["tenant_id"].dropna().unique()) - {tenant_id}
            if foreign:
                raise TenantIsolationError(
                    f"Stored frame under {tenant_id!r} contains rows for {sorted(foreign)!r}"
                )
        return df

    def exists(self, tenant_id: str) -> bool:
        return self._frame_path(_validate(tenant_id)).exists()

    def write_meta(self, tenant_id: str, meta: dict) -> None:
        _validate(tenant_id)
        self._meta_path(tenant_id).write_text(json.dumps(meta, indent=2), encoding="utf-8")

    def read_meta(self, tenant_id: str) -> dict:
        _validate(tenant_id)
        path = self._meta_path(tenant_id)
        if not path.exists():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))

    def list_tenants(self) -> list[str]:
        if not self.root.exists():
            return []
        suffix = CFG.FEATURE_NAMESPACE.format(tenant_id="").replace(":", "__")
        out = []
        for child in self.root.iterdir():
            if child.is_dir() and child.name.endswith(suffix):
                out.append(child.name[: -len(suffix)])
        return sorted(out)

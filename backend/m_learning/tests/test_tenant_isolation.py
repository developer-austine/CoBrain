import pandas as pd
import pytest

from m_learning.storage.feature_store import FeatureStore, TenantIsolationError
from m_learning.storage.forecast_store import ForecastStore


@pytest.fixture
def store(tmp_path):
    return FeatureStore(root=tmp_path)


def frame(tenant_id: str) -> pd.DataFrame:
    index = pd.date_range("2026-01-05", periods=4, freq="W-MON")
    return pd.DataFrame({"n_commits": [1, 2, 3, 4], "tenant_id": tenant_id}, index=index)


def test_a_tenant_only_ever_reads_its_own_features(store):
    store.write("tenant-a", frame("tenant-a"))
    store.write("tenant-b", frame("tenant-b"))

    assert set(store.read("tenant-a")["tenant_id"].unique()) == {"tenant-a"}
    assert set(store.read("tenant-b")["tenant_id"].unique()) == {"tenant-b"}


def test_writing_another_tenants_rows_raises(store):
    with pytest.raises(TenantIsolationError):
        store.write("tenant-a", frame("tenant-b"))


def test_a_cross_tenant_read_raises(store, tmp_path):
    # Simulate a store corrupted by a write that bypassed the accessor.
    store.write("tenant-a", frame("tenant-a"))
    path = store._frame_path("tenant-a")
    poisoned = pd.read_parquet(path)
    poisoned["tenant_id"] = "tenant-b"
    poisoned.to_parquet(path)

    with pytest.raises(TenantIsolationError):
        store.read("tenant-a")


def test_missing_tenant_reads_empty_not_someone_elses(store):
    store.write("tenant-a", frame("tenant-a"))
    assert store.read("tenant-c").empty


@pytest.mark.parametrize("bad", ["", "../escape", "a/b", "tenant with space", "x" * 200])
def test_malformed_tenant_ids_are_rejected(store, bad):
    with pytest.raises(TenantIsolationError):
        store.read(bad)


def test_namespaces_do_not_collide(store):
    store.write("tenant-a", frame("tenant-a"))
    store.write("tenant-ab", frame("tenant-ab"))

    assert len(store.read("tenant-a")) == 4
    assert set(store.read("tenant-ab")["tenant_id"].unique()) == {"tenant-ab"}
    assert sorted(store.list_tenants()) == ["tenant-a", "tenant-ab"]


def test_forecasts_are_namespaced(tmp_path):
    store = ForecastStore(root=tmp_path)
    store.write("tenant-a", "burnout_risk", {"quantiles": {"0.5": [1.0]}})

    assert store.read("tenant-a", "burnout_risk")["quantiles"] == {"0.5": [1.0]}
    assert store.read("tenant-b", "burnout_risk") is None


def test_forecast_for_another_tenant_cannot_be_written(tmp_path):
    store = ForecastStore(root=tmp_path)
    with pytest.raises(TenantIsolationError):
        store.write("tenant-a", "burnout_risk", {"tenant_id": "tenant-b", "quantiles": {}})

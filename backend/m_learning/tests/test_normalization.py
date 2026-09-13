import numpy as np
import pandas as pd
import pytest

from m_learning.data.normalizer import TenantNormalizer


def frame(values: dict, weeks: int = 20) -> pd.DataFrame:
    index = pd.date_range("2026-01-05", periods=weeks, freq="W-MON")
    return pd.DataFrame(values, index=index)


def test_counts_are_log_transformed_before_scaling():
    # Rule 2: one release week 10x normal must not dominate the scale.
    df = frame({"n_commits": [10] * 19 + [10_000]})
    norm = TenantNormalizer().fit(df, df.index[-1])
    out = norm.transform(df)

    assert out["n_commits"].max() < 15


def test_z_score_is_fitted_per_tenant_not_globally():
    # Rule 1: a 10-person startup and a 500-person company must normalise to
    # comparable dynamics, not to their absolute size.
    #
    # Not bit-identical: log1p's +1 offset matters at single digits and is
    # negligible in the hundreds, so the same ratios land a few hundredths
    # apart. What must hold is that scale is gone and shape is preserved.
    small = frame({"n_commits": [5, 6, 4, 5, 7] * 4})
    large = frame({"n_commits": [500, 600, 400, 500, 700] * 4})

    small_out = TenantNormalizer().fit(small, small.index[-1]).transform(small)["n_commits"]
    large_out = TenantNormalizer().fit(large, large.index[-1]).transform(large)["n_commits"]

    np.testing.assert_allclose(small_out.to_numpy(), large_out.to_numpy(), atol=0.05)
    assert np.corrcoef(small_out, large_out)[0, 1] > 0.999

    # Both are centred and unit-scaled, so neither tenant's magnitude survives.
    for series in (small_out, large_out):
        assert abs(float(series.mean())) < 1e-6
        assert float(series.std()) == pytest.approx(1.0, abs=0.05)


def test_statistics_use_the_training_window_only():
    # Rule 6: including future weeks leaks the future into the past.
    df = frame({"n_commits": [10] * 10 + [1_000] * 10})
    train_end = df.index[9]

    norm = TenantNormalizer().fit(df, train_end)
    mu, _ = norm.stats["n_commits"]

    assert mu == pytest.approx(float(np.log1p(10)), abs=1e-6)


def test_calendar_is_encoded_cyclically_as_a_pair():
    # Rule 3: week 52 and week 1 must be adjacent.
    df = frame({"n_commits": [1] * 60}, weeks=60)
    out = TenantNormalizer().fit(df, df.index[-1]).transform(df)

    assert {"week_sin", "week_cos"} <= set(out.columns)
    assert out["week_sin"].between(-1, 1).all()
    assert out["week_cos"].between(-1, 1).all()

    radius = out["week_sin"] ** 2 + out["week_cos"] ** 2
    np.testing.assert_allclose(radius.to_numpy(), 1.0, atol=1e-6)


def test_week_52_and_week_1_are_adjacent_in_the_encoding():
    index = pd.DatetimeIndex(["2026-12-21", "2026-12-28"])
    df = pd.DataFrame({"n_commits": [1, 1]}, index=index)
    out = TenantNormalizer().fit(df, index[-1]).transform(df)

    points = out[["week_sin", "week_cos"]].to_numpy()
    distance = float(np.linalg.norm(points[0] - points[1]))
    assert distance < 0.5


def test_observed_mask_is_not_rescaled():
    df = frame({"n_commits": [10] * 20, "observed": [1] * 19 + [0]})
    out = TenantNormalizer().fit(df, df.index[-1]).transform(df)

    assert set(out["observed"].unique()) <= {0, 1}


def test_state_round_trips():
    df = frame({"n_commits": [1, 2, 3, 4, 5] * 4})
    norm = TenantNormalizer().fit(df, df.index[-1])
    restored = TenantNormalizer().load_state_dict(norm.state_dict())

    pd.testing.assert_frame_equal(norm.transform(df), restored.transform(df))

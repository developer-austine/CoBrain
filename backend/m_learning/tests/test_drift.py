import numpy as np
import pandas as pd
import pytest

from m_learning.monitoring.calibration import (
    classify_coverage,
    coverage,
    trailing_coverage,
)
from m_learning.monitoring.drift_detector import (
    classify_psi,
    combined_status,
    psi,
    worst_feature,
)


def band(week, p10, p50, p90):
    return {"week": week, "p10": p10, "p50": p50, "p90": p90}


class TestCalibration:
    def test_perfect_coverage(self):
        forecasts = [band(f"w{i}", -1, 0, 1) for i in range(10)]
        actuals = {f"w{i}": 0.0 for i in range(10)}
        assert coverage(forecasts, actuals) == 1.0

    def test_zero_coverage(self):
        forecasts = [band(f"w{i}", -1, 0, 1) for i in range(10)]
        actuals = {f"w{i}": 5.0 for i in range(10)}
        assert coverage(forecasts, actuals) == 0.0

    def test_exact_fraction(self):
        forecasts = [band(f"w{i}", -1, 0, 1) for i in range(10)]
        actuals = {f"w{i}": (0.0 if i < 8 else 9.0) for i in range(10)}
        assert coverage(forecasts, actuals) == pytest.approx(0.8)

    def test_band_edges_count_as_inside(self):
        assert coverage([band("w", -1, 0, 1)], {"w": 1.0}) == 1.0
        assert coverage([band("w", -1, 0, 1)], {"w": -1.0}) == 1.0

    def test_weeks_with_no_actual_are_not_scored(self):
        forecasts = [band("w1", -1, 0, 1), band("w2", -1, 0, 1)]
        assert coverage(forecasts, {"w1": 0.0}) == 1.0
        assert coverage(forecasts, {}) is None

    def test_both_directions_are_drift(self):
        # A model that widens its bands until it is never wrong has stopped
        # forecasting, so over-coverage alarms just like under-coverage.
        assert classify_coverage(0.80) == "ok"
        assert classify_coverage(0.60) == "alarm"
        assert classify_coverage(0.98) == "alarm"
        assert classify_coverage(0.70) == "drifting"
        assert classify_coverage(None) == "ok"

    def test_trailing_window_reflects_recent_breakage(self):
        # Well calibrated for a year, broken last quarter: the trailing read
        # must show broken, not the flattering lifetime average.
        good = [band(f"2026-01-{i:02d}", -1, 0, 1) for i in range(1, 25)]
        bad = [band(f"2026-02-{i:02d}", -1, 0, 1) for i in range(1, 13)]
        actuals = {f["week"]: 0.0 for f in good}
        actuals.update({f["week"]: 9.0 for f in bad})

        assert trailing_coverage(good + bad, actuals, weeks=12) == 0.0
        assert coverage(good + bad, actuals) == pytest.approx(24 / 36)


class TestPsi:
    def test_identical_samples_are_stable(self):
        rng = np.random.default_rng(0)
        sample = rng.normal(0, 1, 1000)
        assert psi(sample, sample) < 0.01
        assert classify_psi(psi(sample, sample)) == "ok"

    def test_shifted_distribution_alarms(self):
        rng = np.random.default_rng(0)
        train = rng.normal(0, 1, 1000)
        shifted = rng.normal(3, 1, 1000)

        value = psi(train, shifted)
        assert value > 0.25
        assert classify_psi(value) == "alarm"

    def test_a_small_shift_reads_as_drifting_not_alarm(self):
        rng = np.random.default_rng(1)
        train = rng.normal(0, 1, 5000)
        nudged = rng.normal(0.35, 1, 5000)

        assert classify_psi(psi(train, nudged)) in {"drifting", "alarm"}

    def test_psi_is_non_negative(self):
        rng = np.random.default_rng(2)
        for _ in range(5):
            a, b = rng.normal(0, 1, 500), rng.normal(0, 2, 500)
            assert psi(a, b) >= 0


class TestWorstFeature:
    def frame(self, **columns):
        return pd.DataFrame(columns)

    def test_identifies_the_feature_that_moved(self):
        rng = np.random.default_rng(0)
        train = self.frame(
            stable=rng.normal(0, 1, 500),
            moved=rng.normal(0, 1, 500),
        )
        recent = self.frame(
            stable=rng.normal(0, 1, 200),
            moved=rng.normal(4, 1, 200),
        )

        name, value = worst_feature(train, recent)
        assert name == "moved"
        assert value > 0.25

    def test_constant_features_are_skipped(self):
        # A flat column has no distribution to shift; quantile edges would
        # collapse and report a meaningless number.
        train = self.frame(flat=np.zeros(100), real=np.random.default_rng(0).normal(0, 1, 100))
        recent = self.frame(flat=np.zeros(50), real=np.random.default_rng(1).normal(0, 1, 50))

        name, _ = worst_feature(train, recent)
        assert name != "flat"

    def test_columns_absent_from_training_are_ignored(self):
        train = self.frame(a=np.random.default_rng(0).normal(0, 1, 100))
        recent = self.frame(a=np.random.default_rng(1).normal(0, 1, 50), b=np.ones(50))

        name, _ = worst_feature(train, recent)
        assert name in {None, "a"}


class TestCombinedStatus:
    def test_the_worse_signal_wins(self):
        assert combined_status("ok", "ok") == "ok"
        assert combined_status("ok", "alarm") == "alarm"
        assert combined_status("alarm", "ok") == "alarm"
        assert combined_status("drifting", "ok") == "drifting"
        assert combined_status("drifting", "alarm") == "alarm"

    def test_a_broken_model_alarms_even_when_inputs_look_familiar(self):
        # Requiring both signals would let a measurably wrong model pass
        # because its inputs happen to be in-distribution.
        assert combined_status("alarm", "ok") == "alarm"


class TestSmallSampleGuard:
    def test_a_young_tenant_does_not_alarm_against_its_own_data(self):
        # 10 weeks of history split into train/recent scored PSI ~13 against
        # itself purely from empty bins, which alarmed every small tenant.
        from m_learning.monitoring.drift_detector import psi, psi_or_none

        rng = np.random.default_rng(0)
        train = rng.normal(0, 1, 4)
        recent = rng.normal(0, 1, 8)

        assert psi(train, recent) > PSI_ALARM_FOR_TEST
        assert psi_or_none(train, recent) is None
        assert classify_psi(psi_or_none(train, recent)) == "insufficient_data"

    def test_enough_samples_still_measure_normally(self):
        from m_learning.monitoring.drift_detector import psi_or_none

        rng = np.random.default_rng(0)
        train, recent = rng.normal(0, 1, 500), rng.normal(3, 1, 500)

        value = psi_or_none(train, recent)
        assert value is not None and value > 0.25

    def test_bin_count_shrinks_to_what_the_sample_supports(self):
        from m_learning.monitoring.drift_detector import usable_bins

        assert usable_bins(4, 8) == 0        # too few either way
        assert usable_bins(100, 20) == 4     # limited by the smaller side
        assert usable_bins(1000, 1000) == 10 # capped at the preferred count

    def test_insufficient_data_never_outranks_a_real_reading(self):
        # Absence of evidence must not mask a genuinely broken model.
        assert combined_status("alarm", "insufficient_data") == "alarm"
        assert combined_status("ok", "insufficient_data") == "ok"
        assert combined_status("insufficient_data", "insufficient_data") == "insufficient_data"


PSI_ALARM_FOR_TEST = 0.25

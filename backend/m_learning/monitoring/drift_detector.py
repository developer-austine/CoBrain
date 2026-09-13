"""Feature distribution shift — has the input world moved? (A4, signal 2)

PSI compares a feature's recent distribution against the one the model was
trained on. It answers a different question from calibration: calibration says
the model is wrong, PSI says the world changed. A team that doubled in size
shifts every count feature long before the forecasts visibly rot.
"""

from __future__ import annotations

import numpy as np

PSI_STABLE = 0.10
PSI_ALARM = 0.25

# PSI compares bin proportions, so it needs enough samples per bin to be
# measuring anything. Below this the empty bins dominate: a young tenant with
# ten weeks of history scored PSI ~13 against its own data purely from sparsity,
# which would alarm every small tenant forever and teach the team to ignore
# alarms. At least five observations per bin, per side.
MIN_SAMPLES_PER_BIN = 5


def psi(train_vals, recent_vals, bins=10):
    """Population Stability Index between two samples of one feature."""
    edges = np.quantile(train_vals, np.linspace(0, 1, bins + 1))
    edges[0], edges[-1] = -np.inf, np.inf
    t_hist, _ = np.histogram(train_vals, bins=edges)
    r_hist, _ = np.histogram(recent_vals, bins=edges)
    t_pct = np.clip(t_hist / max(t_hist.sum(), 1), 1e-6, None)
    r_pct = np.clip(r_hist / max(r_hist.sum(), 1), 1e-6, None)
    return float(((r_pct - t_pct) * np.log(r_pct / t_pct)).sum())


def usable_bins(n_train: int, n_recent: int, preferred: int = 10) -> int:
    """Bin count the smaller sample can actually support, or 0 if neither can."""
    smaller = min(n_train, n_recent)
    affordable = smaller // MIN_SAMPLES_PER_BIN
    if affordable < 2:
        return 0
    return min(preferred, affordable)


def psi_or_none(train_vals, recent_vals, bins=10) -> float | None:
    """PSI, or None when the samples are too small for the number to mean anything."""
    train_vals = np.asarray(train_vals, dtype=float)
    recent_vals = np.asarray(recent_vals, dtype=float)

    usable = usable_bins(len(train_vals), len(recent_vals), bins)
    if usable == 0:
        return None
    return psi(train_vals, recent_vals, bins=usable)


def classify_psi(value: float | None) -> str:
    # Not enough data is not drift. Reporting it as one manufactures alarms for
    # exactly the tenants whose forecasts are already flagged low-confidence.
    if value is None:
        return "insufficient_data"
    if value > PSI_ALARM:
        return "alarm"
    if value > PSI_STABLE:
        return "drifting"
    return "ok"


def worst_feature(train_df, recent_df, features=None) -> tuple[str | None, float | None]:
    """The single feature that moved most, and by how much.

    One number per tenant per week keeps the report readable; the feature name
    is what makes it actionable. Returns (None, None) when no feature has
    enough data for PSI to mean anything.
    """
    columns = features or [
        c for c in recent_df.columns if recent_df[c].dtype.kind in "fiu"
    ]

    worst_name: str | None = None
    worst_value: float | None = None
    for column in columns:
        if column not in train_df.columns:
            continue

        train_vals = np.asarray(train_df[column].dropna(), dtype=float)
        recent_vals = np.asarray(recent_df[column].dropna(), dtype=float)

        # A constant feature has no distribution to shift, and quantile edges
        # would collapse to a single bin and report a meaningless number.
        if len(train_vals) < 2 or len(recent_vals) < 1:
            continue
        if float(np.nanstd(train_vals)) < 1e-9:
            continue

        value = psi_or_none(train_vals, recent_vals)
        if value is None:
            continue
        if worst_value is None or value > worst_value:
            worst_name, worst_value = column, value

    return worst_name, worst_value


def combined_status(coverage_status: str, psi_status: str) -> str:
    """The worse of the two signals wins.

    Either signal alone is enough to justify a retrain; requiring both would
    mean ignoring a model that is measurably wrong because the inputs happen to
    look familiar. "insufficient_data" ranks below "ok": it is an absence of
    evidence, and must never outrank a real reading from the other signal.
    """
    order = {"insufficient_data": -1, "ok": 0, "drifting": 1, "alarm": 2}
    inverse = {v: k for k, v in order.items()}
    worst = max(order[coverage_status], order[psi_status])
    return inverse[worst]

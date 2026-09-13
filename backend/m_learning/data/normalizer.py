import numpy as np
import pandas as pd

COUNT_COLS = ["n_commits", "n_prs_opened", "n_prs_merged", "n_messages",
              "n_docs_created", "n_docs_edited", "n_tasks_assigned",
              "n_tasks_completed", "n_decisions", "n_active_actors"]

PASSTHROUGH = {"observed", "tenant_id"}


def _non_negative(series: pd.Series) -> pd.Series:
    """Counts are non-negative by definition.

    log1p of a negative is NaN, and the fillna at the end of transform() would
    turn that into a silent 0.0 — the model would train on fabricated zeros with
    no error anywhere. Clipping cannot alter a valid count and makes the corrupt
    case impossible.
    """
    return series.fillna(0).clip(lower=0)


class TenantNormalizer:
    """Per-tenant. Fit on the TRAINING WINDOW ONLY (Rule 6)."""

    def __init__(self):
        self.stats: dict[str, tuple[float, float]] = {}

    def fit(self, df: pd.DataFrame, train_end):
        train = df.loc[:train_end].copy()
        for c in COUNT_COLS:
            if c in train:
                train[c] = np.log1p(_non_negative(train[c]))
        for c in train.select_dtypes("number").columns:
            if c in PASSTHROUGH:
                continue
            self.stats[c] = (float(train[c].mean()), float(train[c].std()))
        return self

    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        for c in COUNT_COLS:
            if c in out:
                out[c] = np.log1p(_non_negative(out[c]))
        for c, (mu, sd) in self.stats.items():
            if c in out:
                out[c] = (out[c] - mu) / (sd + 1e-6)

        # cyclical calendar (Rule 3)
        w = pd.DatetimeIndex(out.index).isocalendar().week.values.astype(float)
        out["week_sin"] = np.sin(2 * np.pi * w / 52.0)
        out["week_cos"] = np.cos(2 * np.pi * w / 52.0)

        num = out.select_dtypes("number").columns
        out[num] = out[num].fillna(0.0)
        return out

    def state_dict(self) -> dict:
        return {"stats": {k: list(v) for k, v in self.stats.items()}}

    def load_state_dict(self, state: dict) -> "TenantNormalizer":
        self.stats = {k: (float(v[0]), float(v[1])) for k, v in state.get("stats", {}).items()}
        return self

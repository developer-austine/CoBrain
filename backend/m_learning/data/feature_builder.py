import numpy as np
import pandas as pd
from m_learning.config import CFG

COUNT_KINDS = {
    "commit": "n_commits",
    "pr_opened": "n_prs_opened",
    "pr_merged": "n_prs_merged",
    "message": "n_messages",
    "doc_created": "n_docs_created",
    "doc_edited": "n_docs_edited",
    "task_assigned": "n_tasks_assigned",
    "task_completed": "n_tasks_completed",
    "decision": "n_decisions",
}


def _safe_div(a, b):
    return float(a) / b if b else 0.0


def build_weekly_features(events: pd.DataFrame, tenant_id: str) -> pd.DataFrame:
    """
    events: DataFrame with columns [ts (datetime64), actor (str),
            kind (str), meta (dict)]
    returns: one row per week on a COMPLETE weekly grid, with an `observed` mask.
    """
    ev = events.copy()
    ev["ts"] = pd.to_datetime(ev["ts"], utc=True)
    ev["week"] = ev["ts"].dt.to_period("W").dt.start_time
    hour = ev["ts"].dt.hour
    ev["after_hours"] = (hour < 9) | (hour >= 18)
    ev["weekend"] = ev["ts"].dt.dayofweek >= 5

    rows = []
    for week, g in ev.groupby("week"):
        n = len(g)
        row = {"week": week, "observed": 1}

        # --- Family 1: counts ---
        for kind, col in COUNT_KINDS.items():
            row[col] = int((g["kind"] == kind).sum())

        # --- Family 2: ratios ---
        row["after_hours_ratio"] = float(g["after_hours"].mean()) if n else 0.0
        row["weekend_ratio"]     = float(g["weekend"].mean()) if n else 0.0
        row["merge_rate"]        = _safe_div(row["n_prs_merged"],
                                             row["n_prs_opened"])
        row["completion_ratio"]  = _safe_div(row["n_tasks_completed"],
                                             row["n_tasks_assigned"])
        row["reopen_rate"]       = _safe_div(int((g["kind"] == "task_reopened").sum()),
                                             row["n_tasks_completed"])

        # --- Family 3: latencies (meta carries precomputed deltas in seconds) ---
        row["median_review_delay"]   = _median_meta(g, "review_delay_s")
        row["median_cycle_time"]     = _median_meta(g, "cycle_time_s")
        row["median_response_delay"] = _median_meta(g, "response_delay_s")
        row["oldest_open_task_age"]  = _max_meta(g, "open_task_age_s")

        # --- Family 4: dispersion ---
        shares = g["actor"].value_counts(normalize=True).values
        row["actor_entropy"]   = float(-(shares * np.log(shares + 1e-9)).sum())
        row["top_actor_share"] = float(shares.max()) if len(shares) else 0.0
        row["n_active_actors"] = int(g["actor"].nunique())

        rows.append(row)

    if not rows:
        return _empty_frame(tenant_id)

    df = pd.DataFrame(rows).set_index("week").sort_index()

    # --- complete the grid so gaps become EXPLICIT (Rule 5) ---
    full = pd.date_range(df.index.min(), df.index.max(), freq=CFG.BUCKET)
    df = df.reindex(full)
    df["observed"] = df["observed"].fillna(0).astype(int)

    # run-length of consecutive unobserved weeks
    gap = df["observed"].eq(0)
    df["weeks_since_last_event"] = gap.groupby((~gap).cumsum()).cumsum()

    df["weeks_since_last_decision"] = _weeks_since(df, "n_decisions")

    df["tenant_id"] = tenant_id
    return df


def _median_meta(g: pd.DataFrame, key: str) -> float:
    vals = [m.get(key) for m in g["meta"] if isinstance(m, dict) and key in m]
    return float(np.median(vals)) if vals else 0.0


def _max_meta(g: pd.DataFrame, key: str) -> float:
    vals = [m.get(key) for m in g["meta"] if isinstance(m, dict) and key in m]
    return float(np.max(vals)) if vals else 0.0


def _weeks_since(df: pd.DataFrame, column: str) -> pd.Series:
    """Weeks elapsed since the last non-zero value of `column`."""
    if column not in df:
        return pd.Series(0, index=df.index, dtype=int)

    out = []
    counter = 0
    for value in df[column].fillna(0).values:
        if value > 0:
            counter = 0
        else:
            counter += 1
        out.append(counter)
    return pd.Series(out, index=df.index, dtype=int)


def _empty_frame(tenant_id: str) -> pd.DataFrame:
    from m_learning.registry.tiers import OBSERVED_FEATURES

    df = pd.DataFrame(columns=OBSERVED_FEATURES)
    df["tenant_id"] = pd.Series(dtype=str)
    df.index = pd.DatetimeIndex([], name="week")
    return df

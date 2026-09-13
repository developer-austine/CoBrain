import numpy as np
import pandas as pd
import pytest

from m_learning.data.feature_builder import build_weekly_features


def event(ts, actor="alice", kind="commit", meta=None):
    return {"ts": pd.Timestamp(ts, tz="UTC"), "actor": actor, "kind": kind, "meta": meta or {}}


def test_counts_are_aggregated_per_week():
    events = pd.DataFrame([
        event("2026-01-05 10:00", kind="commit"),
        event("2026-01-06 11:00", kind="commit"),
        event("2026-01-07 12:00", kind="pr_opened"),
        event("2026-01-08 13:00", kind="pr_merged"),
    ])
    df = build_weekly_features(events, "t1")

    assert len(df) == 1
    assert df["n_commits"].iloc[0] == 2
    assert df["n_prs_opened"].iloc[0] == 1
    assert df["n_prs_merged"].iloc[0] == 1


def test_ratios_are_scale_free():
    events = pd.DataFrame([
        event("2026-01-05 08:00"),   # before 09:00 -> after hours
        event("2026-01-05 12:00"),
        event("2026-01-10 12:00"),   # Saturday -> weekend
        event("2026-01-06 20:00"),   # after 18:00 -> after hours
    ])
    df = build_weekly_features(events, "t1")

    assert df["after_hours_ratio"].iloc[0] == pytest.approx(0.5)
    assert df["weekend_ratio"].iloc[0] == pytest.approx(0.25)


def test_merge_rate_never_divides_by_zero():
    events = pd.DataFrame([event("2026-01-05 10:00", kind="pr_merged")])
    df = build_weekly_features(events, "t1")
    assert df["merge_rate"].iloc[0] == 0.0


def test_actor_entropy_is_low_when_one_person_carries_everything():
    solo = pd.DataFrame([event(f"2026-01-0{d} 10:00", actor="alice") for d in range(5, 9)])
    shared = pd.DataFrame([
        event("2026-01-05 10:00", actor="alice"),
        event("2026-01-06 10:00", actor="bob"),
        event("2026-01-07 10:00", actor="carol"),
        event("2026-01-08 10:00", actor="dave"),
    ])

    solo_entropy = build_weekly_features(solo, "t1")["actor_entropy"].iloc[0]
    shared_entropy = build_weekly_features(shared, "t1")["actor_entropy"].iloc[0]

    assert solo_entropy < shared_entropy
    assert build_weekly_features(solo, "t1")["top_actor_share"].iloc[0] == pytest.approx(1.0)
    assert build_weekly_features(shared, "t1")["n_active_actors"].iloc[0] == 4


def test_missing_weeks_are_explicit_never_zero_filled_silently():
    # Rule 5: a gap must be distinguishable from a week of genuine inactivity.
    events = pd.DataFrame([
        event("2026-01-05 10:00"),
        event("2026-02-16 10:00"),
    ])
    df = build_weekly_features(events, "t1")

    assert len(df) > 2
    assert df["observed"].iloc[0] == 1
    assert df["observed"].iloc[-1] == 1
    assert (df["observed"] == 0).sum() > 0

    gap = df[df["observed"] == 0]
    assert gap["weeks_since_last_event"].iloc[0] == 1
    assert gap["weeks_since_last_event"].is_monotonic_increasing


def test_grid_is_complete_and_weekly():
    events = pd.DataFrame([
        event("2026-01-05 10:00"),
        event("2026-03-02 10:00"),
    ])
    df = build_weekly_features(events, "t1")

    deltas = pd.Series(df.index).diff().dropna().unique()
    assert len(deltas) == 1
    assert deltas[0] == pd.Timedelta(days=7)


def test_latency_features_read_precomputed_meta():
    events = pd.DataFrame([
        event("2026-01-05 10:00", meta={"review_delay_s": 100}),
        event("2026-01-06 10:00", meta={"review_delay_s": 300}),
    ])
    df = build_weekly_features(events, "t1")
    assert df["median_review_delay"].iloc[0] == pytest.approx(200.0)


def test_weeks_since_last_decision_counts_up_between_decisions():
    events = pd.DataFrame([
        event("2026-01-05 10:00", kind="decision"),
        event("2026-01-12 10:00", kind="commit"),
        event("2026-01-19 10:00", kind="commit"),
    ])
    df = build_weekly_features(events, "t1")
    assert df["weeks_since_last_decision"].iloc[0] == 0
    assert df["weeks_since_last_decision"].iloc[1] == 1
    assert df["weeks_since_last_decision"].iloc[2] == 2


def test_tenant_id_is_stamped_on_every_row():
    events = pd.DataFrame([event("2026-01-05 10:00")])
    df = build_weekly_features(events, "tenant-42")
    assert set(df["tenant_id"].unique()) == {"tenant-42"}

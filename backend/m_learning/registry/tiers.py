"""Tier definitions and the forecast target registry.

Three tiers, three distinct mechanisms (Decision 2):
  Tier 1 UNIVERSAL  -> sequence encoder            -> base trajectory z_t
  Tier 2 INDUSTRY   -> feature mask                -> gate m_ind
  Tier 3 GEOGRAPHY  -> static latent + known-future -> e_geo and g_t
"""

from dataclasses import dataclass, field
from enum import Enum


class Tier(str, Enum):
    UNIVERSAL = "universal"
    INDUSTRY = "industry"
    GEOGRAPHY = "geography"


class Channel(str, Enum):
    OBSERVED = "observed"
    STATIC = "static"
    KNOWN_FUTURE = "known_future"


TIER_CHANNELS = {
    Tier.UNIVERSAL: Channel.OBSERVED,
    Tier.INDUSTRY: Channel.STATIC,
    Tier.GEOGRAPHY: Channel.STATIC,
}

# --- Family 1: counts ---
COUNT_FEATURES = [
    "n_commits",
    "n_prs_opened",
    "n_prs_merged",
    "n_messages",
    "n_docs_created",
    "n_docs_edited",
    "n_tasks_assigned",
    "n_tasks_completed",
    "n_decisions",
]

# --- Family 2: ratios ---
RATIO_FEATURES = [
    "after_hours_ratio",
    "weekend_ratio",
    "merge_rate",
    "completion_ratio",
    "reopen_rate",
]

# --- Family 3: latencies ---
LATENCY_FEATURES = [
    "median_review_delay",
    "median_cycle_time",
    "median_response_delay",
    "oldest_open_task_age",
    "weeks_since_last_decision",
]

# --- Family 4: dispersion ---
DISPERSION_FEATURES = [
    "actor_entropy",
    "top_actor_share",
    "n_active_actors",
]

# --- Family 5: text-derived ---
TEXT_FEATURES = [
    "sentiment_mean",
    "sentiment_std",
    "topic_drift",
]

# Rule 5: missing buckets are explicit, never silently zero-filled.
MASK_FEATURES = [
    "observed",
    "weeks_since_last_event",
]

# Rule 3: calendar time is cyclical, always as a sin/cos pair.
CALENDAR_FEATURES = [
    "week_sin",
    "week_cos",
]

# Tier 3 time-varying half (FIX 3). Known into the future.
GEO_TIME_FEATURES = [
    "inflation_rate",
    "policy_rate",
    "fx_volatility",
    "is_holiday_week",
    "is_rate_decision_week",
    "is_quarter_end",
]

OBSERVED_FEATURES = (
    COUNT_FEATURES
    + RATIO_FEATURES
    + LATENCY_FEATURES
    + DISPERSION_FEATURES
    + TEXT_FEATURES
    + MASK_FEATURES
)

KNOWN_FUTURE_FEATURES = CALENDAR_FEATURES + GEO_TIME_FEATURES

# The encoder input column order. g_t is already concatenated here (FIX 3).
MODEL_FEATURES = OBSERVED_FEATURES + KNOWN_FUTURE_FEATURES

N_FEATURES = len(MODEL_FEATURES)


@dataclass
class ForecastTarget:
    key: str
    label: str
    source_feature: str
    description: str
    higher_is_worse: bool = False


FORECAST_TARGETS: dict[str, ForecastTarget] = {
    t.key: t
    for t in [
        ForecastTarget(
            key="burnout_risk",
            label="Burnout risk",
            source_feature="after_hours_ratio",
            description="After-hours and weekend work concentration.",
            higher_is_worse=True,
        ),
        ForecastTarget(
            key="delivery_velocity",
            label="Delivery velocity",
            source_feature="n_tasks_completed",
            description="Throughput of completed work per week.",
        ),
        ForecastTarget(
            key="bus_factor",
            label="Bus factor",
            source_feature="actor_entropy",
            description="How concentrated the work is on few people.",
        ),
        ForecastTarget(
            key="review_latency",
            label="Review latency",
            source_feature="median_review_delay",
            description="Time from PR opened to first review.",
            higher_is_worse=True,
        ),
        ForecastTarget(
            key="topic_shift",
            label="Topic shift",
            source_feature="topic_drift",
            description="Drift of weekly discussion away from its baseline.",
        ),
        ForecastTarget(
            key="decision_cadence",
            label="Decision cadence",
            source_feature="n_decisions",
            description="Rate at which decisions are recorded.",
        ),
    ]
}


def target_index(target_key: str) -> int:
    """Column index of a target's source feature in MODEL_FEATURES."""
    if target_key not in FORECAST_TARGETS:
        raise KeyError(f"Unknown forecast target: {target_key}")
    return MODEL_FEATURES.index(FORECAST_TARGETS[target_key].source_feature)

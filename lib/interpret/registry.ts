import { TARGET_META, type ForecastTargetKey } from "@/lib/forecast/types";

/**
 * Display names and polarity for the interpretation layer (spec §3.2, §3.3).
 *
 * Raw feature ids must never reach the DOM: "median_review_delay" is a column
 * name, and a sentence containing it reads as a leaked internal rather than an
 * explanation.
 */

/**
 * Every feature the model can return, in human terms.
 *
 * This list is exhaustive against `MODEL_FEATURES` in
 * backend/m_learning/registry/tiers.py rather than a sample. That matters more
 * than it looks: a driver whose id is missing here would fall through to the
 * raw id, which is the one thing this registry exists to prevent — and drivers
 * are ranked by weight, so the offender is often the most prominent line.
 */
export const FEATURE_LABELS: Record<string, string> = {
  // Effort and timing
  after_hours_ratio: "after-hours work patterns",
  weekend_ratio: "weekend work",
  median_cycle_time: "task cycle time",
  median_review_delay: "review turnaround",
  median_response_delay: "response time",
  oldest_open_task_age: "how long the oldest task has been open",

  // Throughput
  completion_ratio: "share of work finished",
  merge_rate: "merge rate",
  reopen_rate: "how often work is reopened",

  // People
  actor_entropy: "how work is spread across people",
  top_actor_share: "how much sits with one person",
  n_active_actors: "how many people are active",

  // Conversation
  sentiment_mean: "overall message tone",
  sentiment_std: "mood swings in messages",
  topic_drift: "shift in what the team discusses",

  // Decisions
  weeks_since_last_decision: "time since the last decision",
  weeks_since_last_event: "time since the last recorded activity",

  // Calendar and external context
  is_holiday_week: "holiday weeks",
  is_quarter_end: "quarter end",
  is_rate_decision_week: "rate-decision weeks",
  policy_rate: "interest-rate environment",
  inflation_rate: "inflation",
  fx_volatility: "currency volatility",

  // Data quality
  observed: "data availability",
};

/**
 * Features that are one concept split across columns.
 *
 * `week_sin` and `week_cos` are a single seasonal term encoded as two
 * components; showing them as two separate drivers implies two independent
 * causes and reads as noise. Weights are summed by magnitude.
 */
export const MERGE_GROUPS: { ids: string[]; label: string }[] = [
  { ids: ["week_sin", "week_cos"], label: "seasonal timing" },
];

/** Human label for a feature id, or null when the id is unknown. */
export function featureLabel(id: string): string | null {
  const group = MERGE_GROUPS.find((g) => g.ids.includes(id));
  if (group) return group.label;
  return FEATURE_LABELS[id] ?? null;
}

export type Polarity = "up_bad" | "up_good";

/**
 * Which direction is bad, per signal.
 *
 * Derived from `TARGET_META.higherIsWorse` rather than restated as its own
 * table. The spec lists polarity separately, but a second copy is a second
 * thing to keep in step — and the two disagreeing would put a coral "improving"
 * on screen, which is worse than either answer alone.
 */
export function polarityOf(signalId: string): Polarity {
  const meta = TARGET_META[signalId as ForecastTargetKey];
  // Unknown signals are treated as "up is good": the neutral reading, and it
  // avoids painting an unfamiliar metric as a problem on no evidence.
  if (!meta) return "up_good";
  return meta.higherIsWorse ? "up_bad" : "up_good";
}

/** Does a move in this direction make things worse for this signal? */
export function isWorsening(signalId: string, delta: number): boolean {
  if (delta === 0) return false;
  return polarityOf(signalId) === "up_bad" ? delta > 0 : delta < 0;
}

/** The signal's display name, falling back to a de-slugged id. */
export function signalLabel(signalId: string): string {
  return (
    TARGET_META[signalId as ForecastTargetKey]?.label ??
    signalId.replace(/_/g, " ")
  );
}

/**
 * The forecast contract shared by the API route, the page and the chart.
 *
 * Mirrors `m_learning/inference/predictor.py::Forecast` — one shape crossing the
 * Python/TypeScript boundary, so a change on either side breaks the build rather
 * than the chart.
 */

export const FORECAST_TARGETS = [
  "burnout_risk",
  "delivery_velocity",
  "bus_factor",
  "review_latency",
  "topic_shift",
  "decision_cadence",
] as const;

export type ForecastTargetKey = (typeof FORECAST_TARGETS)[number];

export type TargetMeta = {
  key: ForecastTargetKey;
  label: string;
  description: string;
  /** A rise in this metric is bad news. Drives the direction chip, never the hue. */
  higherIsWorse: boolean;
};

export const TARGET_META: Record<ForecastTargetKey, TargetMeta> = {
  burnout_risk: {
    key: "burnout_risk",
    label: "Burnout risk",
    description: "After-hours and weekend work concentration.",
    higherIsWorse: true,
  },
  delivery_velocity: {
    key: "delivery_velocity",
    label: "Delivery velocity",
    description: "Throughput of completed work per week.",
    higherIsWorse: false,
  },
  bus_factor: {
    key: "bus_factor",
    label: "Bus factor",
    description: "How concentrated the work is on few people.",
    higherIsWorse: false,
  },
  review_latency: {
    key: "review_latency",
    label: "Review latency",
    description: "Time from PR opened to first review.",
    higherIsWorse: true,
  },
  topic_shift: {
    key: "topic_shift",
    label: "Topic shift",
    description: "Drift of weekly discussion away from its baseline.",
    higherIsWorse: false,
  },
  decision_cadence: {
    key: "decision_cadence",
    label: "Decision cadence",
    description: "Rate at which decisions are recorded.",
    higherIsWorse: false,
  },
};

/**
 * Quantile levels the model emits, as strings keyed off `CFG.QUANTILES`.
 *
 * Widened from the literal `"0.1" | "0.5" | "0.9"` so the chart can render
 * whatever the checkpoint was trained with. The trained head is one output per
 * level, so adding levels here alone changes nothing — it takes a retrain — but
 * keeping the type open means the UI does not have to change when that happens.
 */
export type QuantileKey = string;

export type Driver = { feature: string; weight: number };

export type Forecast = {
  target: ForecastTargetKey;
  /** ISO week-start dates, one per horizon step. */
  weeks: string[];
  quantiles: Record<QuantileKey, number[]>;
  /** Below MIN_WEEKS_REQUIRED of history — the band is wide for a reason. */
  lowConfidence: boolean;
  observedWeeks: number;
  drivers: Driver[];
  /** Observed history leading into the forecast, for chart context. */
  history: { week: string; value: number }[];
  /**
   * Whether this target's source signal actually varies in the tenant's data.
   * A missing connector yields a flat-zero series that still forecasts, and on
   * screen that is indistinguishable from a real one unless we say so.
   */
  hasSignal: boolean;
};

export type ForecastBundle = {
  tenantId: string;
  generatedAt: string;
  modelVersion: string | null;
  forecasts: Forecast[];
};

/**
 * Net movement of the median across the horizon.
 *
 * Measured against a short trailing median rather than the single last observed
 * week. The most recent bucket is usually a partial week — the grid runs to
 * today, not to Sunday — so it reads artificially low, and anchoring to it
 * inflated every headline move (a −3σ partial week turned a flat outlook into
 * "+3.31σ"). Four weeks is enough to shrug off one bad point without smoothing
 * away a genuine recent shift.
 */
const BASELINE_WEEKS = 4;

export function medianChange(f: Forecast): number {
  const p50 = f.quantiles["0.5"];
  if (!p50?.length) return 0;

  const recent = f.history.slice(-BASELINE_WEEKS).map((h) => h.value);
  const from = recent.length ? median(recent) : p50[0];
  return p50[p50.length - 1] - from;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type QuantileBand = {
  lower: QuantileKey;
  upper: QuantileKey;
  /** Rendered in the chart legend, e.g. "10–90%". */
  label: string;
};

/**
 * Pair the emitted quantiles into nested prediction intervals.
 *
 * Levels are paired outward-in around the median — lowest with highest, then
 * the next pair inward — which is what produces the nested fan. The list is
 * derived from the data rather than hard-coded, so a checkpoint trained with
 * more heads deepens the fan without a UI change, and one trained with fewer
 * degrades to a single band instead of rendering intervals that do not exist.
 *
 * The median is excluded: it is a line, not an interval.
 */
export function quantileBands(f: Forecast): QuantileBand[] {
  const levels = Object.keys(f.quantiles ?? {})
    .map((k) => ({ key: k, value: Number(k) }))
    .filter((q) => Number.isFinite(q.value) && q.value !== 0.5)
    .sort((a, b) => a.value - b.value);

  const bands: QuantileBand[] = [];
  for (let lo = 0, hi = levels.length - 1; lo < hi; lo++, hi--) {
    const lower = levels[lo];
    const upper = levels[hi];
    // Only genuinely paired levels form an interval; an odd leftover next to
    // the median has no partner and is dropped rather than paired with itself.
    if (!lower || !upper || lower.value >= upper.value) break;
    bands.push({
      lower: lower.key,
      upper: upper.key,
      label: `${(lower.value * 100).toFixed(0)}–${(upper.value * 100).toFixed(0)}%`,
    });
  }
  return bands;
}

/** Width of the P10–P90 band at the final step: how uncertain the outlook is. */
export function bandWidth(f: Forecast): number {
  const lo = f.quantiles["0.1"];
  const hi = f.quantiles["0.9"];
  if (!lo?.length || !hi?.length) return 0;
  return hi[hi.length - 1] - lo[lo.length - 1];
}

/**
 * Values are per-tenant z-scores (Rule 1), so the unit is standard deviations
 * from that tenant's own baseline — not a count and not a percentage. Labelling
 * it "σ" keeps the axis honest; calling it "%" would be a lie.
 */
export function formatSigma(value: number): string {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}σ`;
}

import type { Polarity } from "./registry";

/**
 * The threshold tables (spec §3.4).
 *
 * Every boundary is inclusive at the lower edge — 0.25 is "drifting", not
 * "holding steady". Stated explicitly because the tests pin the exact
 * boundaries, and an off-by-one-epsilon here changes the words on screen for
 * values sitting right on a cut.
 */

export type Direction = "up" | "down" | "flat";

export function directionOf(delta: number): Direction {
  if (Math.abs(delta) < MAGNITUDE_STEADY) return "flat";
  return delta > 0 ? "up" : "down";
}

const MAGNITUDE_STEADY = 0.25;
const MAGNITUDE_CLEAR = 0.75;
const MAGNITUDE_SHARP = 1.5;

/** "holding steady" / "drifting up" / "clearly rising" / "moving sharply up" */
export function magnitudePhrase(delta: number): string {
  const abs = Math.abs(delta);
  const up = delta > 0;

  if (abs < MAGNITUDE_STEADY) return "holding steady";
  if (abs < MAGNITUDE_CLEAR) return `drifting ${up ? "up" : "down"}`;
  if (abs < MAGNITUDE_SHARP) return `clearly ${up ? "rising" : "falling"}`;
  return `moving sharply ${up ? "up" : "down"}`;
}

/**
 * The same move in human units.
 *
 * "one tough week" for a metric where up is bad, "one strong week" where up is
 * good — the adjective carries the polarity so the sentence reads correctly
 * without a second clause explaining which way is which.
 */
export function plainMagnitude(delta: number, polarity: Polarity): string {
  const abs = Math.abs(delta);
  const above = delta > 0;
  const side = above ? "above" : "below";

  if (abs < MAGNITUDE_STEADY) return "about level with its normal";
  if (abs < MAGNITUDE_CLEAR) return `slightly ${side} its normal`;
  if (abs < MAGNITUDE_SHARP) {
    const week = polarity === "up_bad" ? "tough" : "strong";
    return `about one ${week} week ${side} its normal`;
  }
  return "well beyond anything in its recent history";
}

/** Short form for tooltips and one-line summaries, without the trailing noun. */
export function plainMagnitudeShort(delta: number, polarity: Polarity): string {
  const abs = Math.abs(delta);
  if (abs < MAGNITUDE_STEADY) return "about normal";
  if (abs < MAGNITUDE_CLEAR) return `slightly ${delta > 0 ? "above" : "below"} normal`;
  if (abs < MAGNITUDE_SHARP) {
    const week = polarity === "up_bad" ? "tough" : "strong";
    return `a ${week} week ${delta > 0 ? "above" : "below"} normal`;
  }
  return "beyond recent history";
}

const BAND_CONFIDENT = 1.0;
const BAND_WIDE = 2.0;

/** How much to trust the interval, in words. */
export function bandPhrase(width: number): string {
  if (width < BAND_CONFIDENT) return "the model is fairly confident in this range";
  if (width < BAND_WIDE)
    return "that's a wide range — read this as a direction, not a promise";
  return "highly uncertain — directional only";
}

/** The KPI-tile form: the same judgement in two or three words. */
export function bandPhraseShort(width: number): string {
  if (width < BAND_CONFIDENT) return "fairly confident";
  if (width < BAND_WIDE) return "wide — directional";
  return "highly uncertain";
}

export type Momentum = {
  /** Consecutive same-direction weeks, counted back from the latest. */
  streak: number;
  direction: Direction;
  /** True when each step is larger than the one before it. */
  accelerating: boolean;
  sentence: string | null;
};

const MOMENTUM_MIN_STREAK = 3;
const MOMENTUM_LOOKBACK = 6;

/**
 * Read a run off the recent weekly deltas (spec §3.4).
 *
 * A streak is only reported at three weeks or more: two weeks in the same
 * direction is ordinary noise in a weekly series, and calling it a trend is
 * how a dashboard teaches people to stop believing it.
 *
 * Returns `sentence: null` when there is no run worth naming — the caller omits
 * the line rather than printing a hedge.
 */
export function momentumOf(deltas: number[], polarity: Polarity): Momentum {
  const recent = deltas.slice(-MOMENTUM_LOOKBACK);
  const none: Momentum = { streak: 0, direction: "flat", accelerating: false, sentence: null };
  if (recent.length < MOMENTUM_MIN_STREAK) return none;

  const last = recent[recent.length - 1];
  if (last === 0) return none;
  const sign = Math.sign(last);

  let streak = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (Math.sign(recent[i]) !== sign || recent[i] === 0) break;
    streak++;
  }
  if (streak < MOMENTUM_MIN_STREAK) return none;

  const run = recent.slice(recent.length - streak).map(Math.abs);
  const accelerating = run.every((v, i) => i === 0 || v > run[i - 1]);

  // "Pressure" is polarity-aware: a rising good metric is easing pressure, not
  // building it.
  const worsening = polarity === "up_bad" ? sign > 0 : sign < 0;
  const word = worsening ? "rising" : "easing";
  const tail = accelerating ? "speeding up" : "steady trend";

  return {
    streak,
    direction: sign > 0 ? "up" : "down",
    accelerating,
    sentence: `${streak} straight weeks of ${word} pressure — ${tail}`,
  };
}

/** Weekly first differences of an observed series. */
export function weeklyDeltas(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) out.push(values[i] - values[i - 1]);
  return out;
}

const COVERAGE_TRUSTWORTHY = 0.6;

/** Track-record wording, which flips below the coverage floor (spec §7.3f). */
export function coverageSentence(coverage: number): string {
  return coverage >= COVERAGE_TRUSTWORTHY
    ? "When this model gives a range, reality usually lands inside it."
    : "Recent forecasts have been missing — the model is being retrained.";
}

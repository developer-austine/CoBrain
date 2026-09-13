import {
  featureLabel,
  isWorsening,
  MERGE_GROUPS,
  polarityOf,
  signalLabel,
  type Polarity,
} from "./registry";
import {
  bandPhrase,
  bandPhraseShort,
  directionOf,
  magnitudePhrase,
  momentumOf,
  plainMagnitude,
  plainMagnitudeShort,
  weeklyDeltas,
  type Momentum,
} from "./thresholds";
import { nearestWeek, weekLabel, type Anchor, type ObservedPoint } from "./anchor";

/**
 * The narrative engine (spec §3).
 *
 * THE ONE LAW: this is a deterministic pure function of the forecast payload.
 * Same values in, byte-identical words out, recomputed on every poll and every
 * signal switch. There is no model call anywhere in this file and there must
 * never be one — a sentence that changes when nothing changed destroys the
 * reader's ability to trust that the words track the numbers.
 *
 * The second law is quieter and matters as much: a clause whose input is
 * missing is OMITTED, never filled with a guess. An anchor with no comparable
 * week, a caveat with no calibration, a momentum line with no run — each simply
 * does not appear.
 */

export type InterpretInput = {
  signalId: string;
  /** z-scored weekly history, oldest first. */
  observed: ObservedPoint[];
  forecast: { week: string; p10: number; p50: number; p90: number }[];
  driverWeights: { featureId: string; weight: number }[];
  weeksObserved: number;
  minWeeksRequired: number;
  calibration?: { coverage: number; window: number };
  driftAlarm?: boolean;
};

export type NarrativeDriver = {
  label: string;
  weight: number;
  /** Share of total absolute weight, 0–1. */
  share: number;
  sentence: string;
};

export type Narrative = {
  verdict: { text: string; tone: "bad" | "good" | "neutral" };
  /** S2..S5, in order, with unavailable slots already dropped. */
  sentences: string[];
  anchor?: { weekISO: string; label: string };
  drivers: NarrativeDriver[];
  momentum: Momentum;
  kpis: {
    projectedMove: string;
    movePlain: string;
    range: string;
    rangePlain: string;
    history: string;
    historyPlain: string;
    accuracy?: string;
    accuracyPlain?: string;
  };
  /** Machine-readable values, so UI never re-derives them from the prose. */
  facts: {
    delta: number;
    bandWidth: number;
    polarity: Polarity;
    worsening: boolean;
    horizonWeek: string | null;
  };
};

/** σ, always signed, two decimals — matches the axis and the scenario tiles. */
function sigma(value: number): string {
  const v = Math.abs(value) < 0.005 ? 0 : value;
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}σ`;
}

function monthOf(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long" });
}

/**
 * Collapse merge groups and resolve labels (spec §3.2).
 *
 * Weights are summed by magnitude, because two halves of one seasonal term can
 * carry opposite signs while describing a single effect; adding them signed
 * would cancel a real driver to nearly zero.
 */
export function resolveDrivers(
  weights: { featureId: string; weight: number }[]
): { label: string; weight: number }[] {
  const merged = new Map<string, number>();

  for (const { featureId, weight } of weights) {
    const label = featureLabel(featureId);
    // An unlabelled id is dropped rather than printed. Leaking
    // "median_review_delay" into a sentence is the one failure this layer
    // exists to prevent, and a shorter driver list is a cheaper price.
    if (!label) continue;
    merged.set(label, (merged.get(label) ?? 0) + Math.abs(weight));
  }

  return [...merged.entries()]
    .map(([label, weight]) => ({ label, weight }))
    // Ties broken by label so repeated runs order identically (determinism).
    .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
}

/** "the strongest push" / "a secondary push" / "a minor push". */
function rankWording(index: number): string {
  if (index === 0) return "the strongest push behind this forecast";
  if (index === 1) return "a secondary push behind this forecast";
  return "a minor push behind this forecast";
}

function buildDrivers(
  input: InterpretInput,
  momentum: Momentum
): NarrativeDriver[] {
  const resolved = resolveDrivers(input.driverWeights);
  const total = resolved.reduce((sum, d) => sum + d.weight, 0);

  return resolved.map((d, i) => {
    // Only the top driver can honestly borrow the observed streak: momentum is
    // measured on the signal, not per feature, so attributing "risen 4 weeks
    // straight" to a third-ranked driver would be inventing evidence.
    const canCiteStreak = i === 0 && momentum.sentence !== null;
    const movement = canCiteStreak
      ? `has ${momentum.direction === "up" ? "risen" : "fallen"} ${momentum.streak} weeks straight — `
      : "is ";

    return {
      label: d.label,
      weight: d.weight,
      share: total > 0 ? d.weight / total : 0,
      sentence: `${capitalise(d.label)} ${movement}${rankWording(i)}.`,
    };
  });
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Words in a sentence list, for the §3.6 budget check. */
export function wordCount(sentences: string[]): number {
  return sentences.join(" ").trim().split(/\s+/).filter(Boolean).length;
}

export function buildNarrative(input: InterpretInput): Narrative {
  const polarity = polarityOf(input.signalId);
  const label = signalLabel(input.signalId);

  const lastObserved = input.observed.at(-1)?.value ?? 0;
  const horizon = input.forecast.at(-1) ?? null;
  const p50 = horizon?.p50 ?? lastObserved;

  const delta = p50 - lastObserved;
  const bandWidth = horizon ? horizon.p90 - horizon.p10 : 0;
  const worsening = isWorsening(input.signalId, delta);
  const flat = directionOf(delta) === "flat";

  const momentum = momentumOf(
    weeklyDeltas(input.observed.map((o) => o.value)),
    polarity
  );

  // ── S1 verdict ──────────────────────────────────────────────────────────
  const verdict = {
    text: `${label} is ${magnitudePhrase(delta)}.`,
    tone: (flat ? "neutral" : worsening ? "bad" : "good") as "bad" | "good" | "neutral",
  };

  const sentences: string[] = [];

  // ── S2 anchor ───────────────────────────────────────────────────────────
  const anchor: Anchor | null = horizon ? nearestWeek(input.observed, p50) : null;
  const month = horizon ? monthOf(horizon.week) : null;
  const plain = plainMagnitude(delta, polarity);

  if (month) {
    sentences.push(
      anchor
        ? `By ${month}, the model expects this team to sit ${plain} — similar to the week of ${anchor.label}.`
        : `By ${month}, the model expects this team to sit ${plain}.`
    );
  }

  // ── S3 range ────────────────────────────────────────────────────────────
  if (horizon) {
    // Short forms at the range ends. The full phrase twice in one sentence
    // ("well beyond anything in its recent history to well beyond anything in
    // its recent history") both breaks the 60-word budget in §3.6 and reads as
    // padding; the endpoints only need to be distinguishable from each other.
    const bear = plainMagnitudeShort(horizon.p10 - lastObserved, polarity);
    const bull = plainMagnitudeShort(horizon.p90 - lastObserved, polarity);
    sentences.push(
      `Realistically it could land anywhere from ${bear} to ${bull} — ${bandPhrase(bandWidth)}.`
    );
  }

  // ── S4 caveats ──────────────────────────────────────────────────────────
  if (input.weeksObserved < input.minWeeksRequired) {
    sentences.push(
      `With only ${input.weeksObserved} weeks of history, treat this as an early read.`
    );
  }
  if (input.driftAlarm) {
    sentences.push(
      "This forecast is running on a stale model and is being retrained — treat with extra caution."
    );
  }

  // ── S5 watch ────────────────────────────────────────────────────────────
  const drivers = buildDrivers(input, momentum);
  const topDriver = drivers[0];
  if (topDriver && momentum.sentence) {
    const outcome = worsening ? "trend" : "recovery";
    const way = momentum.direction === "up" ? "rising" : "falling";
    sentences.push(
      `Watch: ${momentum.streak} more weeks of ${topDriver.label} ${way} turns this into a ${outcome}.`
    );
  }

  // ── KPI tiles ───────────────────────────────────────────────────────────
  const accuracyPct =
    input.calibration && input.calibration.window > 0
      ? Math.round(input.calibration.coverage * 100)
      : null;

  return {
    verdict,
    sentences,
    anchor: anchor ? { weekISO: anchor.weekISO, label: anchor.label } : undefined,
    drivers,
    momentum,
    kpis: {
      projectedMove: sigma(delta),
      movePlain: magnitudePhrase(delta),
      range: `${bandWidth.toFixed(2)}σ`,
      rangePlain: bandPhraseShort(bandWidth),
      history: `${input.weeksObserved}w`,
      historyPlain:
        input.weeksObserved < input.minWeeksRequired ? "still learning" : "well observed",
      ...(accuracyPct !== null
        ? { accuracy: `${accuracyPct}%`, accuracyPlain: "lands in band" }
        : {}),
    },
    facts: {
      delta,
      bandWidth,
      polarity,
      worsening,
      horizonWeek: horizon?.week ?? null,
    },
  };
}

/**
 * The one-line summary under a signal row (spec §9), and the body of every σ
 * tooltip. Deliberately built from the same fragments as S1 so the row and the
 * card can never describe the same number differently.
 */
export function microSummary(signalId: string, delta: number): string {
  const polarity = polarityOf(signalId);
  return `${magnitudePhrase(delta)} · ${plainMagnitudeShort(delta, polarity)}`;
}

/** "+0.88σ ≈ about one tough week above its normal for this team". */
export function sigmaTooltip(signalId: string, value: number): string {
  const polarity = polarityOf(signalId);
  return `${sigma(value)} ≈ ${plainMagnitude(value, polarity)} for this team`;
}

export { sigma, weekLabel, MERGE_GROUPS };

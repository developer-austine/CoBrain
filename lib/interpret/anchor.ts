/**
 * The lived-history anchor (spec §3.5).
 *
 * "Similar to the week of Jul 6" does something a sigma value cannot: it points
 * at a week the team actually lived through. That only works if the week really
 * is comparable, so the match is dropped entirely rather than stretched — an
 * anchor that is merely the closest of a bad set is worse than no anchor,
 * because it invites the reader to reason from a week that felt nothing like
 * the forecast.
 */

export const ANCHOR_MAX_DISTANCE = 0.35;

export type ObservedPoint = { week: string; value: number };

export type Anchor = {
  weekISO: string;
  /** "Jul 6" — the form used inside "the week of {label}". */
  label: string;
  distance: number;
};

/** Format an ISO week-start as "Jul 6", or null if it will not parse. */
export function weekLabel(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Closest observed week to `target`, or null when nothing is close enough.
 *
 * Ties go to the earlier week only because the scan keeps the first strict
 * minimum; the choice is arbitrary but fixed, which keeps the output
 * deterministic for identical input.
 */
export function nearestWeek(
  observed: ObservedPoint[],
  target: number,
  maxDistance: number = ANCHOR_MAX_DISTANCE
): Anchor | null {
  let best: ObservedPoint | null = null;
  let bestDist = Infinity;

  for (const point of observed) {
    if (!Number.isFinite(point.value)) continue;
    const d = Math.abs(point.value - target);
    if (d < bestDist) {
      bestDist = d;
      best = point;
    }
  }

  if (!best || bestDist > maxDistance) return null;

  const label = weekLabel(best.week);
  // An unparseable date cannot be phrased as "the week of —", so the anchor is
  // dropped rather than rendered with a raw ISO string in the sentence.
  if (!label) return null;

  return { weekISO: best.week, label, distance: bestDist };
}

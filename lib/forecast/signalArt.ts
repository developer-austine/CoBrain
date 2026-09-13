import type { ForecastTargetKey } from "./types";

/**
 * Per-signal artwork.
 *
 * One registry so a new image is a single line here rather than an edit in the
 * row, the chart header, and whatever comes next. Files live in
 * `public/assets/icons_assets`.
 *
 * Entries are deliberately partial. Three signals have artwork today; the rest
 * resolve to `null` and render as an empty slot that holds its size, so rows
 * stay aligned and dropping in the remaining files needs no layout change and
 * no code change beyond this map. A stand-in glyph would be worse than the gap:
 * it reads as meaning something while carrying nothing, and it would have to be
 * hunted down and removed later.
 */
export const SIGNAL_ART: Partial<Record<ForecastTargetKey, string>> = {
  burnout_risk: "/assets/icons_assets/burnout.jpg",
  bus_factor: "/assets/icons_assets/bus_factor.png",
  delivery_velocity: "/assets/icons_assets/delivery_velocity.jpg",
};

export function signalArt(target: ForecastTargetKey): string | null {
  return SIGNAL_ART[target] ?? null;
}

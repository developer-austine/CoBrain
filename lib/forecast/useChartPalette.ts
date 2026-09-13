"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

/**
 * Resolve the chart tokens to concrete values (spec §5).
 *
 * Recharts writes several colours into places a CSS variable cannot reach — SVG
 * presentation attributes and inline canvas styles — so the values have to be
 * read once per theme change rather than referenced as `var(--chart-p50)`.
 * Reading them from `getComputedStyle` instead of duplicating hex here keeps
 * `globals.css` the single source of truth, so the two can never disagree.
 */

export type ChartPalette = {
  observed: string;
  observedDot: string;
  p50: string;
  band: string;
  bandEdge: string;
  grid: string;
  divider: string;
  crosshair: string;
  pulseCore: string;
  pulseHalo: string;
  textMuted: string;
  textPrimary: string;
  textSecondary: string;
  bgCard: string;
  border: string;
  borderStrong: string;
  accent: string;
  teal: string;
  coral: string;
  amber: string;
};

const TOKENS: Record<keyof ChartPalette, string> = {
  observed: "--chart-observed",
  observedDot: "--chart-observed-dot",
  p50: "--chart-p50",
  band: "--chart-band",
  bandEdge: "--chart-band-edge",
  grid: "--chart-grid",
  divider: "--chart-divider",
  crosshair: "--chart-crosshair",
  pulseCore: "--pulse-core",
  pulseHalo: "--pulse-halo",
  textMuted: "--text-muted",
  textPrimary: "--text-primary",
  textSecondary: "--text-secondary",
  bgCard: "--bg-card",
  border: "--border",
  borderStrong: "--border-strong",
  accent: "--accent",
  teal: "--teal",
  coral: "--coral",
  amber: "--amber",
};

/**
 * Light-theme values, used for the server render and the first paint before
 * `getComputedStyle` can run. They match the `:root` block in globals.css.
 */
const FALLBACK: ChartPalette = {
  observed: "#9AA3B5",
  observedDot: "#6B7488",
  p50: "#6D5EF0",
  band: "rgba(109, 94, 240, 0.16)",
  bandEdge: "rgba(109, 94, 240, 0.34)",
  grid: "rgba(15, 23, 42, 0.06)",
  divider: "rgba(15, 23, 42, 0.28)",
  crosshair: "rgba(15, 23, 42, 0.35)",
  pulseCore: "#6D5EF0",
  pulseHalo: "rgba(109, 94, 240, 0.35)",
  textMuted: "#8B94A8",
  textPrimary: "#0F172A",
  textSecondary: "#55607A",
  bgCard: "#FFFFFF",
  border: "rgba(15, 23, 42, 0.08)",
  borderStrong: "rgba(15, 23, 42, 0.14)",
  accent: "#6D5EF0",
  teal: "#0FA88C",
  coral: "#E0483F",
  amber: "#D98A0B",
};

function readPalette(): ChartPalette {
  if (typeof window === "undefined") return FALLBACK;

  const computed = getComputedStyle(document.documentElement);
  const out = {} as ChartPalette;
  for (const [key, token] of Object.entries(TOKENS) as [keyof ChartPalette, string][]) {
    out[key] = computed.getPropertyValue(token).trim() || FALLBACK[key];
  }
  return out;
}

export function useChartPalette(): ChartPalette {
  const { resolvedTheme } = useTheme();
  const [palette, setPalette] = useState<ChartPalette>(FALLBACK);

  useEffect(() => {
    // Read after the theme attribute lands on <html>, not during it — a read
    // in the same tick returns the outgoing theme's values.
    const id = requestAnimationFrame(() => setPalette(readPalette()));
    return () => cancelAnimationFrame(id);
  }, [resolvedTheme]);

  return palette;
}

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToMotion(onChange: () => void): () => void {
  const query = window.matchMedia(MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True when the visitor asked for less motion (§6.5).
 *
 * The preference is external state, so it is subscribed to rather than copied
 * into an effect — that keeps the first client render already correct instead
 * of animating for one frame and then stopping. The server snapshot is `false`
 * because the preference is unknowable until hydration.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia(MOTION_QUERY).matches,
    () => false
  );
}

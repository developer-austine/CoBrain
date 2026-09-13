"use client";

import React, { createContext, useContext, useMemo, useState } from "react";

/**
 * Cross-highlight store (spec §5).
 *
 * The spec names zustand. This is React context instead, deliberately: the
 * state is one nullable value, scoped to one page, cleared on mouseleave, and
 * never read outside this tree. Adding a store library for that is a dependency
 * to maintain for no capability gained — and the interface below is exactly the
 * one the spec defines, so swapping the implementation later touches only this
 * file.
 */

export type Highlight =
  | null
  | { type: "week"; weekISO: string }
  | { type: "quantile"; q: 0.1 | 0.5 | 0.9 }
  | { type: "driver"; label: string };

type HighlightState = {
  highlight: Highlight;
  setHighlight: (h: Highlight) => void;
};

const HighlightContext = createContext<HighlightState>({
  highlight: null,
  setHighlight: () => {},
});

export function HighlightProvider({ children }: { children: React.ReactNode }) {
  const [highlight, setHighlight] = useState<Highlight>(null);
  const value = useMemo(() => ({ highlight, setHighlight }), [highlight]);
  return <HighlightContext.Provider value={value}>{children}</HighlightContext.Provider>;
}

export function useHighlight(): HighlightState {
  return useContext(HighlightContext);
}

/** Is this specific week currently highlighted? */
export function isWeekHighlighted(h: Highlight, weekISO: string): boolean {
  return h?.type === "week" && h.weekISO === weekISO;
}

/** Is this driver label currently highlighted? */
export function isDriverHighlighted(h: Highlight, label: string): boolean {
  return h?.type === "driver" && h.label === label;
}

/** Is this quantile edge currently highlighted? */
export function isQuantileHighlighted(h: Highlight, q: 0.1 | 0.5 | 0.9): boolean {
  return h?.type === "quantile" && h.q === q;
}

"use client";

import React from "react";
import { Card, SectionTitle, formatCredits } from "./primitives";

/**
 * Where credits went (§8c).
 *
 * Ranked horizontal bars, capped at six, one plain sentence beneath — the bar
 * rules from the interpretation layer spec, and they apply here for the same
 * reason: the question is "what is costing me", and a chart ordered by anything
 * other than spend makes the reader do the ranking themselves.
 *
 * The top bar is full-strength accent and the rest are 55%. One emphasis per
 * chart: six equally loud bars rank nothing.
 */

export type FeatureRow = {
  feature: string;
  label: string;
  credits: number;
  quantity: number;
  quantityLabel: string;
  share: number;
};

export function FeatureBars({
  rows,
  headline,
}: {
  rows: FeatureRow[];
  headline: string | null;
}) {
  if (rows.length === 0) return null;

  const max = Math.max(...rows.map((r) => r.credits), 0.01);

  return (
    <Card className="p-4">
      <SectionTitle>Where credits went</SectionTitle>

      <ul className="flex flex-col gap-3">
        {rows.map((row, i) => (
          <li key={row.feature}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>
                {row.label}
              </span>
              <span
                className="font-data tnum shrink-0 text-[12px]"
                style={{ color: "var(--text-primary)" }}
              >
                {formatCredits(row.credits)} credits
              </span>
            </div>

            <span
              className="mt-1.5 block h-2.5 w-full overflow-hidden rounded-[3px]"
              style={{ background: "var(--bar-track)" }}
            >
              <span
                className="bar-grow block h-full rounded-[3px]"
                style={{
                  width: `${Math.max(2, (row.credits / max) * 100)}%`,
                  background:
                    i === 0
                      ? "var(--accent)"
                      : "color-mix(in srgb, var(--accent) 55%, transparent)",
                  animationDelay: `${i * 60}ms`,
                }}
              />
            </span>

            {/* The human unit, so a credit figure means something concrete. */}
            <p
              className="font-data tnum mt-1 text-[10.5px]"
              style={{ color: "var(--text-muted)" }}
            >
              {row.quantityLabel}
            </p>
          </li>
        ))}
      </ul>

      {headline && (
        <p
          className="mt-3.5 border-t pt-3 text-[12px] leading-relaxed"
          style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
        >
          {headline}
        </p>
      )}
    </Card>
  );
}

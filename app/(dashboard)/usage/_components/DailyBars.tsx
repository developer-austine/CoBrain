"use client";

import React, { useMemo, useState } from "react";
import { Card, SectionTitle, formatCredits, formatDate } from "./primitives";

/**
 * Usage over time (§8d).
 *
 * Vertical bars for time, stacked by feature, with a dashed line at the daily
 * pace that stays inside the allowance. The line is what makes the chart
 * answer a question rather than merely display data: bars above it are the days
 * that pushed the period over, and they are usually a handful of identifiable
 * events rather than a trend.
 *
 * Four colours plus "other", per the spec. A stack with nine segments is a
 * colour-matching puzzle, not a chart.
 */

export type DailyRow = {
  day: string;
  credits: number;
  byFeature: { feature: string; label: string; credits: number }[];
};

/** Fixed slot order, so a feature keeps its colour as the mix changes. */
const STACK_COLOURS = [
  "var(--accent)",
  "var(--teal)",
  "var(--ice)",
  "var(--amber)",
];
const OTHER_COLOUR = "color-mix(in srgb, var(--accent) 28%, transparent)";

export function DailyBars({ rows, pace }: { rows: DailyRow[]; pace: number }) {
  const [hovered, setHovered] = useState<string | null>(null);

  /** The four biggest features across the whole period get their own colour. */
  const palette = useMemo(() => {
    const totals = new Map<string, { label: string; credits: number }>();
    for (const row of rows) {
      for (const seg of row.byFeature) {
        const prev = totals.get(seg.feature);
        totals.set(seg.feature, {
          label: seg.label,
          credits: (prev?.credits ?? 0) + seg.credits,
        });
      }
    }
    const ranked = [...totals.entries()]
      .sort((a, b) => b[1].credits - a[1].credits)
      .slice(0, STACK_COLOURS.length);

    return new Map(ranked.map(([feature, meta], i) => [feature, { ...meta, colour: STACK_COLOURS[i] }]));
  }, [rows]);

  if (rows.length === 0) return null;

  // The scale must include the pace line, or a quiet period draws a baseline
  // floating above every bar and off the top of the plot.
  const max = Math.max(...rows.map((r) => r.credits), pace, 0.01);
  const hoveredRow = rows.find((r) => r.day === hovered) ?? null;
  const overPace = rows.filter((r) => r.credits > pace).length;

  return (
    <Card className="p-4">
      <SectionTitle
        right={
          <span className="font-data tnum text-[11px]" style={{ color: "var(--text-muted)" }}>
            {formatCredits(pace)}/day keeps you inside the allowance
          </span>
        }
      >
        Usage over time
      </SectionTitle>

      <div className="relative h-[150px] w-full">
        {/* Pace baseline. Dashed, behind the bars, unlabelled on the plot —
            the label lives in the header where it does not collide with data. */}
        <div
          aria-hidden
          className="absolute inset-x-0 border-t border-dashed"
          style={{
            bottom: `${(pace / max) * 100}%`,
            borderColor: "var(--chart-divider)",
          }}
        />

        <div className="flex h-full items-end gap-[2px]">
          {rows.map((row) => {
            const isHovered = hovered === row.day;
            return (
              <div
                key={row.day}
                onMouseEnter={() => setHovered(row.day)}
                onMouseLeave={() => setHovered(null)}
                className="flex h-full flex-1 cursor-default flex-col justify-end"
                style={{ minWidth: 4 }}
              >
                <span
                  className="flex w-full flex-col-reverse overflow-hidden rounded-[2px] transition-[filter] duration-150"
                  style={{
                    height: `${(row.credits / max) * 100}%`,
                    filter: isHovered ? "brightness(1.15)" : undefined,
                    minHeight: row.credits > 0 ? 2 : 0,
                  }}
                >
                  {row.byFeature.map((seg) => (
                    <span
                      key={seg.feature}
                      style={{
                        height: `${(seg.credits / row.credits) * 100}%`,
                        background: palette.get(seg.feature)?.colour ?? OTHER_COLOUR,
                      }}
                    />
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Axis: first and last day only. A label under every bar in a 31-day
          month is unreadable at this width and adds nothing. */}
      <div
        className="font-data tnum mt-1.5 flex justify-between text-[10px]"
        style={{ color: "var(--text-muted)" }}
      >
        <span>{formatDate(rows[0].day)}</span>
        <span>{formatDate(rows[rows.length - 1].day)}</span>
      </div>

      {/* Legend + hover readout share one row, so the card does not jump in
          height when the pointer enters the plot. */}
      <div className="mt-3 min-h-[38px] border-t pt-2.5" style={{ borderColor: "var(--border)" }}>
        {hoveredRow ? (
          <div>
            <p className="text-[11.5px] font-semibold" style={{ color: "var(--text-primary)" }}>
              {formatDate(hoveredRow.day)} — {formatCredits(hoveredRow.credits)} credits
            </p>
            <p className="font-data tnum mt-0.5 text-[10.5px]" style={{ color: "var(--text-secondary)" }}>
              {hoveredRow.byFeature
                .map((s) => `${s.label} ${formatCredits(s.credits)}`)
                .join(" · ")}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {[...palette.entries()].map(([feature, meta]) => (
              <span
                key={feature}
                className="flex items-center gap-1.5 text-[10.5px]"
                style={{ color: "var(--text-secondary)" }}
              >
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-[2px]"
                  style={{ background: meta.colour }}
                />
                {meta.label}
              </span>
            ))}
            {overPace > 0 && (
              <span className="ml-auto text-[10.5px]" style={{ color: "var(--text-muted)" }}>
                {overPace} {overPace === 1 ? "day" : "days"} above the pace line
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

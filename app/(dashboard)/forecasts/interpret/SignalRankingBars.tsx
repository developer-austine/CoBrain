"use client";

import React, { useMemo, useState } from "react";
import { isWorsening, signalLabel } from "@/lib/interpret/registry";
import { magnitudePhrase } from "@/lib/interpret/thresholds";
import { medianChange, type Forecast, type ForecastTargetKey } from "@/lib/forecast/types";
import { SigmaValue } from "./SigmaValue";

/**
 * "Which signals need attention" (spec §6) — level 1 of the ladder.
 *
 * The portfolio view, above the hero card: which of the six is the problem,
 * answered before anyone drills into one. A page that only ever shows the
 * selected signal makes the reader click all six to find that out.
 *
 * Bars diverge from a zero line and are coloured by POLARITY, not sign. A
 * falling bus factor and a rising burnout risk are both bad news and both go
 * right in coral, which is the whole point — sign alone would put them on
 * opposite sides and imply one is good.
 */

const VISIBLE = 6;

export function SignalRankingBars({
  forecasts,
  selectedId,
  onSelect,
  reduced,
}: {
  forecasts: Forecast[];
  selectedId: string | null;
  onSelect: (target: ForecastTargetKey) => void;
  reduced: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const ranked = useMemo(() => {
    return forecasts
      // A signal with no data is excluded rather than drawn as a zero-length
      // bar: an empty bar reads as "measured, and fine".
      .filter((f) => f.hasSignal)
      .map((f) => {
        const delta = medianChange(f);
        return {
          target: f.target,
          label: signalLabel(f.target),
          delta,
          worsening: isWorsening(f.target, delta),
        };
      })
      // Worst first, where "worst" is polarity-adjusted: worsening signals
      // ranked by size, then improving ones.
      .sort((a, b) => {
        const aScore = a.worsening ? Math.abs(a.delta) : -Math.abs(a.delta);
        const bScore = b.worsening ? Math.abs(b.delta) : -Math.abs(b.delta);
        return bScore - aScore || a.label.localeCompare(b.label);
      });
  }, [forecasts]);

  if (ranked.length === 0) return null;

  const max = Math.max(...ranked.map((r) => Math.abs(r.delta)), 0.1);
  const shown = expanded ? ranked : ranked.slice(0, VISIBLE);
  const top = ranked[0];
  const rest = ranked.slice(1);
  const restSteady = rest.every((r) => Math.abs(r.delta) < 0.25);

  return (
    <div
      className="rounded-2xl p-3"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        boxShadow: "var(--card-shadow)",
      }}
    >
      <div className="mb-2.5 px-0.5">
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: "var(--text-muted)" }}
        >
          Which signals need attention
        </p>
        <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
          Projected 13-week moves, ranked. Right of the line = worsening.
        </p>
      </div>

      <div className="flex flex-col">
        {shown.map((row, i) => {
          const pct = (Math.abs(row.delta) / max) * 50; // half-width each side
          const isTop = i === 0;
          const color = row.worsening
            ? isTop
              ? "var(--bar-worsening)"
              : "var(--bar-worsening-soft)"
            : isTop
              ? "var(--bar-improving)"
              : "var(--bar-improving-soft)";

          return (
            <button
              key={row.target}
              type="button"
              onClick={() => onSelect(row.target)}
              aria-pressed={row.target === selectedId}
              className="group grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-2 px-0.5 py-1.5 text-left"
              style={{ borderTop: i === 0 ? undefined : "1px solid var(--border)" }}
            >
              <span
                className="truncate text-[11.5px]"
                style={{
                  color:
                    row.target === selectedId ? "var(--accent)" : "var(--text-primary)",
                  fontWeight: row.target === selectedId ? 600 : 450,
                }}
              >
                {row.label}
              </span>

              {/* Track with a centre zero line; the bar grows out from it. */}
              <span
                className="relative block h-3 w-full rounded-[3px]"
                style={{ background: "var(--bar-track)" }}
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-1/2 w-px"
                  style={{ background: "var(--bar-zeroline)" }}
                />
                <span
                  className={reduced ? "absolute inset-y-0" : "bar-grow absolute inset-y-0"}
                  style={{
                    width: `${pct}%`,
                    background: color,
                    borderRadius: 2,
                    ...(row.worsening
                      ? { left: "50%" }
                      : { right: "50%" }),
                    animationDelay: reduced ? undefined : `${i * 60}ms`,
                  }}
                />
              </span>

              <span className="flex items-center gap-1">
                <SigmaValue
                  value={row.delta}
                  signalId={row.target}
                  className="text-[11px]"
                  style={{ color: row.worsening ? "var(--bar-worsening)" : "var(--bar-improving)" }}
                />
                {!row.worsening && Math.abs(row.delta) >= 0.25 && (
                  <span aria-hidden className="text-[10px]" style={{ color: "var(--bar-improving)" }}>
                    ✓
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {ranked.length > VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 w-full text-right text-[11px]"
          style={{ color: "var(--accent)" }}
        >
          {expanded ? "Show fewer" : `${ranked.length - VISIBLE} more →`}
        </button>
      )}

      <p
        className="mt-2 border-t pt-2 text-[11px] leading-relaxed"
        style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
      >
        {rest.length === 0
          ? `${top.label} is the only signal with data so far.`
          : `${top.label} is the outlier — everything else is ${restSteady ? "steady" : "drifting"}, this one is ${magnitudePhrase(top.delta)}.`}
      </p>
    </div>
  );
}

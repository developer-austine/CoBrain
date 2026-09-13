"use client";

import React, { useEffect, useState } from "react";

/**
 * The waiting state for the Forecasts page.
 *
 * Three dots run one continuous loop — a staggered wave, then a triangle, then
 * an orbit — under a status line that cycles through the work actually being
 * done. Deliberately not a card: a bordered box around a spinner reads as a
 * thing that has finished loading and contains a spinner. Bare and centred, it
 * reads as the page itself still arriving.
 *
 * The motion lives in globals.css (`loaderDot1..3`, `loaderOrbit`) because all
 * four tracks must share one 4.8s timeline; see the comment there for the
 * geometry.
 */

/**
 * Rotating status line.
 *
 * These name real stages of the forecasting service coming up rather than
 * counting down, because the wait is genuinely variable — a countdown that
 * overruns is worse than no countdown.
 */
const MESSAGES = ["Loading…", "Training…", "Just a sec…", "Validating…"] as const;

/** Long enough to read, short enough that the page never looks frozen. */
const MESSAGE_MS = 1800;

export function ForecastLoader({
  reduced = false,
  onRetry,
}: {
  reduced?: boolean;
  onRetry?: () => void;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setIndex((i) => (i + 1) % MESSAGES.length),
      MESSAGE_MS
    );
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-6 px-6">
      <Dots reduced={reduced} />

      {/* aria-live so a screen reader hears the stage change; the dots
          themselves are decorative and hidden. */}
      <p
        aria-live="polite"
        className="tnum text-[14px] font-medium"
        style={{ color: "var(--text-secondary)" }}
      >
        {/* Re-keyed so each message fades in rather than swapping in place. */}
        <span key={index} className={reduced ? undefined : "chart-fade"}>
          {MESSAGES[index]}
        </span>
      </p>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-[12px] font-medium underline decoration-dotted underline-offset-4"
          style={{ color: "var(--text-muted)" }}
        >
          Taking too long? Check again
        </button>
      )}
    </div>
  );
}

/**
 * The three dots.
 *
 * Absolutely positioned in a fixed 72px box so the row seats are real
 * coordinates the keyframes can translate from. A flex row would let the dots
 * reflow as they move, and the triangle would shear.
 */
function Dots({ reduced }: { reduced: boolean }) {
  return (
    <div
      aria-hidden
      className={reduced ? "relative h-[72px] w-[72px]" : "loader-orbit relative h-[72px] w-[72px]"}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={reduced ? "absolute block rounded-full" : `loader-dot-${i + 1} absolute block rounded-full`}
          style={{
            width: 10,
            height: 10,
            // Row seats at x = 18 / 36 / 54, vertically centred. The -5px
            // recentres each dot on its seat rather than hanging it off the
            // top-left corner.
            left: 18 + i * 18 - 5,
            top: 36 - 5,
            // Grey, and the one grey that is already legible in both themes —
            // a hard-coded #999 would vanish against the dark drawer surface.
            background: "var(--text-muted)",
          }}
        />
      ))}
    </div>
  );
}

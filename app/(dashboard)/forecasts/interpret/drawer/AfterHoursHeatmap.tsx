"use client";

import React, { useEffect, useState } from "react";
import type { Heatmap } from "@/lib/forecasts/heatmap";

/**
 * When the late work actually happens (spec §7.3g).
 *
 * Labelled "(observed)" because it is the one panel in the drawer that is not
 * a model output — these are counted events, and saying so is what lets a
 * reader trust it differently from the forecast above it.
 *
 * The browser's own UTC offset is sent with the request. "After hours" means
 * 6pm where the team sits, and nothing on record says where that is, so the
 * viewer's clock is the closest available proxy — stated in the caption rather
 * than assumed silently.
 */

/** Five-step ramp from §2; index by quantile of the cell against the max. */
const HEAT_STEPS = ["var(--heat-0)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"];

function heatStep(count: number, max: number): string {
  if (count <= 0 || max <= 0) return "var(--heat-0)";
  const ratio = count / max;
  const index = Math.min(HEAT_STEPS.length - 1, Math.ceil(ratio * HEAT_STEPS.length) - 1);
  return HEAT_STEPS[Math.max(0, index)];
}

export function AfterHoursHeatmap({ signalId }: { signalId: string }) {
  const [data, setData] = useState<Heatmap | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (signalId !== "burnout_risk") return;

    let cancelled = false;
    // Minutes EAST of UTC: getTimezoneOffset() returns the opposite sign.
    const tz = -new Date().getTimezoneOffset();

    fetch(`/api/forecasts/interpret/heatmap?signal=${signalId}&tz=${tz}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => {
        if (!cancelled) setData(json as Heatmap);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [signalId]);

  if (signalId !== "burnout_risk" || failed || !data) return null;

  // An empty grid would read as "no late work" rather than "nothing recorded".
  if (data.total === 0) {
    return (
      <Section>
        <p className="text-[10.5px]" style={{ color: "var(--text-secondary)" }}>
          No after-hours activity recorded in the last {data.weeks} weeks.
        </p>
      </Section>
    );
  }

  const max = Math.max(...data.cells.flat());

  return (
    <Section>
      <div className="flex flex-col gap-1">
        {data.cells.map((row, b) => (
          <div key={data.bands[b]} className="flex items-center gap-1">
            <span
              className="w-[62px] shrink-0 text-right text-[9.5px]"
              style={{ color: "var(--text-muted)" }}
            >
              {data.bands[b]}
            </span>
            {row.map((count, d) => (
              <span
                key={data.days[d]}
                title={`${data.days[d]} ${data.bands[b]} — ${count} ${count === 1 ? "event" : "events"}`}
                className="h-6 flex-1 rounded-[3px]"
                style={{ background: heatStep(count, max) }}
              />
            ))}
          </div>
        ))}

        <div className="flex items-center gap-1">
          <span className="w-[62px] shrink-0" />
          {data.days.map((day) => (
            <span
              key={day}
              className="flex-1 text-center text-[9.5px]"
              style={{ color: "var(--text-muted)" }}
            >
              {day}
            </span>
          ))}
        </div>
      </div>

      {data.hotspot && (
        <p className="mt-2 text-[10.5px]" style={{ color: "var(--text-secondary)" }}>
          {data.hotspot.day} {data.hotspot.band} is this team&apos;s late-work hotspot.
        </p>
      )}
      <p className="mt-1 text-[9.5px]" style={{ color: "var(--text-muted)" }}>
        Counted from {data.weeks} weeks of real activity, in your local time.
      </p>
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section>
      <p
        className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: "var(--text-muted)" }}
      >
        When the late work happens{" "}
        <span style={{ color: "var(--teal)" }}>(observed)</span>
      </p>
      {children}
    </section>
  );
}

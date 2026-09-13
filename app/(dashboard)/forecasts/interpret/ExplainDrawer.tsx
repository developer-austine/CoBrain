"use client";

import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Narrative } from "@/lib/interpret/narrative";
import { signalLabel } from "@/lib/interpret/registry";
import { coverageSentence } from "@/lib/interpret/thresholds";
import { formatSigma, type Forecast } from "@/lib/forecast/types";
import { useHighlight } from "./useHighlight";
import { AfterHoursHeatmap } from "./drawer/AfterHoursHeatmap";
import { PlainTermsCard } from "./PlainTermsCard";

/**
 * The Explain drawer (spec §7).
 *
 * Built directly rather than on Base UI: the spec rules out Radix and vaul, and
 * adding a third dialog library for one panel buys nothing this file does not
 * already do — focus trap, ESC, scrim, swipe, and the exact transform timing
 * §7.2 specifies, which is easier to control here than to override.
 *
 * Every section DEEPENS the rail card rather than repeating it. The rail says
 * what is happening; this says how the model knows, how wide the range is, and
 * how often it has been right.
 */

export type DrawerExtras = {
  calibration: { coverage: number; window: number } | null;
  driftAlarm: boolean;
  hits: boolean[];
};

const SWIPE_CLOSE_PX = 60;

export function ExplainDrawer({
  open,
  onClose,
  narrative,
  forecast,
  extras,
  reduced,
}: {
  open: boolean;
  onClose: () => void;
  narrative: Narrative | null;
  forecast: Forecast | null;
  extras: DrawerExtras | null;
  reduced: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);

  // ESC closes, and focus is trapped while open: a panel that can be tabbed
  // out of behind its own scrim is a keyboard dead end.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!narrative || !forecast) return null;

  return (
    <>
      {/* Scrim. Overlay only — the layout beneath is never pushed. */}
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 transition-opacity"
        style={{
          background: "var(--drawer-scrim)",
          backdropFilter: "blur(2px)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transitionDuration: reduced ? "0ms" : "280ms",
        }}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${signalLabel(forecast.target)} forecast explained`}
        data-open={open}
        onTouchStart={(e) => (touchStartX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          const start = touchStartX.current;
          touchStartX.current = null;
          if (start !== null && e.changedTouches[0].clientX - start > SWIPE_CLOSE_PX) {
            onClose();
          }
        }}
        className="fixed inset-y-0 right-0 z-50 flex flex-col overflow-y-auto"
        style={{
          width: "clamp(360px, 36vw, 560px)",
          background: "var(--drawer-bg)",
          borderLeft: "1px solid var(--drawer-border)",
          boxShadow: "var(--drawer-shadow)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          opacity: reduced ? (open ? 1 : 0) : 1,
          transition: reduced
            ? "opacity 150ms linear"
            : "transform 280ms cubic-bezier(.32,.72,.24,1)",
          visibility: open ? "visible" : "hidden",
        }}
      >
        <header
          className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b px-4 py-3"
          style={{ background: "var(--drawer-bg)", borderColor: "var(--drawer-border)" }}
        >
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "var(--text-muted)" }}
            >
              Forecast explained
            </p>
            <p className="mt-0.5 text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
              {signalLabel(forecast.target)} · next 13 weeks
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </header>

        {/* Body mounts only once opened. The panel itself stays in the tree so
            it can transition, but its children run data fetches — rendering
            them behind a hidden panel means every visit to this page pays for
            a drawer nobody opened. */}
        {open && (
        <div className="flex flex-col gap-5 px-4 py-4">
          <KpiStrip narrative={narrative} extras={extras} />
          {/* Sits below the KPI strip rather than at the top: the numbers are
              what the reader came for, the prose is what explains them. */}
          <PlainTermsCard
            narrative={narrative}
            signalId={forecast.target}
            hasSignal={forecast.hasSignal}
            bare
          />
          <DriverBars narrative={narrative} reduced={reduced} />
          <ScenarioRange narrative={narrative} forecast={forecast} />
          <MomentumBars narrative={narrative} forecast={forecast} reduced={reduced} />
          {extras && extras.hits.length > 0 && (
            <TrackRecord hits={extras.hits} coverage={extras.calibration?.coverage ?? 0} />
          )}
          {/* Burnout only; the component returns null for every other signal
              and while the fetch is in flight. */}
          <AfterHoursHeatmap signalId={forecast.target} />
          <ExplainerCallout narrative={narrative} />
        </div>
        )}
      </div>
    </>
  );
}

/* ── §7.3b KPI strip ─────────────────────────────────────────────────────── */
function KpiStrip({
  narrative,
  extras,
}: {
  narrative: Narrative;
  extras: DrawerExtras | null;
}) {
  const moveColor = narrative.facts.worsening
    ? "var(--bar-worsening)"
    : "var(--bar-improving)";

  const tiles: { label: string; value: string; sub: string; color?: string }[] = [
    { label: "Projected move", value: narrative.kpis.projectedMove, sub: narrative.kpis.movePlain, color: moveColor },
    { label: "Range", value: narrative.kpis.range, sub: narrative.kpis.rangePlain },
    {
      label: "History",
      value: narrative.kpis.history,
      sub: narrative.kpis.historyPlain,
      color: narrative.kpis.historyPlain === "still learning" ? "var(--amber)" : undefined,
    },
  ];

  // Omitted rather than shown as "—": a blank accuracy tile invites the reader
  // to assume the model has a track record it has not earned yet.
  if (narrative.kpis.accuracy) {
    tiles.push({
      label: "Past accuracy",
      value: narrative.kpis.accuracy,
      sub: narrative.kpis.accuracyPlain ?? "lands in band",
    });
  }
  void extras;

  return (
    <div className="grid grid-cols-2 gap-2">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg p-2.5" style={{ background: "var(--kpi-tile-bg)" }}>
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
             style={{ color: "var(--text-muted)" }}>
            {t.label}
          </p>
          <p className="tnum mt-1 text-[13px] font-semibold"
             style={{ color: t.color ?? "var(--text-primary)" }}>
            {t.value}
          </p>
          <p className="mt-0.5 text-[10px]" style={{ color: "var(--text-secondary)" }}>
            {t.sub}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ── §7.3c Driver bars, each with its own sentence ───────────────────────── */
function DriverBars({ narrative, reduced }: { narrative: Narrative; reduced: boolean }) {
  const { highlight, setHighlight } = useHighlight();
  const drivers = narrative.drivers.slice(0, 5);
  if (drivers.length === 0) return null;

  const max = Math.max(...drivers.map((d) => d.weight), 0.01);
  const color = narrative.facts.worsening ? "var(--bar-worsening)" : "var(--bar-improving)";

  return (
    <Section title="What drove this">
      <ul className="flex flex-col gap-2.5">
        {drivers.map((d, i) => {
          const lit = highlight?.type === "driver" && highlight.label === d.label;
          return (
            <li
              key={d.label}
              onMouseEnter={() => setHighlight({ type: "driver", label: d.label })}
              onMouseLeave={() => setHighlight(null)}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11.5px]" style={{ color: "var(--text-primary)" }}>
                  {d.label}
                </span>
                <span className="tnum text-[10.5px]" style={{ color: "var(--text-muted)" }}>
                  {(d.share * 100).toFixed(0)}%
                </span>
              </div>
              <span className="mt-1 block h-2 w-full rounded-[3px]" style={{ background: "var(--bar-track)" }}>
                <span
                  className={reduced ? "block h-full rounded-[3px]" : "bar-grow block h-full rounded-[3px]"}
                  style={{
                    width: `${(d.weight / max) * 100}%`,
                    background: i === 0 ? color : `color-mix(in srgb, ${color} 55%, transparent)`,
                    filter: lit ? "brightness(1.15)" : undefined,
                    animationDelay: reduced ? undefined : `${i * 60}ms`,
                  }}
                />
              </span>
              <p className="mt-1 text-[10.5px] leading-snug" style={{ color: "var(--text-secondary)" }}>
                {d.sentence}
              </p>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/* ── §7.3d Scenario range ────────────────────────────────────────────────── */
function ScenarioRange({ narrative, forecast }: { narrative: Narrative; forecast: Forecast }) {
  const p10 = forecast.quantiles["0.1"]?.at(-1) ?? 0;
  const p50 = forecast.quantiles["0.5"]?.at(-1) ?? 0;
  const p90 = forecast.quantiles["0.9"]?.at(-1) ?? 0;
  const span = p90 - p10 || 1;
  const pos = (v: number) => ((v - p10) / span) * 100;

  return (
    <Section title="Where it could land">
      <div className="relative mt-1 h-2 w-full rounded-full"
           style={{ background: "var(--bar-track)" }}>
        <span
          className="absolute inset-y-0 rounded-full"
          style={{
            left: 0,
            right: 0,
            background: `color-mix(in srgb, var(--accent) 22%, transparent)`,
          }}
        />
        {[p10, p50, p90].map((v, i) => (
          <span
            key={i}
            className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2"
            style={{ left: `${pos(v)}%`, background: i === 1 ? "var(--accent)" : "var(--border-strong)" }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10.5px]" style={{ color: "var(--text-secondary)" }}>
        <span className="tnum">Bear {formatSigma(p10)}</span>
        <span className="tnum" style={{ color: "var(--text-primary)" }}>Base {formatSigma(p50)}</span>
        <span className="tnum">Bull {formatSigma(p90)}</span>
      </div>
      {narrative.anchor && (
        <p className="mt-1.5 text-[10.5px]" style={{ color: "var(--text-muted)" }}>
          Base is close to the week of {narrative.anchor.label}.
        </p>
      )}
    </Section>
  );
}

/* ── §7.3e Momentum ──────────────────────────────────────────────────────── */
function MomentumBars({
  narrative,
  forecast,
  reduced,
}: {
  narrative: Narrative;
  forecast: Forecast;
  reduced: boolean;
}) {
  const values = forecast.history.map((h) => h.value);
  const deltas: number[] = [];
  for (let i = 1; i < values.length; i++) deltas.push(values[i] - values[i - 1]);
  const recent = deltas.slice(-10);
  if (recent.length === 0) return null;

  const max = Math.max(...recent.map(Math.abs), 0.01);
  const base = narrative.facts.worsening ? "var(--bar-worsening)" : "var(--bar-improving)";

  return (
    <Section title="Recent momentum">
      {/* Vertical bars for time, per §8: the fan owns level, these own change. */}
      <div className="flex h-14 items-center gap-1">
        {recent.map((d, i) => {
          const h = (Math.abs(d) / max) * 100;
          const latest = i === recent.length - 1;
          return (
            <span key={i} className="relative flex h-full flex-1 flex-col justify-center">
              <span aria-hidden className="absolute inset-x-0 top-1/2 h-px"
                    style={{ background: "var(--bar-zeroline)" }} />
              <span
                className={reduced ? "absolute w-full" : "bar-grow absolute w-full"}
                style={{
                  height: `${h / 2}%`,
                  background: latest ? base : `color-mix(in srgb, ${base} 45%, transparent)`,
                  borderRadius: 1,
                  ...(d >= 0 ? { bottom: "50%" } : { top: "50%" }),
                  animationDelay: reduced ? undefined : `${i * 40}ms`,
                }}
              />
            </span>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10.5px]" style={{ color: "var(--text-secondary)" }}>
        {narrative.momentum.sentence ?? "No clear run in the last few weeks."}
      </p>
    </Section>
  );
}

/* ── §7.3f Track record ──────────────────────────────────────────────────── */
function TrackRecord({ hits, coverage }: { hits: boolean[]; coverage: number }) {
  const inBand = hits.filter(Boolean).length;
  return (
    <Section title="Track record">
      <div className="flex items-center gap-1">
        {hits.map((hit, i) => (
          <span
            key={i}
            className="h-4 flex-1 rounded-[2px]"
            style={{ background: hit ? "var(--bar-improving-soft)" : "var(--bar-worsening-soft)" }}
          />
        ))}
        <span className="tnum ml-2 shrink-0 text-[10.5px]" style={{ color: "var(--text-muted)" }}>
          {inBand} of {hits.length} in range
        </span>
      </div>
      <p className="mt-1.5 text-[10.5px]" style={{ color: "var(--text-secondary)" }}>
        {coverageSentence(coverage)}
      </p>
    </Section>
  );
}

/* ── §7.3h Callout ───────────────────────────────────────────────────────── */
function ExplainerCallout({ narrative }: { narrative: Narrative }) {
  // The caveats are S4; they are re-stated here because the drawer is often
  // opened directly from a deep link without the rail card being read.
  const caveats = narrative.sentences.filter(
    (s) => s.includes("early read") || s.includes("stale model")
  );

  // Plain text on the drawer's own surface: no fill, no rounding, no tint. The
  // amber panel read as a warning about the forecast above it, which is the
  // opposite of what a footnote explaining the units should do. The hairline
  // rule is a separator, not a background — without it this runs straight into
  // the section above.
  return (
    <div
      className="border-t pt-3 text-[10.5px] leading-relaxed"
      style={{
        borderColor: "var(--drawer-border)",
        color: "var(--text-secondary)",
      }}
    >
      <p>
        Everything here is measured in σ — how far this team sits from its own
        normal week, not from any other company. The bars rank what moved the
        forecast; the range is where it could realistically land.
      </p>
      {caveats.map((c) => (
        <p key={c} className="mt-1.5" style={{ color: "var(--text-primary)" }}>
          {c}
        </p>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p
        className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: "var(--text-muted)" }}
      >
        {title}
      </p>
      {children}
    </section>
  );
}

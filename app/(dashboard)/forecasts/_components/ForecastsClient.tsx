"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Activity, BrainCircuit, Check, Loader2, TrendingUp } from "lucide-react";
import { FanChart } from "@/components/forecast/FanChart";
import { buildNarrative, type Narrative } from "@/lib/interpret/narrative";
import { HighlightProvider } from "../interpret/useHighlight";
import { SignalRankingBars } from "../interpret/SignalRankingBars";
import { ExplainHandle } from "../interpret/ExplainHandle";
import { ExplainDrawer, type DrawerExtras } from "../interpret/ExplainDrawer";
import { ForecastLoader } from "./ForecastLoader";
import { SignalRow } from "@/components/forecast/SignalRow";
import { SigmaTicker } from "@/components/forecast/SigmaTicker";
import { usePrefersReducedMotion } from "@/lib/forecast/useChartPalette";
import {
  bandWidth,
  formatSigma,
  medianChange,
  TARGET_META,
  type Forecast,
  type ForecastBundle,
} from "@/lib/forecast/types";

/**
 * Per-signal identity hues for the row icon chips (§4.3). Fixed slot order, so
 * a signal keeps its colour however the list is sorted. Everything else on the
 * page is neutral or --accent: one accent per view (§1.2).
 */
const SIGNAL_HUE: Record<string, string> = {
  burnout_risk: "var(--coral)",
  delivery_velocity: "var(--accent)",
  bus_factor: "var(--teal)",
  review_latency: "var(--amber)",
  topic_shift: "var(--ice)",
  decision_cadence: "var(--accent)",
};

/** Below this many observed weeks the bands are widened (CFG.MIN_WEEKS_REQUIRED). */
const MIN_WEEKS_REQUIRED = 12;

type Props = { bundle: ForecastBundle | null; error?: string; hint?: string };

/**
 * One domain shared by every range bar, so a wide outlook is drawn wide.
 * Per-row scaling would normalise every band to the same length and destroy the
 * only thing the bar exists to show.
 */
function sharedDomain(forecasts: Forecast[]): [number, number] {
  const values = forecasts
    .filter((f) => f.hasSignal)
    .flatMap((f) => [f.quantiles["0.1"].at(-1) ?? 0, f.quantiles["0.9"].at(-1) ?? 0]);

  if (values.length === 0) return [-1, 1];
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, 0);
  const pad = (hi - lo) * 0.1 || 0.2;
  return [lo - pad, hi + pad];
}

function Card({ children, className = "", style }: React.PropsWithChildren<{
  className?: string;
  style?: React.CSSProperties;
}>) {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        boxShadow: "var(--card-shadow)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function ForecastsClient({ bundle, error, hint }: Props) {
  const forecasts = useMemo(() => bundle?.forecasts ?? [], [bundle]);
  const reduced = usePrefersReducedMotion();

  const [selectedKey, setSelectedKey] = useState(
    forecasts.find((f) => f.hasSignal)?.target ?? forecasts[0]?.target ?? null
  );
  const [writeState, setWriteState] = useState<"idle" | "writing" | "written">("idle");
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Keyed by signal so stale extras are never shown against a new one. The
  // alternative — clearing on switch — means a synchronous setState inside the
  // effect, which the React Compiler rejects and which briefly renders a panel
  // whose numbers belong to the previous signal.
  const [extrasFor, setExtrasFor] = useState<{ target: string; data: DrawerExtras } | null>(null);
  const [handlePulse, setHandlePulse] = useState(false);
  const seenVerdict = useRef<string | null>(null);

  const selected = useMemo(
    () => forecasts.find((f) => f.target === selectedKey) ?? forecasts[0] ?? null,
    [forecasts, selectedKey]
  );
  const domain = useMemo(() => sharedDomain(forecasts), [forecasts]);

  /**
   * The narrative for the selected signal (spec §3).
   *
   * Recomputed from the payload on every poll and every signal switch — it is
   * a pure function, so this costs nothing and can never drift from the chart
   * it sits beside.
   */
  const narrative = useMemo<Narrative | null>(() => {
    if (!selected?.hasSignal) return null;
    return buildNarrative({
      signalId: selected.target,
      observed: selected.history,
      forecast: selected.weeks.map((week, i) => ({
        week,
        p10: selected.quantiles["0.1"]?.[i] ?? 0,
        p50: selected.quantiles["0.5"]?.[i] ?? 0,
        p90: selected.quantiles["0.9"]?.[i] ?? 0,
      })),
      driverWeights: selected.drivers.map((d) => ({
        featureId: d.feature,
        weight: d.weight,
      })),
      weeksObserved: selected.observedWeeks,
      minWeeksRequired: MIN_WEEKS_REQUIRED,
    });
  }, [selected]);
  const withSignal = forecasts.filter((f) => f.hasSignal).length;

  /**
   * Calibration and drift for the selected signal.
   *
   * Fetched separately from the forecast because it comes from the monitoring
   * tables, and because the page must still render its client-side sections if
   * this fails — an absent accuracy tile is a smaller loss than a blank panel.
   */
  useEffect(() => {
    // Only once the drawer is actually opened: this hits the monitoring tables
    // through a tenant-scoped transaction, and prefetching it for every visitor
    // who never opens the panel is pure load on the connection pool.
    if (!drawerOpen || !selected?.hasSignal) return;

    const target = selected.target;
    let cancelled = false;

    fetch(`/api/forecasts/interpret/${target}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setExtrasFor({ target, data: data as DrawerExtras });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [drawerOpen, selected?.target, selected?.hasSignal]);

  // Only surface extras that belong to the signal currently on screen.
  const extras =
    extrasFor && extrasFor.target === selected?.target ? extrasFor.data : null;

  /**
   * Handle pulse: three cycles, only on a verdict the reader has not seen.
   * Skipped on first render — everything is new then, and pulsing at a reader
   * who just arrived teaches them the dot means nothing.
   */
  useEffect(() => {
    if (!narrative) return;
    const key = narrative.verdict.text;
    if (seenVerdict.current !== null && seenVerdict.current !== key) {
      setHandlePulse(true);
      const id = setTimeout(() => setHandlePulse(false), 3 * 2200);
      return () => clearTimeout(id);
    }
    seenVerdict.current = key;
  }, [narrative]);

  // The success state reverts on its own (§4.1). A button stuck on "written"
  // reads as though clicking again would do nothing.
  useEffect(() => {
    if (writeState !== "written") return;
    const id = setTimeout(() => setWriteState("idle"), 1800);
    return () => clearTimeout(id);
  }, [writeState]);

  const writeToBrain = useCallback(async () => {
    if (!selected) return;
    setWriteState("writing");
    try {
      const res = await fetch("/api/forecasts/write-to-brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: selected.target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not write to the Brain");
      setWriteState("written");
      toast.success(`Wrote “${data.block.title}” to the Brain`);
    } catch (err) {
      setWriteState("idle");
      toast.error(err instanceof Error ? err.message : "Write failed");
    }
  }, [selected]);

  // The engine is still coming up: a bare centred loader, no card. This is a
  // wait, not a result, and boxing it would present the waiting as the answer.
  if (error) {
    return (
      <ForecastLoader
        reduced={reduced}
        onRetry={() => window.location.reload()}
      />
    );
  }

  // Genuinely nothing to forecast. Kept as a card with its call to action —
  // this is a finished state that needs a decision from the reader, not a
  // wait, so animating it would promise something that is never going to
  // arrive on its own.
  if (forecasts.length === 0) {
    return (
      <Card className="p-10 text-center">
        <div
          className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl"
          style={{ background: "var(--accent-soft)" }}
        >
          <TrendingUp className="h-5 w-5" style={{ color: "var(--accent)" }} />
        </div>
        <p
          className="mt-4 text-[15px] font-bold"
          style={{ color: "var(--text-primary)" }}
        >
          Not enough history yet
        </p>
        <p
          className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          {hint ??
            "Forecasts need a few weeks of activity before they mean anything. Connect a source and CoBrain will start building them in the background."}
        </p>
        <Link
          href="/connectors"
          className="mt-5 inline-block rounded-xl px-4 py-2 text-[13px] font-semibold text-white"
          style={{ background: "var(--accent)" }}
        >
          Connect a source
        </Link>
      </Card>
    );
  }

  const meta = selected ? TARGET_META[selected.target] : null;
  const hue = selected ? SIGNAL_HUE[selected.target] : "var(--accent)";
  const change = selected ? medianChange(selected) : 0;
  const flat = Math.abs(change) < 0.05;
  const worse = Boolean(
    selected && !flat && (change > 0) === TARGET_META[selected.target].higherIsWorse
  );
  const headlineColor = flat
    ? "var(--text-muted)"
    : worse
      ? "var(--coral)"
      : "var(--teal)";

  const topDriver = selected?.drivers[0]?.weight || 1;
  // Re-keying on the selected signal restarts the crossfade and the chart
  // draw-in together, so a row click reads as one transition rather than the
  // data quietly changing underneath.
  const switchKey = selected?.target ?? "none";

  return (
    <HighlightProvider>
    <div className="mx-auto grid w-full min-w-0 max-w-[1400px] grid-cols-1 gap-4 px-4 pb-8 sm:px-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        {/* Level 1 of the ladder: which signal needs attention, before any
            drilling. */}
        <SignalRankingBars
          forecasts={forecasts}
          selectedId={selected?.target ?? null}
          onSelect={setSelectedKey}
          reduced={reduced}
        />

        <Card className="overflow-hidden">
          <div className="px-4 pb-3 pt-3.5" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="min-w-0">
                <p
                  className="text-[10px] font-semibold uppercase tracking-[0.16em]"
                  style={{ color: "var(--text-muted)" }}
                >
                  Organisational forecast
                </p>
                <h2
                  className="mt-1 flex items-center gap-2 text-[16px] font-semibold leading-tight"
                  style={{ color: "var(--text-primary)" }}
                >
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: hue }} />
                  {meta?.label}
                </h2>
                <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-secondary)" }}>
                  {meta?.description}
                </p>
              </div>

              {selected?.hasSignal && (
                <div className="text-right">
                  <SigmaTicker
                    value={change}
                    flat={flat}
                    className="block text-[24px] font-semibold leading-none"
                    style={{ color: headlineColor }}
                  />
                  <p className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
                    projected 13-week move
                  </p>
                </div>
              )}
            </div>

            {/* §4.4 meta row */}
            <div
              className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11px]"
              style={{ color: "var(--text-muted)" }}
            >
              <span className="tnum">{selected?.observedWeeks ?? 0}w observed</span>
              <span aria-hidden>·</span>
              <span className="tnum">13w horizon</span>
              <span aria-hidden>·</span>
              <span className="tnum">
                {selected ? bandWidth(selected).toFixed(2) : "0.00"}σ band
              </span>

              {selected?.hasSignal && selected.lowConfidence && (
                <span
                  title={`Only ${selected.observedWeeks} of ${MIN_WEEKS_REQUIRED} minimum weeks observed — bands are widened.`}
                  className="rounded-full px-2.5 py-0.5"
                  style={{
                    border: "1px solid var(--amber)",
                    color: "var(--amber)",
                    background: "color-mix(in srgb, var(--amber) 10%, transparent)",
                  }}
                >
                  Low confidence
                </span>
              )}
              {selected && !selected.hasSignal && (
                <span
                  className="rounded-full px-2.5 py-0.5"
                  style={{
                    border: "1px solid var(--border-strong)",
                    color: "var(--text-secondary)",
                    background: "var(--bg-inset)",
                  }}
                >
                  No source data
                </span>
              )}
            </div>
          </div>

          <div
            key={switchKey}
            className={reduced ? "px-3 pb-3 pt-3 sm:px-4" : "chart-fade px-3 pb-3 pt-3 sm:px-4"}
          >
            {selected?.hasSignal ? (
              <>
                <FanChart forecast={selected} hue={hue} height={280} />
              </>
            ) : (
              <div className="flex h-[280px] flex-col items-center justify-center px-8 text-center">
                <p
                  className="text-[14px] font-semibold"
                  style={{ color: "var(--text-primary)" }}
                >
                  No observed data for this signal
                </p>
                <p
                  className="mt-1.5 max-w-sm text-[13px] leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Connect the source that produces it and rebuild features — a
                  forecast over an empty series would look confident and mean nothing.
                </p>
              </div>
            )}
          </div>
        </Card>

        {/*  E: signals list*/}
        <Card className="p-3">
          <div className="mb-2 flex items-center justify-between px-0.5">
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "var(--text-muted)" }}
            >
              Signals
            </p>
            <p className="tnum text-[11px]" style={{ color: "var(--text-muted)" }}>
              {withSignal}/{forecasts.length} with data
            </p>
          </div>

          <div className="flex flex-col">
            {forecasts.map((f) => (
              <SignalRow
                key={f.target}
                forecast={f}
                hue={SIGNAL_HUE[f.target]}
                selected={f.target === selected?.target}
                domain={domain}
                onSelect={() => setSelectedKey(f.target)}
              />
            ))}
          </div>
        </Card>
      </div>

      {/*  C + D: scenarios and drivers  */}
      <aside
        key={switchKey}
        className={reduced ? "flex min-w-0 flex-col gap-4" : "chart-fade flex min-w-0 flex-col gap-4"}
      >
        {/* Level 2 ("In plain terms") now lives inside the Explain drawer. */}
        <Card className="p-3">
          <p
            className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: "var(--text-muted)" }}
          >
            Scenarios at horizon
          </p>

          {selected?.hasSignal ? (
            <>
              {/* Bull → Base → Bear, so the column reads as a price ladder
                  rather than three interchangeable tiles. */}
              {(
                [
                  ["0.9", "Bull", "P90"],
                  ["0.5", "Base", "P50"],
                  ["0.1", "Bear", "P10"],
                ] as const
              ).map(([q, name, code]) => {
                const isBase = q === "0.5";
                return (
                  <div
                    key={q}
                    className="mb-1.5 flex h-9 items-center justify-between rounded-lg px-2.5 transition-transform duration-[120ms] hover:translate-x-0.5"
                    style={{
                      background: isBase ? "var(--bg-selected)" : "var(--bg-inset)",
                      border: isBase
                        ? "1px solid color-mix(in srgb, var(--accent) 25%, transparent)"
                        : "1px solid transparent",
                    }}
                  >
                    <span className="flex items-baseline gap-1.5">
                      <span
                        className="text-[13px]"
                        style={{
                          color: isBase ? "var(--text-primary)" : "var(--text-secondary)",
                          fontWeight: isBase ? 600 : 500,
                        }}
                      >
                        {name}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {code}
                      </span>
                    </span>
                    <span
                      className="tnum text-[15px]"
                      style={{
                        color: isBase ? "var(--text-primary)" : "var(--text-secondary)",
                        fontWeight: isBase ? 600 : 400,
                      }}
                    >
                      {formatSigma(selected.quantiles[q].at(-1) ?? 0)}
                    </span>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={writeToBrain}
                disabled={writeState !== "idle"}
                className="mt-2.5 flex h-[38px] w-full items-center justify-center gap-2 rounded-lg text-[13px] font-semibold text-white transition-all duration-150 hover:-translate-y-px hover:brightness-110 active:scale-[0.98] disabled:cursor-default"
                style={{ background: writeState === "written" ? "var(--teal)" : "var(--accent)" }}
              >
                {writeState === "writing" && <Loader2 className="h-4 w-4 animate-spin" />}
                {writeState === "written" && <Check className="h-4 w-4" />}
                {writeState === "idle" && <BrainCircuit className="h-4 w-4" />}
                {writeState === "written"
                  ? "Written to Brain"
                  : writeState === "writing"
                    ? "Writing…"
                    : "Write to Brain"}
              </button>
            </>
          ) : (
            <p
              className="px-2 py-6 text-center text-[13px]"
              style={{ color: "var(--text-muted)" }}
            >
              Nothing to record for a signal with no data.
            </p>
          )}
        </Card>

        <Card className="p-3">
          <p
            className="mb-2 flex items-center gap-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: "var(--text-muted)" }}
          >
            <Activity className="h-3 w-3" />
            What drove this
          </p>

          <ul className="flex flex-col gap-2 px-0.5">
            {(selected?.drivers ?? []).slice(0, 6).map((d, i) => (
              <li
                key={d.feature}
                className="flex items-center gap-3"
                title={`weight ${d.weight.toFixed(4)}`}
              >
                {/* Sign matters (§4.2): the edge says which way this driver
                    pushes the metric, not merely how loudly it speaks. */}
                <span
                  className="min-w-0 flex-1 truncate pl-2 text-[13px]"
                  style={{
                    color: "var(--text-secondary)",
                    borderLeft: `4px solid ${worse ? "var(--coral)" : "var(--teal)"}`,
                  }}
                >
                  {d.feature.replace(/_/g, " ")}
                </span>
                <span
                  className="h-1.5 w-[104px] shrink-0 overflow-hidden rounded-[3px]"
                  style={{ background: "var(--bg-inset)" }}
                >
                  <span
                    className={
                      reduced ? "block h-full rounded-[3px]" : "bar-grow block h-full rounded-[3px]"
                    }
                    style={{
                      width: `${Math.max(6, Math.round((d.weight / topDriver) * 100))}%`,
                      background: "var(--accent)",
                      animationDelay: `${i * 60}ms`,
                    }}
                  />
                </span>
              </li>
            ))}
            {!selected?.drivers.length && (
              <li className="text-[13px]" style={{ color: "var(--text-muted)" }}>
                No driver weights recorded.
              </li>
            )}
          </ul>
        </Card>

        <p
          className="px-1 text-[11px] leading-relaxed"
          style={{ color: "var(--text-muted)" }}
        >
          Values are standard deviations from this company&apos;s own weekly baseline.
          The model normalises per tenant, so a 10-person team and a 500-person one
          stay comparable.
        </p>
      </aside>

      <ExplainHandle
        onOpen={() => {
          setDrawerOpen(true);
          setHandlePulse(false);
          if (narrative) seenVerdict.current = narrative.verdict.text;
        }}
        hasUnseenChange={handlePulse}
        pulsing={handlePulse}
        reduced={reduced}
      />

      <ExplainDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        narrative={narrative}
        forecast={selected ?? null}
        extras={extras}
        reduced={reduced}
      />
    </div>
    </HighlightProvider>
  );
}

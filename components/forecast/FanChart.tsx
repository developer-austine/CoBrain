"use client";

import React, { useMemo } from "react";
import Image from "next/image";
import { Wordmark } from "@/components/Logo";
import { signalArt } from "@/lib/forecast/signalArt";
import { TARGET_META } from "@/lib/forecast/types";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatSigma, quantileBands, type Forecast } from "@/lib/forecast/types";
import {
  useChartPalette,
  usePrefersReducedMotion,
  type ChartPalette,
} from "@/lib/forecast/useChartPalette";

/**
 * Quantile fan chart, drawn as a research plot.
 *
 * The reference this follows is a forecasting paper figure: a thin coverage
 * ribbon along the top, one dense bordered panel beneath it, nested prediction
 * intervals in flat greys, a dashed median, and the observed series over the
 * top in a single saturated colour. Everything is small and tight — the plot is
 * the content, and chrome that competes with it is chrome that is in the way.
 *
 * The band is still the point. A single line invites the reader to treat one
 * number as the answer; drawing the intervals makes the uncertainty part of the
 * reading.
 *
 * The nesting is data-driven, not decorative: `quantileBands` returns one entry
 * per interval the model actually produced. The trained checkpoint carries three
 * quantile heads (0.1 / 0.5 / 0.9), so today that is a single 10–90 band. Retrain
 * with more heads and the fan deepens here with no change to this file — which is
 * why the renderer loops rather than hard-coding two edges.
 */

type Row = {
  week: string;
  observed: number | null;
  p50: number | null;
  /** One [low, high] pair per interval, keyed `band0`, `band1`, … (outermost first). */
  [band: `band${number}`]: [number, number] | null;
  isLastObserved?: boolean;
  isHorizon?: boolean;
};

function buildRows(forecast: Forecast): { rows: Row[]; bandCount: number } {
  const bands = quantileBands(forecast);

  const rows: Row[] = forecast.history.map((h) => {
    const row: Row = { week: h.week, observed: h.value, p50: null };
    bands.forEach((_, i) => (row[`band${i}`] = null));
    return row;
  });

  // The boundary point belongs to BOTH series, so the forecast hands off from
  // where observation actually ended rather than floating away from it.
  const last = forecast.history.at(-1);
  if (last && rows.length) {
    const row = rows[rows.length - 1];
    row.p50 = last.value;
    row.isLastObserved = true;
    bands.forEach((_, i) => (row[`band${i}`] = [last.value, last.value]));
  }

  forecast.weeks.forEach((week, i) => {
    const row: Row = {
      week,
      observed: null,
      p50: forecast.quantiles["0.5"]?.[i] ?? null,
      isHorizon: i === forecast.weeks.length - 1,
    };
    bands.forEach((band, b) => {
      const lo = forecast.quantiles[band.lower]?.[i];
      const hi = forecast.quantiles[band.upper]?.[i];
      row[`band${b}`] = lo != null && hi != null ? [lo, hi] : null;
    });
    rows.push(row);
  });

  return { rows, bandCount: bands.length };
}

/** Nice-round σ ticks snapped to 0.9 multiples. */
function sigmaTicks(
  rows: Row[],
  bandCount: number
): { domain: [number, number]; ticks: number[] } {
  const values = rows.flatMap((r) => {
    const out = [r.observed, r.p50].filter((v): v is number => v != null);
    for (let i = 0; i < bandCount; i++) {
      const band = r[`band${i}`];
      if (band) out.push(band[0], band[1]);
    }
    return out;
  });
  if (values.length === 0) return { domain: [-0.9, 0.9], ticks: [-0.9, 0, 0.9] };

  const step = 0.9;
  const top = Math.ceil(Math.max(...values, 0) / step) * step || step;
  const bottom = Math.floor(Math.min(...values, 0) / step) * step;

  const ticks: number[] = [];
  for (let v = bottom; v <= top + 1e-9; v += step) ticks.push(Number(v.toFixed(2)));
  return { domain: [bottom, top], ticks };
}

function shortWeek(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The coverage ribbon (the reference's train/validation/test strip).
 *
 * Ours reports what the series is actually made of: weeks the model observed,
 * weeks it is projecting, and gaps where no activity was recorded. The gaps are
 * the reason this exists — a fan drawn over a series with holes in it looks
 * exactly as confident as one drawn over a complete series, and the reader
 * deserves to see the difference before reading the forecast.
 */
function CoverageRibbon({
  forecast,
  palette,
}: {
  forecast: Forecast;
  palette: ChartPalette;
}) {
  const segments = useMemo(() => {
    const observed = forecast.history.map((h) => ({
      kind: h.value == null ? ("missing" as const) : ("observed" as const),
    }));
    const projected = forecast.weeks.map(() => ({ kind: "forecast" as const }));
    return [...observed, ...projected];
  }, [forecast]);

  const fill = {
    observed: palette.observed,
    forecast: palette.p50,
    missing: palette.coral,
  } as const;

  return (
    <div className="flex h-[7px] w-full overflow-hidden rounded-[2px]">
      {segments.map((s, i) => (
        <span
          key={i}
          className="h-full flex-1"
          style={{ background: fill[s.kind], opacity: s.kind === "forecast" ? 0.55 : 1 }}
        />
      ))}
    </div>
  );
}

/**
 * The plot's title bar (the reference's team-badge row).
 *
 * The signal's artwork sits far left at a size you can identify without
 * reading — with six signals one click apart, "which one am I looking at" has
 * to be answerable from the picture alone. The brand sits far right as a
 * corner signature, the way a chart on a trading venue is stamped: small,
 * out of the data's way, and using the sidenav's own gradient rather than a
 * second copy of it.
 */
function ChartHeader({
  forecast,
  hue,
  palette,
}: {
  forecast: Forecast;
  hue: string;
  palette: ChartPalette;
}) {
  const src = signalArt(forecast.target);
  const label = TARGET_META[forecast.target]?.label ?? forecast.target;

  return (
    <div className="flex items-center justify-between gap-3 pb-1.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {src ? (
          <span
            className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full"
            style={{ border: `1.5px solid color-mix(in srgb, ${hue} 38%, transparent)` }}
          >
            <Image src={src} alt="" fill sizes="40px" className="object-cover" />
          </span>
        ) : (
          <span
            aria-hidden
            className="h-10 w-10 shrink-0 rounded-full"
            style={{
              background: `color-mix(in srgb, ${hue} 12%, transparent)`,
              border: `1.5px solid color-mix(in srgb, ${hue} 28%, transparent)`,
            }}
          />
        )}
        <span
          className="truncate text-[12px] font-medium"
          style={{ color: palette.textSecondary }}
        >
          {label}
        </span>
      </div>

      <Wordmark className="shrink-0 text-[13px]" />
    </div>
  );
}

/** A series' colour chip, paired with its name so colour is never the only cue. */
function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{ background: color }}
      className="inline-block h-2 w-2 shrink-0 rounded-full"
    />
  );
}

function FanTooltip({
  active,
  payload,
  label,
  palette,
  bandCount,
}: {
  active?: boolean;
  payload?: { payload: Row }[];
  label?: string;
  palette: ChartPalette;
  bandCount: number;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const isForecast = row.p50 !== null && row.observed === null;
  const outer = row[`band${0}`];
  const inner = bandCount > 1 ? row[`band${bandCount - 1}`] : null;

  return (
    <div
      className="rounded-[6px] px-2.5 py-1.5"
      style={{
        background: palette.bgCard,
        border: `1px solid ${palette.borderStrong}`,
        boxShadow: "0 6px 18px rgba(0,0,0,.16)",
      }}
    >
      <p className="mb-1 text-[10px]" style={{ color: palette.textMuted }}>
        {shortWeek(String(label))}
      </p>

      {row.observed !== null && (
        <p
          className="flex items-center gap-2 text-[11px]"
          style={{ color: palette.textSecondary }}
        >
          <Swatch color={palette.observed} />
          Observed
          <span className="tnum ml-auto" style={{ color: palette.textPrimary }}>
            {formatSigma(row.observed)}
          </span>
        </p>
      )}

      {isForecast && (
        <div className="flex min-w-[152px] flex-col gap-0.5">
          <p
            className="flex items-center gap-2 text-[11px] font-semibold"
            style={{ color: palette.textPrimary }}
          >
            <Swatch color={palette.p50} />
            Median
            <span className="tnum ml-auto">{formatSigma(row.p50 ?? 0)}</span>
          </p>
          {outer && (
            <p
              className="flex items-center gap-2 text-[11px]"
              style={{ color: palette.textSecondary }}
            >
              <Swatch color={palette.bandEdge} />
              10–90%
              <span className="tnum ml-auto">
                {formatSigma(outer[0])} … {formatSigma(outer[1])}
              </span>
            </p>
          )}
          {inner && inner !== outer && (
            <p
              className="flex items-center gap-2 text-[11px]"
              style={{ color: palette.textSecondary }}
            >
              <Swatch color={palette.bandEdge} />
              Inner
              <span className="tnum ml-auto">
                {formatSigma(inner[0])} … {formatSigma(inner[1])}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The legend sits inside the plot frame, top-left, as it does in the reference —
 * it belongs to the panel, and floating it outside costs a row of vertical space
 * the chart would rather spend on the data.
 */
function InsideLegend({
  palette,
  bands,
}: {
  palette: ChartPalette;
  bands: { label: string; opacity: number }[];
}) {
  return (
    <div
      className="pointer-events-none absolute left-[52px] top-[10px] z-10 flex flex-col gap-[3px] rounded-[3px] px-1.5 py-1"
      style={{
        background: `color-mix(in srgb, ${palette.bgCard} 82%, transparent)`,
        border: `1px solid ${palette.border}`,
      }}
    >
      {bands.map((b) => (
        <span
          key={b.label}
          className="flex items-center gap-1.5 text-[8.5px] leading-none"
          style={{ color: palette.textMuted }}
        >
          <span
            className="inline-block h-[7px] w-[14px] rounded-[1px]"
            style={{ background: palette.bandEdge, opacity: b.opacity }}
          />
          {b.label}
        </span>
      ))}
      <span
        className="flex items-center gap-1.5 text-[8.5px] leading-none"
        style={{ color: palette.textMuted }}
      >
        <span
          className="inline-block h-[2px] w-[14px]"
          style={{
            backgroundImage: `repeating-linear-gradient(90deg, ${palette.p50} 0 4px, transparent 4px 7px)`,
          }}
        />
        Median prediction
      </span>
      <span
        className="flex items-center gap-1.5 text-[8.5px] leading-none"
        style={{ color: palette.textMuted }}
      >
        <span className="inline-block h-[2px] w-[14px]" style={{ background: palette.observed }} />
        Observed
      </span>
    </div>
  );
}

export function FanChart({
  forecast,
  hue = "var(--accent)",
  height = 260,
}: {
  forecast: Forecast;
  /** The signal's identity colour, so the artwork ring matches its row. */
  hue?: string;
  height?: number;
}) {
  const palette = useChartPalette();
  const reduced = usePrefersReducedMotion();

  const { rows, bandCount } = useMemo(() => buildRows(forecast), [forecast]);
  const { domain, ticks } = useMemo(() => sigmaTicks(rows, bandCount), [rows, bandCount]);
  const bands = useMemo(() => quantileBands(forecast), [forecast]);
  const firstForecastWeek = forecast.weeks[0];

  // Outermost interval is faintest, innermost densest — the reference's grey
  // ramp, which reads as "more likely toward the middle" without a colour key.
  const bandOpacity = (i: number) =>
    bandCount === 1 ? 0.5 : 0.28 + (i / (bandCount - 1)) * 0.5;

  const legendBands = bands.map((b, i) => ({
    label: b.label,
    opacity: bandOpacity(i),
  }));

  // Re-keying on the target restarts the draw-in when the signal changes.
  const drawKey = forecast.target;

  return (
    <div key={drawKey} className="flex w-full flex-col gap-1">
      <ChartHeader forecast={forecast} hue={hue} palette={palette} />
      <CoverageRibbon forecast={forecast} palette={palette} />

      <div
        className="relative w-full"
        style={{ height, border: `1px solid ${palette.borderStrong}` }}
      >
        <InsideLegend palette={palette} bands={legendBands} />

        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 10, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={palette.grid} strokeWidth={0.5} />

            <XAxis
              dataKey="week"
              tickFormatter={shortWeek}
              tickLine={{ stroke: palette.borderStrong, strokeWidth: 0.5 }}
              axisLine={{ stroke: palette.borderStrong, strokeWidth: 0.5 }}
              interval="preserveStartEnd"
              minTickGap={44}
              tickSize={3}
              tick={{ fontSize: 9, fill: palette.textMuted }}
            />
            <YAxis
              domain={domain}
              ticks={ticks}
              tickFormatter={(v: number) => v.toFixed(1)}
              tickLine={{ stroke: palette.borderStrong, strokeWidth: 0.5 }}
              axisLine={{ stroke: palette.borderStrong, strokeWidth: 0.5 }}
              width={46}
              tickSize={3}
              tick={{ fontSize: 9, fill: palette.textMuted }}
              label={{
                value: "σ from baseline",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 9, fill: palette.textMuted, textAnchor: "middle" },
              }}
            />

            <Tooltip
              content={<FanTooltip palette={palette} bandCount={bandCount} />}
              cursor={{ stroke: palette.crosshair, strokeWidth: 0.5 }}
            />

            {firstForecastWeek && (
              <ReferenceLine
                x={firstForecastWeek}
                stroke={palette.divider}
                strokeWidth={0.75}
                strokeDasharray="3 3"
              />
            )}

            {/* Outermost first so the denser inner intervals paint on top. Flat
                fills, no gradient: a band that fades toward its edges suggests
                the tails are less real than the middle, which is the opposite of
                what a prediction interval means. */}
            {bands.map((band, i) => (
              <Area
                key={band.label}
                dataKey={`band${i}`}
                stroke="none"
                fill={palette.bandEdge}
                fillOpacity={bandOpacity(i)}
                isAnimationActive={false}
                className={reduced ? undefined : "fan-in"}
                connectNulls
              />
            ))}

            <Line
              dataKey="p50"
              className={reduced ? undefined : "draw-forecast"}
              stroke={palette.p50}
              strokeWidth={1.25}
              strokeDasharray="5 3"
              dot={false}
              activeDot={{ r: 2.5 }}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              dataKey="observed"
              className={reduced ? undefined : "draw-observed"}
              stroke={palette.observed}
              strokeWidth={1}
              dot={false}
              activeDot={{ r: 2.5 }}
              isAnimationActive={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

"use client";

import React, { useId } from "react";

/**
 * A signal's recent shape, at row scale.
 *
 * Kalshi gives every market row a face — you recognise the row before reading
 * it. A coloured dot carries identity but says nothing about the thing itself;
 * the last few months of the series says both, and it is the one visual that
 * makes two rows comparable at a glance.
 *
 * Hand-rolled SVG rather than a chart library: at 96×28 with no axes, ticks or
 * tooltip, a charting runtime per row is all cost and no benefit.
 */

type Props = {
  values: number[];
  color: string;
  width?: number;
  height?: number;
  /** Draw the forecast median as a dashed continuation of the observed line. */
  forecast?: number[];
};

export function Sparkline({ values, color, width = 96, height = 28, forecast = [] }: Props) {
  const gradientId = useId();

  const all = [...values, ...forecast];
  if (all.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden className="opacity-30">
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const pad = 3;

  const x = (i: number) => (i / (all.length - 1)) * width;
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);

  const observedPath = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");

  // The forecast continues from the last observed point, so the eye reads one
  // line rather than two disconnected fragments.
  const forecastPath = forecast.length
    ? [
        `M${x(values.length - 1)},${y(values[values.length - 1])}`,
        ...forecast.map((v, i) => `L${x(values.length + i)},${y(v)}`),
      ].join(" ")
    : "";

  const areaPath = `${observedPath} L${x(values.length - 1)},${height} L0,${height} Z`;

  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>

      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={observedPath}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {forecastPath && (
        <path
          d={forecastPath}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray="5 4"
          strokeOpacity={0.65}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/**
 * Where the outcome sits between bear and bull.
 *
 * The table's two numeric columns give the endpoints but not the shape: a
 * ±0.1σ band and a ±2σ band read the same in text. This draws the interval to
 * a scale shared by every row, so a wide outlook looks wide.
 */
export function RangeBar({
  p10,
  p50,
  p90,
  domain,
  color,
  width = 88,
}: {
  p10: number;
  p50: number;
  p90: number;
  /** [min, max] shared across rows so bars are comparable. */
  domain: [number, number];
  color: string;
  width?: number;
}) {
  const [lo, hi] = domain;
  const span = hi - lo || 1;
  const at = (v: number) => Math.max(0, Math.min(1, (v - lo) / span)) * width;

  const left = at(p10);
  const right = at(p90);
  const mid = at(p50);
  const zero = at(0);

  return (
    <svg width={width} height={16} aria-hidden className="overflow-visible">
      <line x1={0} y1={8} x2={width} y2={8} strokeWidth={1} style={{ stroke: "var(--border-strong)" }} />
      {lo < 0 && hi > 0 && (
        <line
          x1={zero}
          y1={2}
          x2={zero}
          y2={14}
          strokeWidth={1}
          strokeDasharray="2 2"
          style={{ stroke: "var(--text-muted)" }}
        />
      )}
      <rect
        x={left}
        y={5}
        width={Math.max(2, right - left)}
        height={6}
        rx={3}
        fill={color}
        fillOpacity={0.22}
      />
      <circle cx={mid} cy={8} r={3} fill={color} />
    </svg>
  );
}

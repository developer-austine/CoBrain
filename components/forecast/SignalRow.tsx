"use client";

import React from "react";
import Image from "next/image";
import { RangeBar, Sparkline } from "./Sparkline";
import { signalArt } from "@/lib/forecast/signalArt";
import { medianChange, TARGET_META, type Forecast } from "@/lib/forecast/types";
import { microSummary } from "@/lib/interpret/narrative";
import { SigmaValue } from "@/app/(dashboard)/forecasts/interpret/SigmaValue";

/**
 * One signal, as a row (spec §4.3).
 *
 * A market row is recognisable before it is read: an identity slot on the left,
 * one number carrying the answer on the right, and the shape of the thing in
 * between. The sparkline does the real work — it carries identity AND the
 * signal's behaviour, and makes two rows comparable at a glance.
 *
 * The identity slot is intentionally empty. It holds its size so the rows stay
 * aligned and the artwork can drop straight in, rather than the layout shifting
 * when it arrives.
 */

/**
 * The signal's artwork, as a circular avatar.
 *
 * Circular and clipped rather than square: the source images have different
 * aspect ratios and framing, and a circle plus `object-cover` makes six
 * unrelated pictures sit in a row as one set. `sizes` is declared so Next
 * serves a thumbnail rather than the full 340KB original for a 28px slot.
 *
 * Signals without artwork keep the same footprint, tinted with their own hue —
 * the row stays aligned, and adding the file later changes nothing else.
 */
function SignalMark({ target, hue, size = 28 }: { target: string; hue: string; size?: number }) {
  const src = signalArt(target as Parameters<typeof signalArt>[0]);

  if (!src) {
    return (
      <span
        aria-hidden
        className="shrink-0 rounded-full"
        style={{
          width: size,
          height: size,
          background: `color-mix(in srgb, ${hue} 10%, transparent)`,
          border: `1px solid color-mix(in srgb, ${hue} 22%, transparent)`,
        }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="relative shrink-0 overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        border: `1px solid color-mix(in srgb, ${hue} 30%, transparent)`,
      }}
    >
      <Image src={src} alt="" fill sizes={`${size}px`} className="object-cover" />
    </span>
  );
}

export function SignalRow({
  forecast,
  hue,
  selected,
  domain,
  onSelect,
}: {
  forecast: Forecast;
  hue: string;
  selected: boolean;
  domain: [number, number];
  onSelect: () => void;
}) {
  const meta = TARGET_META[forecast.target];

  const history = forecast.history.map((h) => h.value);
  const p50 = forecast.quantiles["0.5"];
  const p10end = forecast.quantiles["0.1"].at(-1) ?? 0;
  const p50end = p50.at(-1) ?? 0;
  const p90end = forecast.quantiles["0.9"].at(-1) ?? 0;

  const change = medianChange(forecast);
  const flat = Math.abs(change) < 0.05;
  const worse = !flat && (change > 0) === meta.higherIsWorse;
  const deltaColor = flat
    ? "var(--text-muted)"
    : worse
      ? "var(--coral)"
      : "var(--teal)";

  // A signal with no source data is not a choice the reader can act on, so it
  // is dimmed and inert rather than clickable and empty.
  if (!forecast.hasSignal) {
    return (
      <div
        className="flex min-h-[44px] items-center gap-2.5 px-1 py-2 opacity-45"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <SignalMark target={forecast.target} hue={hue} />
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-[12.5px] font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            {meta.label}
          </span>
          <span className="block text-[10px] italic" style={{ color: "var(--text-muted)" }}>
            no data yet — connect the source that produces it
          </span>
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="group flex min-h-[44px] w-full items-center gap-2.5 px-1 py-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_4%,transparent)] sm:gap-3"
      style={{ borderTop: "1px solid var(--border)" }}
    >
      <SignalMark target={forecast.target} hue={hue} />

      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[12.5px]"
          style={{
            color: selected ? "var(--accent)" : "var(--text-primary)",
            fontWeight: selected ? 600 : 450,
          }}
        >
          {meta.label}
        </span>
        <span className="block truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
          {microSummary(forecast.target, change)}
        </span>
      </span>

      <span className="hidden shrink-0 sm:block" style={{ color: hue }}>
        <Sparkline values={history} forecast={p50} color={hue} width={104} height={26} />
      </span>

      <span className="hidden shrink-0 flex-col items-end gap-1 md:flex">
        <RangeBar p10={p10end} p50={p50end} p90={p90end} domain={domain} color={hue} />
        <span className="tnum text-[10px]" style={{ color: "var(--text-muted)" }}>
          <SigmaValue value={p10end} signalId={forecast.target} /> …{" "}
          <SigmaValue value={p90end} signalId={forecast.target} />
        </span>
      </span>

      <span className="flex w-[66px] shrink-0 flex-col items-end">
        <span className="text-[13px] font-semibold" style={{ color: deltaColor }}>
          {flat ? "flat" : <SigmaValue value={change} signalId={forecast.target} />}
        </span>
        <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
          13w
        </span>
      </span>
    </button>
  );
}

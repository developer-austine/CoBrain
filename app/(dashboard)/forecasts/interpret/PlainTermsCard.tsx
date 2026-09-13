"use client";

import React, { useEffect, useRef, useState } from "react";
import { Eye, Info } from "lucide-react";
import type { Narrative } from "@/lib/interpret/narrative";
import { useHighlight } from "./useHighlight";

/**
 * "In Plain Terms" (spec §4) — level 2 of the disclosure ladder.
 *
 * The one hero-bordered card in the rail, because it is the only thing on the
 * page that answers "so what?" without the reader knowing what a sigma is.
 *
 * Reading typography, not UI typography: 14.5px at 1.65 against 12–13px
 * everywhere else. The size difference is the signal that this is prose meant
 * to be read, not a label to be scanned.
 */

const TINT_PULSE_MS = 600;

export function PlainTermsCard({
  narrative,
  signalId,
  hasSignal,
  onOpenDrawer,
  bare = false,
}: {
  narrative: Narrative | null;
  signalId: string;
  hasSignal: boolean;
  /** Omitted when the card already lives inside the drawer — nothing to open. */
  onOpenDrawer?: () => void;
  /** Drops the hero card chrome so the card can sit as a drawer section. */
  bare?: boolean;
}) {
  const { setHighlight } = useHighlight();
  const [pulse, setPulse] = useState(false);
  const lastBand = useRef<string | null>(null);

  // A poll that moves the reading across a threshold gets one tint pulse. Only
  // a band change — re-pulsing on every poll would train the reader to ignore
  // it, which is worse than never pulsing at all.
  const bandKey = narrative
    ? `${narrative.verdict.text}|${narrative.kpis.rangePlain}`
    : null;

  useEffect(() => {
    if (!bandKey) return;
    if (lastBand.current !== null && lastBand.current !== bandKey) {
      setPulse(true);
      const id = setTimeout(() => setPulse(false), TINT_PULSE_MS);
      return () => clearTimeout(id);
    }
    lastBand.current = bandKey;
  }, [bandKey]);

  if (!hasSignal || !narrative) {
    return (
      <Card bare={bare}>
        <Header />
        <p
          className="mt-3 text-[13px] leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          Once this source is connected, I&apos;ll explain what the numbers mean here.
        </p>
      </Card>
    );
  }

  const verdictColor =
    narrative.verdict.tone === "bad"
      ? "var(--verdict-bad)"
      : narrative.verdict.tone === "good"
        ? "var(--verdict-good)"
        : "var(--text-primary)";

  // S5 is the watch line and lives in the footer; everything before it is body.
  const watch = narrative.momentum.sentence
    ? narrative.sentences.at(-1)
    : undefined;
  const body = watch ? narrative.sentences.slice(0, -1) : narrative.sentences;

  return (
    <Card pulse={pulse} bare={bare}>
      <Header />

      <div
        key={signalId}
        className="chart-fade mt-3 text-[14.5px]"
        style={{ lineHeight: 1.65, color: "var(--text-primary)" }}
      >
        {/* The verdict is the only coloured, bolded phrase on the card. */}
        <span className="font-semibold" style={{ color: verdictColor }}>
          {narrative.verdict.text}
        </span>{" "}
        {body.map((sentence, i) => (
          <span key={i}>
            {narrative.anchor && sentence.includes(narrative.anchor.label) ? (
              <AnchoredSentence
                sentence={sentence}
                anchorLabel={narrative.anchor.label}
                onEnter={() =>
                  setHighlight({ type: "week", weekISO: narrative.anchor!.weekISO })
                }
                onLeave={() => setHighlight(null)}
              />
            ) : (
              <RangeSentence sentence={sentence} />
            )}{" "}
          </span>
        ))}
      </div>

      {/* Dropped in the drawer: the "What drove this" bars sit directly below
          with the same drivers, their weights and a sentence each, and the
          chips' hover highlights a chart that is behind the scrim. Repeating
          them here would be the one thing the drawer is meant not to do. */}
      {!bare && narrative.drivers.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {narrative.drivers.slice(0, 3).map((d) => (
            <button
              key={d.label}
              type="button"
              onMouseEnter={() => setHighlight({ type: "driver", label: d.label })}
              onMouseLeave={() => setHighlight(null)}
              onFocus={() => setHighlight({ type: "driver", label: d.label })}
              onBlur={() => setHighlight(null)}
              className="rounded-full px-2.5 py-1 text-[10.5px] transition-colors"
              style={{ background: "var(--bg-inset)", color: "var(--text-secondary)" }}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      {watch && (
        <p
          className="mt-3 flex items-start gap-1.5 border-t pt-2.5 text-[11.5px] leading-relaxed"
          style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
        >
          <Eye size={12} className="mt-0.5 shrink-0" />
          {watch}
        </p>
      )}

      {onOpenDrawer && (
        <button
          type="button"
          onClick={onOpenDrawer}
          className="mt-2.5 block w-full text-right text-[11.5px] font-medium"
          style={{ color: "var(--accent)" }}
        >
          Full breakdown →
        </button>
      )}
    </Card>
  );
}

function Card({
  children,
  pulse = false,
  bare = false,
}: {
  children: React.ReactNode;
  pulse?: boolean;
  bare?: boolean;
}) {
  // Inside the drawer this is prose, not a card: the panel already supplies the
  // surface and the padding, so a border and a fill would draw a box inside a
  // box. No background at all — the text sits directly on the drawer, and
  // readability comes from the type, which is unchanged.
  if (bare) return <section>{children}</section>;

  return (
    <div
      className="rounded-2xl p-4 transition-colors"
      style={{
        background: pulse
          ? "color-mix(in srgb, var(--accent) 8%, var(--bg-card))"
          : "var(--bg-card)",
        border: "2px solid var(--interp-hero-border)",
        boxShadow: "var(--interp-hero-shadow)",
      }}
    >
      {children}
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center justify-between gap-2">
      <p
        className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: "var(--accent)" }}
      >
        In plain terms
        <span
          title="Every sentence here is computed from the same numbers on the chart — no AI writes this text, so it never disagrees with the forecast."
          className="cursor-help"
        >
          <Info size={11} />
        </span>
      </p>
      <span
        className="tnum flex items-center gap-1 text-[10.5px]"
        style={{ color: "var(--teal)" }}
      >
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--teal)" }} />
        synced with chart
      </span>
    </div>
  );
}

/** Wraps the anchor phrase in a hoverable chip that rings the week on the chart. */
function AnchoredSentence({
  sentence,
  anchorLabel,
  onEnter,
  onLeave,
}: {
  sentence: string;
  anchorLabel: string;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const marker = `the week of ${anchorLabel}`;
  const at = sentence.indexOf(marker);
  if (at === -1) return <>{sentence}</>;

  return (
    <>
      {sentence.slice(0, at)}
      <button
        type="button"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onFocus={onEnter}
        onBlur={onLeave}
        className="rounded-[6px] px-1.5 py-0.5 align-baseline text-[13.5px]"
        style={{ background: "var(--anchor-chip-bg)", color: "var(--anchor-chip-text)" }}
      >
        {marker}
      </button>
      {sentence.slice(at + marker.length)}
    </>
  );
}

/**
 * Makes the range endpoints hoverable so they flash the matching band edge.
 *
 * The engine phrases S3 as "from X to Y", so the two sides are found by
 * position rather than by matching wording — the phrases themselves vary with
 * the thresholds.
 */
function RangeSentence({ sentence }: { sentence: string }) {
  const { setHighlight } = useHighlight();
  const m = sentence.match(/^(.*anywhere from )(.+?)( to )(.+?)( — .*)$/);
  if (!m) return <>{sentence}</>;

  const [, head, bear, mid, bull, tail] = m;
  const edge = (q: 0.1 | 0.9, text: string) => (
    <button
      type="button"
      onMouseEnter={() => setHighlight({ type: "quantile", q })}
      onMouseLeave={() => setHighlight(null)}
      onFocus={() => setHighlight({ type: "quantile", q })}
      onBlur={() => setHighlight(null)}
      className="underline decoration-dotted underline-offset-2"
    >
      {text}
    </button>
  );

  return (
    <>
      {head}
      {edge(0.1, bear)}
      {mid}
      {edge(0.9, bull)}
      {tail}
    </>
  );
}

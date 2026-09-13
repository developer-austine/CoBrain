"use client";

import React from "react";
import { Brain } from "lucide-react";

/**
 * The centre brain (spec §4.1, §4.2).
 *
 * The ring cadence is the queue: 3.4s while idle, 2.0s with a core pop the
 * moment the ingest queue has depth. A user glancing at this screen should be
 * able to tell whether the system is chewing on something without reading a
 * single number — which is why the cadence is bound to `queueDepth` and to
 * nothing else.
 */

export const BRAIN_SIZE = 96;

export function BrainGradientDefs() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute">
      <defs>
        <linearGradient id="viz-brain-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--teal)" />
          <stop offset="100%" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function BrainCore({
  totalItems,
  processing,
  onOpen,
}: {
  totalItems: number;
  processing: boolean;
  onOpen: () => void;
}) {
  const cycle = processing ? "2s" : "3.4s";

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Company brain, ${totalItems.toLocaleString("en-US")} items, ${
          processing ? "learning" : "idle"
        }. Open the brain overview.`}
        className="viz-node relative grid place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={
          {
            width: BRAIN_SIZE,
            height: BRAIN_SIZE,
            "--viz-cycle": cycle,
            "--tw-ring-color": "var(--teal)",
            "--tw-ring-offset-color": "var(--bg-card)",
          } as React.CSSProperties
        }
      >
        {/* Two rings, staggered half a cycle so the pulse never gaps. */}
        <span
          aria-hidden
          className="viz-brain-ring absolute inset-0 rounded-full border"
          style={{ borderColor: "var(--teal)" }}
        />
        <span
          aria-hidden
          className="viz-brain-ring absolute inset-0 rounded-full border"
          style={
            {
              borderColor: "var(--accent)",
              "--viz-delay": processing ? "1s" : "1.7s",
            } as React.CSSProperties
          }
        />

        <span
          aria-hidden
          className={`viz-brain-core grid h-full w-full place-items-center rounded-full ${
            processing ? "viz-brain-core--processing" : ""
          }`}
          style={{
            background:
              "radial-gradient(circle at 32% 28%, var(--bg-card), var(--bg-inset))",
            border: "1.5px solid color-mix(in srgb, var(--teal) 45%, transparent)",
            boxShadow:
              "0 0 28px color-mix(in srgb, var(--teal) 22%, transparent), 0 0 48px color-mix(in srgb, var(--accent) 14%, transparent)",
          }}
        >
          <Brain size={38} strokeWidth={1.5} stroke="url(#viz-brain-gradient)" />
        </span>
      </button>

      <p
        className="whitespace-nowrap text-[10px]"
        style={{ color: "var(--text-muted)" }}
      >
        {totalItems.toLocaleString("en-US")} items · {processing ? "learning" : "idle"}
      </p>
    </div>
  );
}

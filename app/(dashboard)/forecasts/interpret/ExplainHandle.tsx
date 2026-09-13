"use client";

import React from "react";

/**
 * The drawer trigger (spec §7.1).
 *
 * The pulse is finite and earned: three cycles, and only when something the
 * reader has not seen actually changed — the verdict crossed a band, drift
 * went to alarm, or the top driver swapped. A permanently pulsing dot is
 * indistinguishable from decoration within a day, and then it cannot signal
 * anything. Once the pulse ends, an unseen change keeps a solid badge until
 * the drawer is opened.
 */
export function ExplainHandle({
  onOpen,
  hasUnseenChange,
  pulsing,
  reduced,
}: {
  onOpen: () => void;
  hasUnseenChange: boolean;
  pulsing: boolean;
  reduced: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Explain this forecast"
      className="fixed right-0 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center gap-2 py-3 xl:flex"
      style={{
        background: "var(--handle-bg)",
        color: "var(--handle-text)",
        borderRadius: "8px 0 0 8px",
        paddingInline: 6,
      }}
    >
      <span
        className="text-[10.5px] font-semibold uppercase tracking-[0.16em]"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
      >
        Explain
      </span>
      <span className="relative grid h-[14px] w-[14px] place-items-center">
        {!reduced && pulsing && (
          <span
            aria-hidden
            className="pulse-ring absolute inset-0 rounded-full"
            style={{ border: "2px solid var(--handle-text)" }}
          />
        )}
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{
            background: "var(--handle-text)",
            opacity: hasUnseenChange || pulsing ? 1 : 0.55,
          }}
        />
      </span>
    </button>
  );
}

"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { CreditCard, Loader2, SlidersHorizontal } from "lucide-react";
import type { UsageSummary } from "@/lib/metering/summary";
import { Card, formatCredits, formatDate, stateColor } from "./primitives";

/**
 * The balance hero (§8b).
 *
 * One number, one bar, one sentence. The bar carries a marker at the PROJECTED
 * end-of-period position, which is the whole point of the card: a consumption
 * bar alone says where you are, and where you are has never been the thing that
 * causes a surprise bill.
 */
export function BalanceHero({
  summary,
  onSetCap,
}: {
  summary: UsageSummary;
  onSetCap: () => void;
}) {
  const [buying, setBuying] = useState(false);

  const { used, included, balance, projectedEndOfPeriod: projected } = summary;
  const colour = stateColor(summary.projectionState);

  // Both bars are drawn against the allowance, capped at 100% of the track.
  // Overage is shown by the marker sitting at the far end plus the sentence,
  // not by a bar that overflows its own container.
  const usedPct = included > 0 ? Math.min(100, (used / included) * 100) : 0;
  const projectedPct = included > 0 ? Math.min(100, (projected / included) * 100) : 0;

  const buyCredits = async () => {
    setBuying(true);
    try {
      const res = await fetch("/api/usage/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credits: 500 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start checkout");
      window.location.href = data.checkoutUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start checkout");
    } finally {
      setBuying(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: "var(--text-muted)" }}
          >
            Balance
          </p>
          <p
            className="font-display tnum mt-1 text-[34px] font-bold leading-none"
            style={{ color: "var(--text-primary)" }}
          >
            {formatCredits(balance)}
            <span
              className="ml-1.5 text-[15px] font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              credits left
            </span>
          </p>
          <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
            {formatDate(summary.periodStart)} – {formatDate(summary.periodEnd)} ·{" "}
            {summary.planLabel} plan
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={buyCredits}
            disabled={buying}
            className="flex h-[38px] items-center gap-2 rounded-lg px-3.5 text-[13px] font-semibold text-white transition-all duration-150 hover:-translate-y-px hover:brightness-110 active:scale-[0.98] disabled:cursor-default disabled:opacity-70"
            style={{ background: "var(--accent)" }}
          >
            {buying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CreditCard className="h-4 w-4" />
            )}
            Buy credits
          </button>
          <button
            type="button"
            onClick={onSetCap}
            className="flex h-[38px] items-center gap-2 rounded-lg px-3.5 text-[13px] font-semibold transition-colors"
            style={{
              border: "1px solid var(--border-strong)",
              color: "var(--text-primary)",
            }}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Set a cap
          </button>
        </div>
      </div>

      {/* ── Consumption bar with the projection marker ─────────────────── */}
      <div className="relative mt-5 h-2.5 w-full overflow-visible rounded-full"
           style={{ background: "var(--bar-track)" }}>
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
          style={{ width: `${usedPct}%`, background: "var(--accent)" }}
        />
        {included > 0 && (
          <span
            title={`Projected: ${formatCredits(projected)} credits`}
            className="absolute -top-1 h-4.5 w-[2px] rounded-full"
            style={{
              left: `calc(${projectedPct}% - 1px)`,
              height: "18px",
              background: colour,
            }}
          />
        )}
      </div>

      <div
        className="font-data tnum mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]"
        style={{ color: "var(--text-muted)" }}
      >
        <span>
          Used <strong style={{ color: "var(--text-primary)" }}>{formatCredits(used)}</strong>
        </span>
        <span aria-hidden>·</span>
        <span>
          Included <strong style={{ color: "var(--text-primary)" }}>{formatCredits(included)}</strong>
        </span>
        <span aria-hidden>·</span>
        <span>
          Projected <strong style={{ color: colour }}>{formatCredits(projected)}</strong>
        </span>
        {summary.hardCap !== null && (
          <>
            <span aria-hidden>·</span>
            <span>
              Cap <strong style={{ color: "var(--text-primary)" }}>{formatCredits(summary.hardCap)}</strong>
            </span>
          </>
        )}
      </div>

      <p className="mt-2 text-[12.5px] font-medium" style={{ color: colour }}>
        {summary.projectionSentence}
        {summary.projectedExhaustionDate && (
          <span style={{ color: "var(--text-secondary)" }}>
            {" "}
            Around {formatDate(summary.projectedExhaustionDate)}.
          </span>
        )}
      </p>

      {!summary.overageAllowed && (
        <p className="mt-1 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
          Overage is off — metered features pause at zero. Chat, search, and forecasts
          keep working.
        </p>
      )}
    </Card>
  );
}

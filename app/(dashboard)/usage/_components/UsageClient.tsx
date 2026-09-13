"use client";

import React, { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { UsageSummary } from "@/lib/metering/summary";
import { BalanceHero } from "./BalanceHero";
import { FeatureBars } from "./FeatureBars";
import { DailyBars } from "./DailyBars";
import { ConsumersTable } from "./ConsumersTable";
import { ReceiptsTable } from "./ReceiptsTable";
import { PlanAndCaps } from "./PlanAndCaps";
import { Card, EmptyState } from "./primitives";

/**
 * The Usage & Credits page (spec §8).
 *
 * Section order is the reading order the spec sets, and it is a ladder: what's
 * left → where it went → when it went → who spent it → the receipt → the
 * controls. Each rung answers the question the one above it raises, so a reader
 * who only reads the hero card has still learned the thing that matters.
 */

export type UsagePageData = {
  summary: UsageSummary;
  features: {
    feature: string;
    label: string;
    credits: number;
    quantity: number;
    quantityLabel: string;
    share: number;
  }[];
  featureHeadline: string | null;
  daily: {
    day: string;
    credits: number;
    byFeature: { feature: string; label: string; credits: number }[];
  }[];
  dailyPace: number;
  receipts: {
    rows: {
      id: string;
      occurredAt: string;
      feature: string;
      label: string;
      quantity: number;
      quantityLabel: string;
      credits: number;
      actorUserId: string | null;
    }[];
    nextCursor: string | null;
  };
  consumers: {
    rows: { userId: string; credits: number; share: number; topFeature: string | null }[];
    more: number;
  };
  isAdmin: boolean;
  caps: {
    plan: string;
    includedCredits: number;
    hardCapCredits: number | null;
    featureCaps: Record<string, number>;
    alertThresholds: number[];
    overageAllowed: boolean;
  };
};

type PeriodChoice = "this" | "last";

export function UsageClient({ data }: { data: UsagePageData }) {
  const [period, setPeriod] = useState<PeriodChoice>("this");
  const [view, setView] = useState(data);
  const [loading, setLoading] = useState(false);
  const [capsOpen, setCapsOpen] = useState(false);

  const window = useMemo(() => windowFor(period, data.summary), [period, data.summary]);

  /**
   * Refetch the charts for a different period.
   *
   * The hero card is NOT refetched: balance, allowance and projection are
   * properties of the CURRENT period by definition, and showing last month's
   * "projected to exceed" beside a period that already ended would be nonsense.
   */
  const changePeriod = useCallback(
    async (next: PeriodChoice) => {
      setPeriod(next);
      if (next === "this") {
        setView(data);
        return;
      }

      setLoading(true);
      try {
        const w = windowFor(next, data.summary);
        const qs = `from=${w.from}&to=${w.to}`;
        const [features, daily, ledger, consumers] = await Promise.all([
          fetchJson(`/api/usage/breakdown?by=feature&${qs}`),
          fetchJson(`/api/usage/breakdown?by=day&${qs}`),
          fetchJson(`/api/usage/events?${qs}`),
          data.isAdmin
            ? fetchJson(`/api/usage/breakdown?by=user&${qs}`)
            : Promise.resolve({ rows: [], more: 0 }),
        ]);

        setView({
          ...data,
          features: features?.rows ?? [],
          featureHeadline: features?.headline ?? null,
          daily: daily?.rows ?? [],
          dailyPace: daily?.pace ?? data.dailyPace,
          receipts: ledger ?? { rows: [], nextCursor: null },
          consumers: consumers ?? { rows: [], more: 0 },
        });
      } catch {
        toast.error("Could not load that period.");
        setPeriod("this");
      } finally {
        setLoading(false);
      }
    },
    [data]
  );

  const nothingMetered = view.features.length === 0;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1400px] flex-col gap-4 px-4 pb-8 sm:px-6">
      {/* ── Banners ─────────────────────────────────────────────────────── */}
      {view.summary.paused.length > 0 && <PausedBanner summary={view.summary} />}

      {/* ── a) Period selector ──────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-1.5">
        {loading && (
          <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--text-muted)" }} />
        )}
        <div
          className="flex rounded-lg p-0.5"
          style={{ background: "var(--bg-inset)", border: "1px solid var(--border)" }}
        >
          {(
            [
              ["this", "This period"],
              ["last", "Last period"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => changePeriod(key)}
              className="rounded-[6px] px-2.5 py-1 text-[11.5px] font-medium transition-colors"
              style={{
                background: period === key ? "var(--bg-card)" : "transparent",
                color: period === key ? "var(--text-primary)" : "var(--text-secondary)",
                boxShadow: period === key ? "var(--card-shadow)" : undefined,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── b) Balance hero ─────────────────────────────────────────────── */}
      <BalanceHero summary={view.summary} onSetCap={() => setCapsOpen(true)} />

      {nothingMetered ? (
        <EmptyState
          title="Nothing metered this period"
          body="Chat, search, and forecasts are included and never use credits. Metered features — meeting agents, voice, bulk backfills — will appear here once you use them."
        />
      ) : (
        <>
          {/* ── c) Where credits went ─────────────────────────────────── */}
          <FeatureBars rows={view.features} headline={view.featureHeadline} />

          {/* ── d) Usage over time ────────────────────────────────────── */}
          <DailyBars rows={view.daily} pace={view.dailyPace} />

          {/* ── e) Top consumers (admin only) ─────────────────────────── */}
          {view.isAdmin && view.consumers.rows.length > 0 && (
            <ConsumersTable rows={view.consumers.rows} more={view.consumers.more} />
          )}
        </>
      )}

      {/* ── f) Receipts ───────────────────────────────────────────────── */}
      <ReceiptsTable
        initial={view.receipts}
        window={window}
        key={`${period}:${view.receipts.rows[0]?.id ?? "empty"}`}
      />

      {/* ── g) Plan & caps (admin only) ───────────────────────────────── */}
      {view.isAdmin && (
        <PlanAndCaps caps={view.caps} open={capsOpen} onOpenChange={setCapsOpen} />
      )}
    </div>
  );
}

/** The zero-balance / cap-hit banner (§8.4). Names what stopped and what didn't. */
function PausedBanner({ summary }: { summary: UsageSummary }) {
  const capHit = summary.paused.some((p) => p.reason === "hard_cap");

  return (
    <Card
      className="p-3.5"
      style={{
        borderColor: "var(--coral)",
        background: "color-mix(in srgb, var(--coral) 6%, var(--bg-card))",
      }}
    >
      <p className="text-[13px] font-semibold" style={{ color: "var(--coral)" }}>
        {capHit
          ? "This workspace has reached its spending cap"
          : "Metered features are paused"}
      </p>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {summary.paused.map((p) => (
          <li key={p.feature} className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
            {p.message}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
        Chat, search, and forecasts keep working — they&apos;re included in your plan
        and never use credits.
      </p>
    </Card>
  );
}

/** Calendar window for the selected period, as ISO strings for the query. */
function windowFor(period: PeriodChoice, summary: UsageSummary) {
  const start = new Date(summary.periodStart);
  const end = new Date(summary.periodEnd);

  if (period === "this") {
    return { from: start.toISOString(), to: end.toISOString() };
  }

  // The month before the current period start.
  const prevStart = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1)
  );
  return { from: prevStart.toISOString(), to: start.toISOString() };
}

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

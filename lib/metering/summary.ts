import "server-only";
import prisma from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { decimalToNumber, getBalance, getPeriodSpend } from "./balance";
import { getBilling, PLANS } from "./period";
import { activeAlerts, type UsageAlertView } from "./alerts";
import { featureLabel, quantityLabel } from "./pricebook";
import { pausedFeatures } from "./quota";

/**
 * The read model behind /api/usage/* and the Usage & Credits page.
 *
 * Everything here is aggregated in Postgres. The alternative — pulling a
 * period's ledger rows and reducing them in Node — turns a busy tenant's page
 * load into a few hundred thousand rows over the wire, and the answer is always
 * a handful of numbers.
 *
 * NOTHING in this file may return costMicros or any provider token count. That
 * is our margin and our vocabulary, not the customer's; the boundary is here
 * because this is the last layer before the wire.
 */

export type UsageSummary = {
  balance: number;
  included: number;
  used: number;
  periodStart: string;
  periodEnd: string;
  projectedEndOfPeriod: number;
  plan: string;
  planLabel: string;
  hardCap: number | null;
  overageAllowed: boolean;
  alerts: UsageAlertView[];
  /** Metered features currently unavailable, with the reason. */
  paused: { feature: string; reason: string; message: string }[];
  /** "on_track" | "near" | "over" — drives the projection sentence's colour. */
  projectionState: ProjectionState;
  projectionSentence: string;
  /** Only when projected to exceed: roughly when the allowance runs out. */
  projectedExhaustionDate: string | null;
};

export type ProjectionState = "on_track" | "near" | "over";

/** Above this share of the allowance, "close" rather than "on track". */
const NEAR_BUDGET_RATIO = 0.9;

export async function buildSummary(tenantId: string): Promise<UsageSummary> {
  const billing = await getBilling(tenantId);
  const [balance, used, alerts, paused] = await Promise.all([
    getBalance(tenantId),
    getPeriodSpend(tenantId),
    activeAlerts(tenantId),
    pausedFeatures(tenantId),
  ]);

  const dailyAvg = await dailyAverageLast7(tenantId);
  const daysRemaining = daysBetween(new Date(), billing.periodEnd);
  const projected = used + dailyAvg * daysRemaining;

  const state = projectionStateFor(projected, billing.includedCredits);

  return {
    balance,
    included: billing.includedCredits,
    used,
    periodStart: billing.periodStart.toISOString(),
    periodEnd: billing.periodEnd.toISOString(),
    projectedEndOfPeriod: round(projected),
    plan: billing.plan,
    planLabel: PLANS[billing.plan].label,
    hardCap: billing.hardCapCredits,
    overageAllowed: billing.overageAllowed,
    alerts,
    paused,
    projectionState: state,
    projectionSentence: projectionSentence(state, projected, billing.includedCredits),
    projectedExhaustionDate:
      state === "over"
        ? exhaustionDate(used, dailyAvg, billing.includedCredits)
        : null,
  };
}

/**
 * The projection — the number that stops a bill from being a surprise.
 *
 * A 7-day trailing mean rather than the period-to-date average: usage is
 * bursty, and averaging over a period that began three weeks ago tells a
 * customer who started a daily meeting agent on Monday that everything is fine.
 */
async function dailyAverageLast7(tenantId: string): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const spent = await prisma.usageEvent.aggregate({
    _sum: { credits: true },
    where: { tenantId, occurredAt: { gte: since } },
  });
  return decimalToNumber(spent._sum.credits) / 7;
}

function projectionStateFor(projected: number, included: number): ProjectionState {
  if (included <= 0) return "on_track";
  if (projected > included) return "over";
  if (projected > included * NEAR_BUDGET_RATIO) return "near";
  return "on_track";
}

function projectionSentence(
  state: ProjectionState,
  projected: number,
  included: number
): string {
  if (included <= 0) {
    return "Nothing metered this period. Chat, search, and forecasts are included and never use credits.";
  }
  if (state === "over") {
    return `Projected to exceed by about ${round(projected - included)} credits.`;
  }
  if (state === "near") {
    return `Close — projected to use about ${Math.round((projected / included) * 100)}% of your allowance.`;
  }
  return `On track — about ${round(included - projected)} credits to spare.`;
}

/** Roughly when the allowance runs out at the current pace. */
function exhaustionDate(used: number, dailyAvg: number, included: number): string | null {
  if (dailyAvg <= 0) return null;
  const remaining = included - used;
  if (remaining <= 0) return new Date().toISOString();
  const days = remaining / dailyAvg;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

// ── Breakdowns ─────────────────────────────────────────────────────────────

export type FeatureBreakdownRow = {
  feature: string;
  label: string;
  credits: number;
  quantity: number;
  /** "412 credits · 412 meeting minutes" — the bar's secondary label. */
  quantityLabel: string;
  /** Share of the period's total spend, 0–1. */
  share: number;
};

/**
 * Where the credits went, ranked by spend and capped at six bars.
 *
 * Ranked because the question is "what is costing me", and a chart ordered by
 * anything else makes the reader do the ranking themselves. Capped because a
 * seventh bar has never changed a decision.
 */
export async function featureBreakdown(
  tenantId: string,
  window: { from: Date; to: Date }
): Promise<FeatureBreakdownRow[]> {
  const grouped = await prisma.usageEvent.groupBy({
    by: ["feature"],
    where: {
      tenantId,
      occurredAt: { gte: window.from, lt: window.to },
      credits: { gt: 0 }, // unmetered rows carry cost, never a charge
    },
    _sum: { credits: true, quantity: true },
  });

  const rows = grouped
    .map((g) => ({
      feature: g.feature,
      label: featureLabel(g.feature),
      credits: round(decimalToNumber(g._sum.credits)),
      quantity: decimalToNumber(g._sum.quantity),
    }))
    .sort((a, b) => b.credits - a.credits)
    .slice(0, 6);

  const total = rows.reduce((sum, r) => sum + r.credits, 0);

  return rows.map((r) => ({
    ...r,
    quantityLabel: quantityLabel(r.feature, r.quantity),
    share: total > 0 ? r.credits / total : 0,
  }));
}

/** One plain sentence under the bars, naming the biggest cost. */
export function featureHeadline(rows: FeatureBreakdownRow[]): string | null {
  const top = rows[0];
  if (!top || top.credits <= 0) return null;
  return `${top.label} is your biggest cost this period — ${Math.round(top.share * 100)}% of credits.`;
}

export type DailyBreakdownRow = {
  /** YYYY-MM-DD. */
  day: string;
  credits: number;
  /** Per-feature split for the hover card. */
  byFeature: { feature: string; label: string; credits: number }[];
};

/**
 * Usage per day, split by feature.
 *
 * Grouped in SQL by date rather than by loading rows: date_trunc is the one
 * thing Prisma's groupBy cannot express, and a raw query here is far cheaper
 * than the alternative of bucketing a period's events in memory.
 */
export async function dailyBreakdown(
  tenantId: string,
  window: { from: Date; to: Date }
): Promise<DailyBreakdownRow[]> {
  const rows = await prisma.$queryRaw<
    { day: Date; feature: string; credits: Prisma.Decimal }[]
  >`
    SELECT date_trunc('day', "occurredAt") AS day,
           "feature",
           SUM("credits") AS credits
      FROM "UsageEvent"
     WHERE "tenantId" = ${tenantId}
       AND "occurredAt" >= ${window.from}
       AND "occurredAt" <  ${window.to}
       AND "credits" > 0
     GROUP BY 1, 2
     ORDER BY 1 ASC
  `;

  const byDay = new Map<string, DailyBreakdownRow>();
  for (const row of rows) {
    const day = row.day.toISOString().slice(0, 10);
    const credits = round(decimalToNumber(row.credits));
    const entry = byDay.get(day) ?? { day, credits: 0, byFeature: [] };
    entry.credits = round(entry.credits + credits);
    entry.byFeature.push({
      feature: row.feature,
      label: featureLabel(row.feature),
      credits,
    });
    byDay.set(day, entry);
  }

  return [...byDay.values()];
}

export type ConsumerRow = {
  userId: string;
  credits: number;
  share: number;
  topFeature: string | null;
};

/**
 * Credits by person. ADMIN ONLY — callers must check first.
 *
 * This is per-person activity data about employees. The RBAC check lives at the
 * route, not here, so that a future internal caller cannot accidentally get an
 * unguarded version by importing a differently-named function.
 */
export async function topConsumers(
  tenantId: string,
  window: { from: Date; to: Date },
  limit = 8
): Promise<{ rows: ConsumerRow[]; more: number }> {
  const grouped = await prisma.usageEvent.groupBy({
    by: ["actorUserId"],
    where: {
      tenantId,
      occurredAt: { gte: window.from, lt: window.to },
      credits: { gt: 0 },
      actorUserId: { not: null },
    },
    _sum: { credits: true },
  });

  const sorted = grouped
    .map((g) => ({
      userId: g.actorUserId as string,
      credits: round(decimalToNumber(g._sum.credits)),
    }))
    .sort((a, b) => b.credits - a.credits);

  const total = sorted.reduce((sum, r) => sum + r.credits, 0);
  const shown = sorted.slice(0, limit);

  const rows = await Promise.all(
    shown.map(async (row) => ({
      ...row,
      share: total > 0 ? row.credits / total : 0,
      topFeature: await topFeatureForUser(tenantId, row.userId, window),
    }))
  );

  return { rows, more: Math.max(0, sorted.length - limit) };
}

async function topFeatureForUser(
  tenantId: string,
  userId: string,
  window: { from: Date; to: Date }
): Promise<string | null> {
  const grouped = await prisma.usageEvent.groupBy({
    by: ["feature"],
    where: {
      tenantId,
      actorUserId: userId,
      occurredAt: { gte: window.from, lt: window.to },
      credits: { gt: 0 },
    },
    _sum: { credits: true },
    orderBy: { _sum: { credits: "desc" } },
    take: 1,
  });
  return grouped[0] ? featureLabel(grouped[0].feature) : null;
}

// ── Receipts ───────────────────────────────────────────────────────────────

export type ReceiptRow = {
  id: string;
  occurredAt: string;
  feature: string;
  label: string;
  quantity: number;
  quantityLabel: string;
  credits: number;
  actorUserId: string | null;
};

/**
 * The raw ledger, paginated. This is the dispute-resolution surface: every row
 * here must be traceable to one real action, which is why the id is included.
 *
 * Cursor pagination on id rather than offset — the ledger only ever grows, and
 * an offset walk over a month of rows re-scans everything it already returned.
 */
export async function receipts(
  tenantId: string,
  opts: {
    from?: Date;
    to?: Date;
    feature?: string;
    actorUserId?: string;
    cursor?: string;
    limit?: number;
  } = {}
): Promise<{ rows: ReceiptRow[]; nextCursor: string | null }> {
  const limit = Math.min(opts.limit ?? 50, 200);

  const rows = await prisma.usageEvent.findMany({
    where: {
      tenantId,
      ...(opts.feature ? { feature: opts.feature } : {}),
      ...(opts.actorUserId ? { actorUserId: opts.actorUserId } : {}),
      ...(opts.from || opts.to
        ? {
            occurredAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lt: opts.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const page = rows.slice(0, limit);

  return {
    rows: page.map((row) => {
      const quantity = decimalToNumber(row.quantity);
      return {
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        feature: row.feature,
        label: featureLabel(row.feature),
        quantity,
        quantityLabel: quantityLabel(row.feature, quantity),
        credits: round(decimalToNumber(row.credits)),
        actorUserId: row.actorUserId,
      };
    }),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  };
}

/** Credits are shown to 2dp; carrying float noise into the UI helps nobody. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

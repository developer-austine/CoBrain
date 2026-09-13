import "server-only";
import { withoutTenantScope } from "@/lib/tenant/prisma";
import { featureLabel } from "./pricebook";

/**
 * The internal margin dashboard query (Section 7).
 *
 * INTERNAL ONLY. Nothing here may be served to a customer or reached from a
 * customer-facing route: it exposes our real per-tenant cost, which is the one
 * number the price book exists to keep separate from what customers see.
 *
 * Deliberately cross-tenant — comparing tenants IS the question — which is why
 * MarginReport sits outside the RLS set and why every read goes through
 * withoutTenantScope with a stated reason.
 */

export type MarginRow = {
  tenantId: string;
  weekStart: string;
  revenueUsd: number;
  costUsd: number;
  marginPct: number | null;
  topCostFeature: string | null;
  costPerSeatUsd: number;
  flagged: boolean;
};

const MICROS_PER_USD = 1_000_000;

/**
 * The most recent weeks, newest first, flagged tenants surfaced first.
 *
 * A tenant under 40% margin for two consecutive weeks is what `flagged` means,
 * and it is the row worth acting on — a single heavy week is a customer using
 * the product, which is the outcome we want.
 */
export async function marginDashboard(opts: { weeks?: number; onlyFlagged?: boolean } = {}) {
  const weeks = Math.min(opts.weeks ?? 4, 52);
  const since = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000);

  return withoutTenantScope("metering: internal margin dashboard", async (db) => {
    const rows = await db.marginReport.findMany({
      where: {
        weekStart: { gte: since },
        ...(opts.onlyFlagged ? { flagged: true } : {}),
      },
      orderBy: [{ weekStart: "desc" }, { marginPct: "asc" }],
    });

    return rows.map(
      (row): MarginRow => ({
        tenantId: row.tenantId,
        weekStart: row.weekStart.toISOString().slice(0, 10),
        revenueUsd: Number(row.revenueMicros) / MICROS_PER_USD,
        costUsd: Number(row.costMicros) / MICROS_PER_USD,
        marginPct: row.marginPct,
        topCostFeature: row.topCostFeature ? featureLabel(row.topCostFeature) : null,
        costPerSeatUsd: Number(row.costPerSeat) / MICROS_PER_USD,
        flagged: row.flagged,
      })
    );
  });
}

/** Tenants currently flagged, for an operator alert digest. */
export async function flaggedTenants(): Promise<MarginRow[]> {
  return marginDashboard({ weeks: 2, onlyFlagged: true });
}

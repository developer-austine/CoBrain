import "server-only";
import prisma from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { getPeriodSpend } from "./balance";
import { getBilling, periodKey, type Billing } from "./period";

/**
 * Threshold alerts.
 *
 * The point of an alert is that a bill is never a surprise. That only works if
 * an alert fires ONCE per threshold per period — a warning that repeats every
 * time a background job runs is a warning people filter, and a filtered warning
 * is worse than none because it is mistaken for coverage.
 *
 * The once-ness is enforced by the unique index on idempotencyKey rather than
 * by a "lastAlertedAt" column, for the same reason the ledger is: two workers
 * crossing the threshold concurrently both try to insert, and exactly one wins.
 */

export type UsageAlertView = {
  threshold: number;
  usedPct: number;
  period: string;
  createdAt: string;
  /** Copy for the banner. Credits and plain English only. */
  message: string;
};

/** 100 is always checked, whatever the tenant configured, because it gates features. */
const TERMINAL_THRESHOLD = 100;

function thresholdsFor(billing: Billing): number[] {
  const configured = billing.alertThresholds ?? [];
  return [...new Set([...configured, TERMINAL_THRESHOLD])].sort((a, b) => a - b);
}

function messageFor(threshold: number, billing: Billing): string {
  if (threshold >= TERMINAL_THRESHOLD) {
    return billing.overageAllowed
      ? "You've used your full allowance for this period. Further metered usage runs as overage."
      : "You've used your full allowance for this period. Metered features are paused — chat, search, and forecasts keep working.";
  }
  return `You've used about ${threshold}% of this period's credits.`;
}

/**
 * Fire any threshold this tenant has newly crossed.
 *
 * Called from the nightly reconciliation and after a purchase, not on every
 * meter() — the check costs an aggregate query, and paying that on every
 * metered minute of every meeting would make alerting the most expensive part
 * of metering.
 */
export async function evaluateAlerts(tenantId: string): Promise<UsageAlertView[]> {
  const billing = await getBilling(tenantId);

  // A tenant with no included allowance cannot be a percentage of it. Dividing
  // anyway yields Infinity, which crosses every threshold at once and emails
  // someone about a plan they do not have.
  if (billing.includedCredits <= 0) return [];

  const spent = await getPeriodSpend(tenantId);
  const usedPct = Math.floor((spent / billing.includedCredits) * 100);
  const period = periodKey({
    periodStart: billing.periodStart,
    periodEnd: billing.periodEnd,
  });

  const fired: UsageAlertView[] = [];

  for (const threshold of thresholdsFor(billing)) {
    if (usedPct < threshold) continue;

    const idempotencyKey = `alert:${tenantId}:${period}:${threshold}`;
    try {
      const row = await prisma.usageAlert.create({
        data: { tenantId, threshold, period, usedPct, idempotencyKey },
      });
      fired.push({
        threshold,
        usedPct,
        period,
        createdAt: row.createdAt.toISOString(),
        message: messageFor(threshold, billing),
      });
    } catch (err) {
      // Already fired this period. Not an error — this is the guarantee working.
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }

  if (fired.length > 0) await notifyAdmins(tenantId, fired);
  return fired;
}

/** Alerts already raised this period, for the summary endpoint's `alerts[]`. */
export async function activeAlerts(tenantId: string): Promise<UsageAlertView[]> {
  const billing = await getBilling(tenantId);
  const period = periodKey({
    periodStart: billing.periodStart,
    periodEnd: billing.periodEnd,
  });

  const rows = await prisma.usageAlert.findMany({
    where: { tenantId, period },
    orderBy: { threshold: "desc" },
  });

  return rows.map((row) => ({
    threshold: row.threshold,
    usedPct: row.usedPct,
    period: row.period,
    createdAt: row.createdAt.toISOString(),
    message: messageFor(row.threshold, billing),
  }));
}

/**
 * Deliver the alert to the tenant's admins.
 *
 * There is no notification table or transactional email sender in this
 * codebase yet, so delivery is a logged no-op that stamps notifiedAt. The
 * LEDGER side of alerting — that a threshold was crossed, when, and that it
 * fires exactly once — is real and durable now; only the transport is
 * outstanding. Wiring an email provider here should not require revisiting any
 * of the logic above.
 */
async function notifyAdmins(tenantId: string, alerts: UsageAlertView[]): Promise<void> {
  for (const alert of alerts) {
    console.info(
      `[metering] usage alert ${alert.threshold}% for ${tenantId} (${alert.usedPct}% used) — delivery not configured`
    );
  }

  // notifiedAt records what was actually delivered. It stays null until a
  // transport exists, so a later backfill can find the alerts nobody received.
  void prisma.usageAlert
    .updateMany({
      where: {
        tenantId,
        idempotencyKey: { in: alerts.map((a) => `alert:${tenantId}:${a.period}:${a.threshold}`) },
      },
      data: { notifiedAt: null },
    })
    .catch(() => {});
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

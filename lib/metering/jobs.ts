import "server-only";
import { basePrisma } from "@/lib/prisma";
import { withTenant, withoutTenantScope } from "@/lib/tenant/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { reconcileBalance } from "./balance";
import { evaluateAlerts } from "./alerts";
import { getBilling, monthPeriod, periodKey, PLANS } from "./period";
import { meterForecastTarget } from "./wrappers";
import { FORECAST_TARGETS } from "@/lib/forecast/types";

/**
 * Scheduled metering work.
 *
 * Each job is a plain exported function so it can be run from the cron route,
 * from a script, or from a test. The route does auth and shape; the work lives
 * here.
 *
 * All of these are fleet-wide by nature — they answer "which tenants need
 * something" before they know any tenant id — so each one enumerates tenants
 * through withoutTenantScope and then re-enters withTenant per tenant. The
 * per-tenant re-entry is what keeps RLS meaningful: the enumeration sees only
 * ids, and every read and write of a tenant's rows happens inside that tenant's
 * scope.
 */

/** Drift above this is an incident, not rounding. */
const DRIFT_TOLERANCE = 0.01;

/** Under this margin for two consecutive weeks, a tenant is flagged. */
const MARGIN_ALARM = 0.4;

type JobSummary = { processed: number; errors: number; details?: unknown };

/**
 * Every tenant that has ever been billed or metered.
 *
 * TenantBilling alone is not enough: a tenant metered before its billing row
 * was created would be skipped by exactly the job meant to reconcile it.
 */
async function allTenantIds(reason: string): Promise<string[]> {
  return withoutTenantScope(reason, async (db) => {
    const [billed, metered] = await Promise.all([
      db.tenantBilling.findMany({ select: { tenantId: true } }),
      db.usageEvent.findMany({ select: { tenantId: true }, distinct: ["tenantId"] }),
    ]);
    return [...new Set([...billed, ...metered].map((r) => r.tenantId))];
  });
}

/**
 * Nightly: rebuild every cached balance from the ledger and report drift.
 *
 * The rebuild is not the point — the drift is. A cache that disagreed with the
 * ledger by more than a rounding error means a charge landed while Redis was
 * unreachable, or two processes raced. Either way it is worth waking up for,
 * because the same conditions that drift a balance also drop a charge.
 */
export async function reconcileBalances(): Promise<JobSummary> {
  const tenants = await allTenantIds("metering: nightly balance reconciliation");
  const incidents: { tenantId: string; cached: number | null; actual: number; drift: number }[] = [];
  let errors = 0;

  for (const tenantId of tenants) {
    try {
      const result = await withTenant(tenantId, () => reconcileBalance(tenantId));
      if (result.drift > DRIFT_TOLERANCE) {
        incidents.push(result);
        console.error(
          `[metering] BALANCE DRIFT ${result.drift.toFixed(4)} credits for ${tenantId} ` +
            `(cached ${result.cached}, ledger ${result.actual})`
        );
      }
      // Reconciliation is also the cheapest place to notice a crossed
      // threshold: the spend aggregate it needs is already warm.
      await withTenant(tenantId, () => evaluateAlerts(tenantId));
    } catch (err) {
      errors++;
      console.error(`[metering] reconcile failed for ${tenantId}:`, err);
    }
  }

  return { processed: tenants.length, errors, details: { incidents } };
}

/**
 * On period rollover: grant each tenant its plan allowance.
 *
 * Idempotent on `allowance:${tenantId}:${period}`, so running this hourly,
 * daily, or twice by accident grants exactly one allowance per period. That
 * matters more than it sounds: the failure mode of a non-idempotent grant is
 * free credits, which nobody reports.
 */
export async function grantPlanAllowance(at: Date = new Date()): Promise<JobSummary> {
  const tenants = await allTenantIds("metering: period rollover allowance");
  const period = monthPeriod(at);
  const key = periodKey(period);
  let processed = 0;
  let errors = 0;

  for (const tenantId of tenants) {
    try {
      await withTenant(tenantId, async () => {
        const billing = await getBilling(tenantId);
        const plan = PLANS[billing.plan];

        await basePrisma.creditLedger
          .create({
            data: {
              tenantId,
              kind: "plan_allowance",
              credits: new Prisma.Decimal(plan.includedCredits),
              periodStart: period.periodStart,
              periodEnd: period.periodEnd,
              idempotencyKey: `allowance:${tenantId}:${key}`,
              note: `${plan.label} plan allowance for ${key}`,
            },
          })
          .catch((err: unknown) => {
            if (!isUniqueViolation(err)) throw err; // already granted
          });

        // Move the billing row's window forward so the period the rest of the
        // module reads matches the one just granted.
        await basePrisma.tenantBilling.update({
          where: { tenantId },
          data: {
            includedCredits: plan.includedCredits,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
          },
        });
      });
      processed++;
    } catch (err) {
      errors++;
      console.error(`[metering] allowance grant failed for ${tenantId}:`, err);
    }
  }

  return { processed, errors };
}

/**
 * On rollover: expire an unused allowance on plans where it does not roll over.
 *
 * Written as a negative ledger row rather than by resetting a counter, because
 * a customer asking "where did my 300 credits go" deserves a line that says so
 * with a date on it.
 */
export async function expireUnusedCredits(at: Date = new Date()): Promise<JobSummary> {
  const tenants = await allTenantIds("metering: period rollover expiry");
  // The period that just ended, not the one beginning.
  const ended = monthPeriod(new Date(monthPeriod(at).periodStart.getTime() - 1));
  const key = periodKey(ended);
  let processed = 0;
  let errors = 0;

  for (const tenantId of tenants) {
    try {
      await withTenant(tenantId, async () => {
        const billing = await getBilling(tenantId);
        if (PLANS[billing.plan].allowanceRollsOver) return;

        const [granted, spent] = await Promise.all([
          basePrisma.creditLedger.aggregate({
            _sum: { credits: true },
            where: {
              tenantId,
              createdAt: { gte: ended.periodStart, lt: ended.periodEnd },
            },
          }),
          basePrisma.usageEvent.aggregate({
            _sum: { credits: true },
            where: {
              tenantId,
              occurredAt: { gte: ended.periodStart, lt: ended.periodEnd },
            },
          }),
        ]);

        const leftover =
          (granted._sum.credits?.toNumber() ?? 0) - (spent._sum.credits?.toNumber() ?? 0);
        if (leftover <= 0) return;

        await basePrisma.creditLedger
          .create({
            data: {
              tenantId,
              kind: "expiry",
              credits: new Prisma.Decimal(-leftover),
              periodStart: ended.periodStart,
              periodEnd: ended.periodEnd,
              idempotencyKey: `expiry:${tenantId}:${key}`,
              note: `Unused ${key} allowance expired`,
            },
          })
          .catch((err: unknown) => {
            if (!isUniqueViolation(err)) throw err;
          });
      });
      processed++;
    } catch (err) {
      errors++;
      console.error(`[metering] expiry failed for ${tenantId}:`, err);
    }
  }

  return { processed, errors };
}

/**
 * Monthly: one forecast_target charge per active target.
 *
 * "Active" is currently every target the forecasting service knows about — this
 * codebase has no per-tenant target subscription table, so there is nothing yet
 * that distinguishes a target a tenant chose from one that merely exists. The
 * charge is therefore gated on the tenant having a plan that includes forecast
 * targets at all, and the loop is ready for a real subscription list the moment
 * one exists.
 */
export async function meterActiveForecasts(at: Date = new Date()): Promise<JobSummary> {
  const tenants = await allTenantIds("metering: monthly forecast target charge");
  const key = periodKey(monthPeriod(at));
  let processed = 0;
  let errors = 0;

  for (const tenantId of tenants) {
    try {
      await withTenant(tenantId, async () => {
        const billing = await getBilling(tenantId);
        const cap = billing.featureCaps.forecast_target;
        if (cap === 0) return; // not included on this plan

        for (const target of FORECAST_TARGETS) {
          await meterForecastTarget({
            tenantId,
            targetId: `${tenantId}:${target}`,
            period: key,
          });
        }
      });
      processed++;
    } catch (err) {
      errors++;
      console.error(`[metering] forecast target metering failed for ${tenantId}:`, err);
    }
  }

  return { processed, errors };
}

/**
 * Weekly: the margin report (Section 7).
 *
 * INTERNAL ONLY. This is the number that says whether a customer is profitable
 * before the cloud bill does, and it is the single most valuable output of this
 * module — a tenant can look healthy on revenue while one feature quietly eats
 * the margin, and the per-feature cost share is the only place that shows.
 *
 * Runs unscoped throughout: the whole purpose is to compare tenants, and
 * MarginReport is deliberately outside the RLS set for that reason.
 */
export async function marginReport(at: Date = new Date()): Promise<JobSummary> {
  const weekStart = startOfWeek(at);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  return withoutTenantScope("metering: weekly margin report", async (db) => {
    const tenants = await db.tenantBilling.findMany();
    let processed = 0;
    let errors = 0;

    for (const billing of tenants) {
      try {
        const plan = PLANS[billing.plan as keyof typeof PLANS] ?? PLANS.starter;

        const costRows = await db.usageEvent.groupBy({
          by: ["feature"],
          where: {
            tenantId: billing.tenantId,
            occurredAt: { gte: weekStart, lt: weekEnd },
          },
          _sum: { costMicros: true },
        });

        const costMicros = costRows.reduce(
          (sum, row) => sum + (row._sum.costMicros ?? BigInt(0)),
          BigInt(0)
        );
        const topCostFeature =
          costRows
            .slice()
            .sort((a, b) => Number((b._sum.costMicros ?? BigInt(0)) - (a._sum.costMicros ?? BigInt(0))))[0]
            ?.feature ?? null;

        // A month's subscription allocated to one week, plus credit purchases
        // that actually settled inside it.
        const purchases = await db.creditLedger.aggregate({
          _sum: { credits: true },
          where: {
            tenantId: billing.tenantId,
            kind: "purchase",
            createdAt: { gte: weekStart, lt: weekEnd },
          },
        });
        const purchaseMicros =
          BigInt(Math.round((purchases._sum.credits?.toNumber() ?? 0) * 10_000));
        const revenueMicros = plan.priceMicros / BigInt(4) + purchaseMicros;

        const marginPct =
          revenueMicros > BigInt(0)
            ? Number(revenueMicros - costMicros) / Number(revenueMicros)
            : null;

        // Two consecutive weeks under the alarm, not one: a single heavy week
        // is a customer using the product, which is what we want.
        const previous = await db.marginReport.findFirst({
          where: {
            tenantId: billing.tenantId,
            weekStart: new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000),
          },
        });
        const flagged =
          marginPct !== null &&
          marginPct < MARGIN_ALARM &&
          previous !== null &&
          previous.marginPct !== null &&
          previous.marginPct < MARGIN_ALARM;

        const seats = 1; // one member per tenant until a seat model exists

        await db.marginReport.upsert({
          where: { tenantId_weekStart: { tenantId: billing.tenantId, weekStart } },
          update: { revenueMicros, costMicros, marginPct, topCostFeature, flagged },
          create: {
            tenantId: billing.tenantId,
            weekStart,
            revenueMicros,
            costMicros,
            marginPct,
            topCostFeature,
            seats,
            costPerSeat: costMicros / BigInt(seats),
            flagged,
          },
        });

        if (flagged) {
          console.error(
            `[metering] MARGIN ALARM: ${billing.tenantId} under ${MARGIN_ALARM * 100}% ` +
              `for two consecutive weeks (top cost: ${topCostFeature})`
          );
        }
        processed++;
      } catch (err) {
        errors++;
        console.error(`[metering] margin report failed for ${billing.tenantId}:`, err);
      }
    }

    return { processed, errors };
  });
}

/** Monday 00:00 UTC. UTC for the same reason periods are — one global boundary. */
function startOfWeek(at: Date): Date {
  const d = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 0, 0, 0, 0)
  );
  const offset = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - offset);
  return d;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

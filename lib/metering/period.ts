import "server-only";
import prisma from "@/lib/prisma";
import { currentScope } from "@/lib/tenant/context";

/**
 * Billing periods and the plan defaults that seed them.
 *
 * A tenant's period comes from TenantBilling. A tenant that has never been
 * billed has no row, and the answer must still be a real period rather than a
 * crash — someone who signed up an hour ago should see a usage page, not a 500.
 * getBilling() therefore creates the starter row on first read.
 */

export type BillingPeriod = { periodStart: Date; periodEnd: Date };

export type PlanKey = "starter" | "growth" | "enterprise";

export type PlanDefinition = {
  key: PlanKey;
  label: string;
  /** Credits included per billing period. */
  includedCredits: number;
  /**
   * Documents a tenant may ingest per period without it being metered.
   * Normal connector syncing must never cost credits (Section 0); this is the
   * line above which a run stops being a sync and starts being a backfill.
   */
  includedDocuments: number;
  /** Monthly list price in micro-USD, for the margin report's revenue side. */
  priceMicros: bigint;
  /** Whether an unused allowance survives the period rollover. */
  allowanceRollsOver: boolean;
  /** Per-feature credit ceilings applied on top of the balance. */
  featureCaps: Record<string, number>;
};

export const PLANS: Record<PlanKey, PlanDefinition> = {
  starter: {
    key: "starter",
    label: "Starter",
    includedCredits: 500,
    includedDocuments: 25_000,
    priceMicros: BigInt(19_000_000),
    allowanceRollsOver: false,
    // A starter tenant can spend its whole allowance on meetings, but not
    // discover a 200-credit retrain by clicking once.
    featureCaps: { model_retrain: 0 },
  },
  growth: {
    key: "growth",
    label: "Growth",
    includedCredits: 5_000,
    includedDocuments: 250_000,
    priceMicros: BigInt(149_000_000),
    allowanceRollsOver: false,
    featureCaps: {},
  },
  enterprise: {
    key: "enterprise",
    label: "Enterprise",
    includedCredits: 50_000,
    includedDocuments: 2_500_000,
    priceMicros: BigInt(999_000_000),
    allowanceRollsOver: true,
    featureCaps: {},
  },
};

export function isPlanKey(value: string): value is PlanKey {
  return Object.hasOwn(PLANS, value);
}

const DEFAULT_PLAN: PlanKey = "starter";

/**
 * The calendar month containing `at`, in UTC.
 *
 * UTC rather than local time so a period boundary is the same instant for every
 * tenant and every worker. A period that starts at a different moment depending
 * on which server evaluated it makes the allowance job either skip a tenant or
 * grant twice.
 */
export function monthPeriod(at: Date = new Date()): BillingPeriod {
  const periodStart = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1, 0, 0, 0, 0)
  );
  const periodEnd = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  );
  return { periodStart, periodEnd };
}

/** `YYYY-MM` — the period's stable identity in idempotency keys. */
export function periodKey(period: BillingPeriod): string {
  return period.periodStart.toISOString().slice(0, 7);
}

export type Billing = {
  tenantId: string;
  plan: PlanKey;
  includedCredits: number;
  periodStart: Date;
  periodEnd: Date;
  hardCapCredits: number | null;
  alertThresholds: number[];
  overageAllowed: boolean;
  featureCaps: Record<string, number>;
};

/**
 * Per-request memo for getBilling.
 *
 * Almost every function in this module needs the billing row, and a page load
 * touches a dozen of them. Without a memo that is a dozen round trips for one
 * unchanging row — and, worse, a dozen concurrent writes to the same primary
 * key, which serialise inside the transaction and hold the pooled connection
 * long enough to starve the pool for everyone else.
 *
 * Keyed on the AsyncLocalStorage scope object rather than on the tenant id, so
 * the memo lives exactly as long as one withTenant() call and cannot leak a
 * stale plan into the next request. A WeakMap so a finished scope is collected.
 */
const billingMemo = new WeakMap<object, Map<string, Promise<Billing>>>();

/**
 * The tenant's billing row, created on the starter plan if absent.
 *
 * READS FIRST. The row exists on every call but the first, so making the hot
 * path a findUnique keeps an ordinary page load free of writes; only a genuinely
 * new tenant pays for a create. The create is still upsert-shaped so two
 * concurrent first requests cannot race into a unique violation.
 */
export async function getBilling(tenantId: string): Promise<Billing> {
  const scope = currentScope();
  if (!scope) return loadBilling(tenantId);

  let perScope = billingMemo.get(scope);
  if (!perScope) {
    perScope = new Map();
    billingMemo.set(scope, perScope);
  }

  const cached = perScope.get(tenantId);
  if (cached) return cached;

  // The PROMISE is memoised, not the result, so concurrent callers inside one
  // scope share a single in-flight query instead of racing to issue their own.
  const pending = loadBilling(tenantId).catch((err) => {
    perScope.delete(tenantId); // a failure must not be cached
    throw err;
  });
  perScope.set(tenantId, pending);
  return pending;
}

async function loadBilling(tenantId: string): Promise<Billing> {
  const existing = await prisma.tenantBilling.findUnique({ where: { tenantId } });
  if (existing) return toBilling(existing);

  const period = monthPeriod();
  const plan = PLANS[DEFAULT_PLAN];

  const created = await prisma.tenantBilling.upsert({
    where: { tenantId },
    update: {},
    create: {
      tenantId,
      plan: plan.key,
      includedCredits: plan.includedCredits,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      alertThresholds: [75, 90],
      overageAllowed: true,
      featureCaps: plan.featureCaps,
    },
  });

  return toBilling(created);
}

type BillingRow = Awaited<ReturnType<typeof prisma.tenantBilling.findUnique>>;

function toBilling(row: NonNullable<BillingRow>): Billing {
  return {
    tenantId: row.tenantId,
    plan: isPlanKey(row.plan) ? row.plan : DEFAULT_PLAN,
    includedCredits: row.includedCredits.toNumber(),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    hardCapCredits: row.hardCapCredits?.toNumber() ?? null,
    alertThresholds: row.alertThresholds ?? [75, 90],
    overageAllowed: row.overageAllowed,
    featureCaps: normaliseCaps(row.featureCaps),
  };
}

/** The tenant's current period, without pulling the whole billing row. */
export async function currentPeriod(tenantId: string): Promise<BillingPeriod> {
  const billing = await getBilling(tenantId);
  return { periodStart: billing.periodStart, periodEnd: billing.periodEnd };
}

/**
 * featureCaps is Json, so it arrives as unknown and may be anything a previous
 * write put there. Non-numeric entries are dropped rather than coerced: a cap
 * of NaN compares false against every spend and would silently disable itself.
 */
function normaliseCaps(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

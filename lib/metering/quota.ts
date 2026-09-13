import "server-only";
import prisma from "@/lib/prisma";
import { decimalToNumber, getBalance, getPeriodSpend } from "./balance";
import { getBilling } from "./period";
import { PRICE_BOOK, type MeteredFeature } from "./pricebook";

/**
 * Quota enforcement.
 *
 * RULE 4-1 — A RUNNING SESSION IS NEVER KILLED FOR QUOTA. The check happens
 * once, before a meeting joins / a retrain starts / a backfill begins. If it
 * passes, the work runs to completion even if that takes the balance negative.
 * A bot ejecting itself halfway through someone's meeting is a worse experience
 * than a small overage, and it is the kind of worse that gets talked about.
 *
 * RULE 4-2 — THE CORE LOOP IS NEVER CHECKED. Chat, search, viewing forecasts
 * and the Brain work at a zero balance, at a hit cap, on a suspended plan. They
 * are included in the subscription, and gating them to protect margin destroys
 * the habit the product is built on. There is deliberately no code path in this
 * file that can reach them: checkQuota only accepts a metered feature key.
 */

export type QuotaDenialReason =
  | "feature_cap"
  | "hard_cap"
  | "insufficient_credits";

export type QuotaDecision =
  | {
      ok: true;
      /** The session is allowed but will finish in overage (RULE 4-1). */
      willGoNegative: boolean;
      balance: number;
    }
  | {
      ok: false;
      reason: QuotaDenialReason;
      balance: number;
      /** Customer-safe explanation. Never mentions cost, margin, or tokens. */
      message: string;
    };

/**
 * May this tenant start `estimatedCredits` worth of `feature` right now?
 *
 * The estimate is the caller's honest guess at the whole session — a 60-minute
 * meeting is 60 credits, not 1. Checking against one minute would let a tenant
 * with 1 credit start an hour-long session, which is RULE 4-1 turned into a
 * loophole.
 */
export async function checkQuota(
  tenantId: string,
  feature: MeteredFeature,
  estimatedCredits: number
): Promise<QuotaDecision> {
  const [billing, balance] = await Promise.all([
    getBilling(tenantId),
    getBalance(tenantId),
  ]);

  const label = PRICE_BOOK[feature].displayName;

  // Per-feature ceiling first: it is the most specific limit, so it gives the
  // most actionable message when several would deny at once.
  const featureCap = billing.featureCaps[feature];
  if (typeof featureCap === "number") {
    const spentOnFeature = await getPeriodSpend(tenantId, feature);
    if (spentOnFeature + estimatedCredits > featureCap) {
      return {
        ok: false,
        reason: "feature_cap",
        balance,
        message:
          featureCap === 0
            ? `${label} is not included on your plan.`
            : `${label} has reached its limit of ${featureCap} credits for this period.`,
      };
    }
  }

  if (billing.hardCapCredits !== null) {
    const spent = await getPeriodSpend(tenantId);
    if (spent >= billing.hardCapCredits) {
      return {
        ok: false,
        reason: "hard_cap",
        balance,
        message: `This workspace has reached its spending cap of ${billing.hardCapCredits} credits for this period. Chat, search, and forecasts keep working.`,
      };
    }
  }

  const wouldGoNegative = balance - estimatedCredits < 0;
  if (wouldGoNegative && !billing.overageAllowed) {
    return {
      ok: false,
      reason: "insufficient_credits",
      balance,
      message: `Not enough credits left for ${label}. Add credits or turn on overage to continue.`,
    };
  }

  return { ok: true, willGoNegative: wouldGoNegative, balance };
}

/**
 * Estimate the credits a session will consume, for the check above.
 *
 * Separate from creditsFor() because the two answer different questions:
 * creditsFor prices work that HAS happened, this prices work that MIGHT. Where
 * the duration is unknown the estimate is deliberately generous — under-
 * estimating admits a session that cannot be paid for, and RULE 4-1 then
 * guarantees it runs anyway.
 */
export function estimateSessionCredits(
  feature: MeteredFeature,
  expectedQuantity: number
): number {
  return expectedQuantity * PRICE_BOOK[feature].creditsPerUnit;
}

/** Default expected sizes, used when a caller genuinely cannot know. */
export const SESSION_ESTIMATES = {
  /** A calendar hour is the common case; most meetings run shorter. */
  meeting_agent: 60,
  model_retrain: 1,
  /** One batch of the pipeline's page size, in thousands of documents. */
  bulk_ingest: 1,
} as const;

/**
 * Which metered features are currently unavailable, for the UI banner.
 *
 * Returns the denial reasons, so the page can name the cap that stopped things
 * rather than showing a generic "limit reached" that nobody can act on.
 *
 * Answers all six features from THREE queries — the billing row, the balance,
 * and one groupBy over the period — evaluating the rules in memory.
 *
 * It used to call checkQuota in a loop, which read the billing row and the
 * per-feature spend once per feature. That is roughly thirty round trips for a
 * banner that is usually empty, issued inside a transaction holding a pooled
 * connection, on a page that every dashboard view loads. The rules below are
 * the same rules checkQuota applies; only the number of queries changed.
 */
export async function pausedFeatures(
  tenantId: string
): Promise<{ feature: MeteredFeature; reason: QuotaDenialReason; message: string }[]> {
  const [billing, balance, spendByFeature] = await Promise.all([
    getBilling(tenantId),
    getBalance(tenantId),
    periodSpendByFeature(tenantId),
  ]);

  const totalSpend = [...spendByFeature.values()].reduce((sum, v) => sum + v, 0);
  const capReached =
    billing.hardCapCredits !== null && totalSpend >= billing.hardCapCredits;
  const outOfCredits = balance <= 0 && !billing.overageAllowed;

  const paused: { feature: MeteredFeature; reason: QuotaDenialReason; message: string }[] = [];

  for (const feature of Object.keys(PRICE_BOOK) as MeteredFeature[]) {
    const label = PRICE_BOOK[feature].displayName;
    const cap = billing.featureCaps[feature];

    // Same precedence as checkQuota: most specific limit first, so the message
    // names the thing the reader can actually change.
    if (typeof cap === "number" && (spendByFeature.get(feature) ?? 0) >= cap) {
      paused.push({
        feature,
        reason: "feature_cap",
        message:
          cap === 0
            ? `${label} is not included on your plan.`
            : `${label} has reached its limit of ${cap} credits for this period.`,
      });
      continue;
    }

    if (capReached) {
      paused.push({
        feature,
        reason: "hard_cap",
        message: `${label} is paused — this workspace reached its spending cap of ${billing.hardCapCredits} credits.`,
      });
      continue;
    }

    if (outOfCredits) {
      paused.push({
        feature,
        reason: "insufficient_credits",
        message: `${label} is paused — no credits left and overage is off.`,
      });
    }
  }

  return paused;
}

/** Credits spent per feature this period, in one grouped query. */
async function periodSpendByFeature(
  tenantId: string
): Promise<Map<string, number>> {
  const billing = await getBilling(tenantId);
  const grouped = await prisma.usageEvent.groupBy({
    by: ["feature"],
    where: {
      tenantId,
      occurredAt: { gte: billing.periodStart, lt: billing.periodEnd },
    },
    _sum: { credits: true },
  });

  return new Map(
    grouped.map((row) => [row.feature, decimalToNumber(row._sum.credits)])
  );
}

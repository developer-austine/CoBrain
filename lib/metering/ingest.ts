import "server-only";
import prisma from "@/lib/prisma";
import { decimalToNumber } from "./balance";
import { getBilling, PLANS } from "./period";
import { checkQuota, type QuotaDecision } from "./quota";
import { COST_MODEL } from "./pricebook";
import { meterUnmetered } from "./meter";
import { meterBulkIngest } from "./wrappers";

/**
 * Ingest metering — the one cost source in this repository that has a real
 * call site today.
 *
 * The pricing philosophy makes this more than a multiplication. A connector
 * syncing normal volume is INCLUDED and must never cost a credit; only bulk
 * historical backfill above the plan's included volume is metered. So every
 * batch does two things:
 *
 *   1. records its full volume as an unmetered row — zero credits, real cost,
 *      real quantity. This is what the margin report reads, and it is what the
 *      included-allowance arithmetic below sums.
 *   2. meters only the portion that exceeded the remaining included volume.
 *
 * Doing (1) for every batch is what makes (2) honest. Without a durable record
 * of included volume, "above the plan's included volume" would have to be
 * guessed from batch size, and a customer syncing steadily all month would
 * eventually be charged for a sync.
 */

/** Included volume is tracked in the same kdoc unit the price book uses. */
const DOCS_PER_KDOC = 1000;

/**
 * Included ingest volume already consumed this period, in thousands of docs.
 *
 * Sums the unmetered rows rather than the billed ones: the billed rows only
 * ever contain the excess, so summing those would say a tenant had used none of
 * their allowance right up until the moment they exceeded it.
 */
async function periodIngestKdoc(tenantId: string): Promise<number> {
  const billing = await getBilling(tenantId);
  const total = await prisma.usageEvent.aggregate({
    _sum: { quantity: true },
    where: {
      tenantId,
      feature: "connector_sync",
      unit: "kdoc",
      occurredAt: { gte: billing.periodStart, lt: billing.periodEnd },
    },
  });
  return decimalToNumber(total._sum.quantity);
}

/**
 * How much of `documentCount` would be billable right now.
 *
 * Exposed separately from recording so the quota check can ask the question
 * before the work starts (RULE 4-1) using the same arithmetic that will price
 * it afterwards. Two different formulas either side of the check is how a
 * session gets admitted and then billed for something else.
 */
export async function billableDocuments(
  tenantId: string,
  documentCount: number
): Promise<number> {
  const billing = await getBilling(tenantId);
  const includedKdoc = PLANS[billing.plan].includedDocuments / DOCS_PER_KDOC;
  const usedKdoc = await periodIngestKdoc(tenantId);
  const remainingFree = Math.max(0, includedKdoc - usedKdoc);
  const batchKdoc = documentCount / DOCS_PER_KDOC;

  return Math.max(0, batchKdoc - remainingFree) * DOCS_PER_KDOC;
}

/**
 * May this tenant start a backfill of `pendingDocuments`?
 *
 * Checked BEFORE the queue is written, and never again — once documents are on
 * the queue the pipeline finishes them (RULE 4-1). A backfill that stopped
 * halfway would leave the Brain holding a partial corpus, which is worse than
 * an overage because it is silently wrong rather than merely expensive.
 */
export async function checkIngestQuota(
  tenantId: string,
  pendingDocuments: number
): Promise<QuotaDecision> {
  const billable = await billableDocuments(tenantId, pendingDocuments);
  if (billable <= 0) {
    // Entirely inside the included volume. Not a metered operation at all, so
    // it is not quota-checked (RULE 4-2).
    return { ok: true, willGoNegative: false, balance: Number.POSITIVE_INFINITY };
  }
  return checkQuota(
    tenantId,
    "bulk_ingest",
    (billable / DOCS_PER_KDOC) * 10 // bulk_ingest is 10 credits per kdoc
  );
}

/**
 * Record one queued batch: its full volume, and its billable excess.
 *
 * Both writes are idempotent on the batch id, so a retried run of the same
 * batch neither double-counts the allowance nor double-charges the excess.
 */
export async function recordIngestBatch(args: {
  tenantId: string;
  actorUserId?: string | null;
  batchId: string;
  documentCount: number;
  source?: string;
}): Promise<{ billedDocuments: number }> {
  if (args.documentCount <= 0) return { billedDocuments: 0 };

  const batchKdoc = args.documentCount / DOCS_PER_KDOC;
  const billable = await billableDocuments(args.tenantId, args.documentCount);

  // (1) The full volume, always. Zero credits, real cost.
  await meterUnmetered({
    tenantId: args.tenantId,
    actorUserId: args.actorUserId,
    feature: "connector_sync",
    quantity: batchKdoc,
    unit: "kdoc",
    costMicros:
      (BigInt(Math.round(batchKdoc * 1_000_000)) *
        COST_MODEL.bulk_ingest.costMicrosPerUnit) /
      BigInt(1_000_000),
    idempotencyKey: `ingest-volume:${args.batchId}`,
    metadata: { batchId: args.batchId, documents: args.documentCount, source: args.source },
  });

  // (2) Only the excess is charged.
  if (billable > 0) {
    await meterBulkIngest({
      tenantId: args.tenantId,
      actorUserId: args.actorUserId,
      batchId: args.batchId,
      billableDocuments: billable,
      source: args.source,
    });
  }

  return { billedDocuments: billable };
}

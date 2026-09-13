import "server-only";
import prisma from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  COST_MODEL,
  PRICE_BOOK,
  costMicrosFor,
  creditsFor,
  type MeteredFeature,
  type UnmeteredFeature,
} from "./pricebook";
import { adjustCachedBalance } from "./balance";

/**
 * meter() — the only function in this codebase that writes a billable row.
 *
 * LAW 2: it is called from lib/metering/wrappers.ts and nowhere else. Business
 * logic never calls it directly. Metering scattered through route handlers is
 * metering that misses paths, and a missed path is silent undercounting that
 * only surfaces when the cloud bill does.
 *
 * LAW 3: every call carries a deterministic idempotency key. A retry, a crash
 * resume, or a duplicate webhook delivery must never bill twice, so a unique
 * violation on that key is a SUCCESS — the work was already recorded — and is
 * swallowed rather than thrown.
 *
 * Tenant scoping: the write goes through the ambient `prisma` proxy, so inside
 * withTenant() it lands on the tenant-bound connection and RLS applies. The
 * explicit tenantId is still passed because the WITH CHECK clause compares it
 * against app.tenant_id — a mismatched id is rejected by Postgres rather than
 * quietly written to the wrong ledger.
 */

export type MeterArgs = {
  tenantId: string;
  /** Null/undefined for system or scheduled work no person triggered. */
  actorUserId?: string | null;
  feature: MeteredFeature;
  /** In the feature's native unit — minutes, kchar, kdoc, runs. */
  quantity: number;
  /** Deterministic. See IDEMPOTENCY_KEYS below; never random. */
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

/** Result of a meter call, so a caller can log what actually happened. */
export type MeterResult = {
  /** False when the key already existed — the work was billed by an earlier attempt. */
  recorded: boolean;
  credits: number;
};

const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === UNIQUE_VIOLATION
  );
}

export async function meter(args: MeterArgs): Promise<MeterResult> {
  const { tenantId, feature, quantity, idempotencyKey } = args;

  if (!tenantId) throw new Error("meter() requires a tenantId");
  if (!idempotencyKey) throw new Error("meter() requires an idempotencyKey (LAW 3)");
  if (!Number.isFinite(quantity)) {
    throw new Error(`meter() got a non-finite quantity for ${feature}: ${quantity}`);
  }
  // A negative quantity here would be a silent credit refund. Corrections are
  // deliberate — see recordCorrection — and go through their own door.
  if (quantity < 0) {
    throw new Error(
      `meter() cannot take a negative quantity (${quantity}); use recordCorrection()`
    );
  }

  const credits = creditsFor(feature, quantity);

  try {
    await prisma.usageEvent.create({
      data: {
        tenantId,
        actorUserId: args.actorUserId ?? null,
        feature,
        quantity: new Prisma.Decimal(quantity),
        unit: PRICE_BOOK[feature].unit,
        credits: new Prisma.Decimal(credits),
        costMicros: costMicrosFor(feature, quantity),
        idempotencyKey,
        metadata: (args.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // LAW 3. Already billed by an earlier attempt: report it, change nothing.
    // Critically, the cache is NOT adjusted here — doing so would decrement the
    // balance a second time for a charge that was only written once.
    if (isUniqueViolation(err)) return { recorded: false, credits };
    throw err;
  }

  // Best-effort cache maintenance. The ledger is truth (LAW 1) and the nightly
  // reconciliation rebuilds this from it, so a Redis failure must not roll back
  // a charge that Postgres has already durably accepted.
  await adjustCachedBalance(tenantId, -credits).catch((err) => {
    console.warn(`[metering] balance cache not updated for ${tenantId}:`, err);
  });

  return { recorded: true, credits };
}

/**
 * Record what an UNMETERED action cost us, charging the customer nothing.
 *
 * The core loop must feel free — metering questions makes people ask fewer
 * questions, which kills retention and the data flywheel both. It is not free
 * to serve, though, so the cost still reaches the margin report. Zero credits,
 * real costMicros.
 *
 * Deliberately a separate function from meter(): "charge nothing" and "charge
 * something" reading identically at the call site is how a zero-rated feature
 * eventually starts billing by accident.
 *
 * `quantity` is real and summable, not a placeholder 1. It is how the included
 * allowance is tracked: bulk ingest bills only the volume above what the plan
 * includes, and "what has this tenant already used of the included volume" has
 * to be answerable by a plain aggregate over these rows.
 */
export async function meterUnmetered(args: {
  tenantId: string;
  actorUserId?: string | null;
  feature: UnmeteredFeature;
  costMicros: bigint;
  idempotencyKey: string;
  /** In `unit`s. Defaults to one occurrence. */
  quantity?: number;
  unit?: string;
  metadata?: Record<string, unknown>;
}): Promise<MeterResult> {
  try {
    await prisma.usageEvent.create({
      data: {
        tenantId: args.tenantId,
        actorUserId: args.actorUserId ?? null,
        feature: args.feature,
        quantity: new Prisma.Decimal(args.quantity ?? 1),
        unit: args.unit ?? "run",
        credits: new Prisma.Decimal(0),
        costMicros: args.costMicros,
        idempotencyKey: args.idempotencyKey,
        metadata: {
          ...(args.metadata ?? {}),
          unmetered: true,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { recorded: false, credits: 0 };
    throw err;
  }
  // No cache adjustment: zero credits cannot move a balance.
  return { recorded: true, credits: 0 };
}

/**
 * Reverse a charge without rewriting history (LAW 1).
 *
 * The database rejects UPDATE and DELETE on UsageEvent outright, so a
 * correction is a new row with negative credits pointing at the row it
 * corrects. The ledger then shows both the mistake and the fix, which is what
 * makes a billing dispute answerable.
 */
export async function recordCorrection(args: {
  tenantId: string;
  correctsEventId: string;
  feature: MeteredFeature;
  /** Positive number of credits to give back. */
  credits: number;
  reason: string;
  actorUserId?: string | null;
}): Promise<MeterResult> {
  if (args.credits <= 0) {
    throw new Error("A correction must return a positive number of credits");
  }

  const key = `correction:${args.correctsEventId}`;
  const giveBack = -args.credits;

  try {
    await prisma.usageEvent.create({
      data: {
        tenantId: args.tenantId,
        actorUserId: args.actorUserId ?? null,
        feature: args.feature,
        quantity: new Prisma.Decimal(0),
        unit: PRICE_BOOK[args.feature].unit,
        credits: new Prisma.Decimal(giveBack),
        costMicros: BigInt(0), // the cost was real and is not reversed by a refund
        idempotencyKey: key,
        metadata: {
          reason: "correction",
          correctsEventId: args.correctsEventId,
          note: args.reason,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { recorded: false, credits: giveBack };
    throw err;
  }

  await adjustCachedBalance(args.tenantId, args.credits).catch(() => {});
  return { recorded: true, credits: giveBack };
}

/**
 * Idempotency key recipes — deterministic, never random.
 *
 * Centralised so the key a retry computes is byte-identical to the one the
 * first attempt computed. A key built ad hoc at two call sites is a key that
 * eventually differs by a timestamp, and that is a double charge.
 */
export const IDEMPOTENCY_KEYS = {
  meetingMinute: (meetingId: string, minuteIndex: number) =>
    `meeting:${meetingId}:min:${minuteIndex}`,
  voiceSynthesis: (utteranceId: string) => `tts:${utteranceId}`,
  bulkIngest: (batchId: string) => `ingest:${batchId}`,
  /** `period` is YYYY-MM — one charge per target per calendar month. */
  forecastTarget: (targetId: string, period: string) =>
    `forecast:${targetId}:${period}`,
  modelRetrain: (runId: string) => `retrain:${runId}`,
  /** Requests are billed in hourly buckets, not one row per request. */
  apiRequests: (tenantId: string, hourStamp: string, bucketIndex: number) =>
    `api:${tenantId}:${hourStamp}:${bucketIndex}`,
} as const;

/** Exported for the margin report, which needs cost without re-deriving it. */
export { COST_MODEL };

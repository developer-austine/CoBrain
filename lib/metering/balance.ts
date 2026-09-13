import "server-only";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/queue/publisher";
import { Prisma } from "@/lib/generated/prisma/client";
import { currentPeriod, type BillingPeriod } from "./period";

/**
 * Balances — derived from the ledger, cached in Redis.
 *
 * LAW 1: the number in Redis is never the answer to "what does this tenant
 * owe". It is a fast approximation of a SUM over two append-only tables, kept
 * so the quota check at session start is a single GET rather than two
 * aggregates. Every path here can fall back to the ledger, and the nightly
 * reconciliation rebuilds the cache from it unconditionally.
 *
 * The cache is shared with the ingest queue's connection rather than opening a
 * second one — one client per process, and metering is not worth a new socket.
 */

const CACHE_TTL_SECONDS = 60 * 60 * 26; // outlives the nightly rebuild
const BALANCE_KEY = (tenantId: string) => `${tenantId}:credits:balance`;

/**
 * How long any single cache operation may take before we give up on it.
 *
 * This is not a nicety. ioredis queues commands while it is disconnected and
 * retries them with backoff, so `await redis.get(...)` against a down Redis does
 * not fail — it HANGS. Every one of these calls happens inside a withTenant
 * transaction holding a pooled Postgres connection, so a Redis outage would
 * quietly convert into Postgres pool exhaustion and take down pages that have
 * nothing to do with metering.
 *
 * A cache is optional by definition. If it cannot answer in 250ms, the ledger
 * can.
 */
const CACHE_TIMEOUT_MS = 250;

/**
 * Race a cache operation against the clock, resolving to `fallback` on timeout
 * or error. Never rejects: no cache failure may fail a request.
 */
async function cacheOp<T>(
  operation: () => Promise<T>,
  fallback: T,
  what: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[metering] balance cache ${what} timed out; falling back to the ledger`);
          resolve(fallback);
        }, CACHE_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    console.warn(`[metering] balance cache ${what} failed:`, err);
    return fallback;
  } finally {
    // The losing promise keeps running either way; clearing the timer just
    // stops a pending handle from holding the event loop open in short jobs.
    if (timer) clearTimeout(timer);
  }
}

/** Redis stores floats as strings; anything unparseable is treated as a miss. */
function parseCached(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Credits granted minus credits spent, for the current billing period.
 *
 * Reads the cache first and recomputes on a miss. A miss is ordinary — a cold
 * Redis, a new tenant, an evicted key — so it must be cheap and correct, not an
 * error.
 */
export async function getBalance(tenantId: string): Promise<number> {
  // A Redis outage degrades to "always recompute", which is slower and right.
  const cached = parseCached(
    await cacheOp(() => redis.get(BALANCE_KEY(tenantId)), null, "read")
  );
  if (cached !== null) return cached;

  const fresh = await computeBalanceFromLedger(tenantId);
  await writeCachedBalance(tenantId, fresh);
  return fresh;
}

/**
 * The authoritative balance: SUM(grants) - SUM(usage) over the period.
 *
 * Both sums are done in Postgres rather than by loading rows — a busy tenant
 * has hundreds of thousands of ledger rows a month, and the answer is one
 * number.
 */
export async function computeBalanceFromLedger(
  tenantId: string,
  period?: BillingPeriod
): Promise<number> {
  const window = period ?? (await currentPeriod(tenantId));

  const [granted, spent] = await Promise.all([
    prisma.creditLedger.aggregate({
      _sum: { credits: true },
      where: {
        tenantId,
        createdAt: { gte: window.periodStart, lt: window.periodEnd },
      },
    }),
    prisma.usageEvent.aggregate({
      _sum: { credits: true },
      where: {
        tenantId,
        occurredAt: { gte: window.periodStart, lt: window.periodEnd },
      },
    }),
  ]);

  return decimalToNumber(granted._sum.credits) - decimalToNumber(spent._sum.credits);
}

/** Credits consumed this period, optionally for one feature (§4.2 caps). */
export async function getPeriodSpend(
  tenantId: string,
  feature?: string,
  period?: BillingPeriod
): Promise<number> {
  const window = period ?? (await currentPeriod(tenantId));

  const spent = await prisma.usageEvent.aggregate({
    _sum: { credits: true },
    where: {
      tenantId,
      ...(feature ? { feature } : {}),
      occurredAt: { gte: window.periodStart, lt: window.periodEnd },
    },
  });

  return decimalToNumber(spent._sum.credits);
}

/**
 * Move the cached balance by `delta` credits (negative for a charge).
 *
 * INCRBYFLOAT rather than read-modify-write: two concurrent charges doing
 * GET-then-SET would lose one of them, and the loser is revenue. The operation
 * is a no-op when the key is absent-and-then-created at the wrong value, so a
 * missing key is populated from the ledger first.
 */
export async function adjustCachedBalance(
  tenantId: string,
  delta: number
): Promise<void> {
  const key = BALANCE_KEY(tenantId);
  // Treated as "present" on a timeout so a slow cache does not trigger a full
  // ledger recompute on every charge.
  const exists = await cacheOp(() => redis.exists(key), 1, "exists");

  if (!exists) {
    // Populate from truth, which already includes the row that triggered this
    // call — applying the delta on top would count that charge twice.
    const fresh = await computeBalanceFromLedger(tenantId);
    await writeCachedBalance(tenantId, fresh);
    return;
  }

  await cacheOp(() => redis.incrbyfloat(key, delta), "", "increment");
  await cacheOp(() => redis.expire(key, CACHE_TTL_SECONDS), 0, "expire");
}

export async function writeCachedBalance(
  tenantId: string,
  balance: number
): Promise<void> {
  await cacheOp(
    () => redis.set(BALANCE_KEY(tenantId), String(balance), "EX", CACHE_TTL_SECONDS),
    "OK" as const,
    "write"
  );
}

export async function invalidateCachedBalance(tenantId: string): Promise<void> {
  await cacheOp(() => redis.del(BALANCE_KEY(tenantId)), 0, "delete");
}

/**
 * Rebuild the cache from the ledger and report the drift that was there.
 *
 * The drift is the interesting output, not the rebuild. A cache that was wrong
 * by more than a rounding error means a charge was written while Redis was
 * unreachable, or two processes disagreed — either way it is an incident, and
 * the nightly job logs it as one.
 */
export async function reconcileBalance(tenantId: string): Promise<{
  tenantId: string;
  cached: number | null;
  actual: number;
  drift: number;
}> {
  const cached = parseCached(
    await cacheOp(() => redis.get(BALANCE_KEY(tenantId)), null, "read")
  );
  const actual = await computeBalanceFromLedger(tenantId);
  await writeCachedBalance(tenantId, actual);

  return {
    tenantId,
    cached,
    actual,
    drift: cached === null ? 0 : Math.abs(cached - actual),
  };
}

/** Prisma hands back Decimal | null; the UI and the cache want a number. */
export function decimalToNumber(value: Prisma.Decimal | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return value.toNumber();
}

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reconciliation — the ledger is truth (LAW 1).
 *
 * The property under test is that a synthetic ledger reproduces the exact
 * cached balance, and that when it does not, the drift is detected rather than
 * silently overwritten. Rebuilding the cache is the easy half; noticing that it
 * WAS wrong is the half that tells you a charge went missing while Redis was
 * unreachable.
 */

type LedgerRow = { credits: number; at: Date };

const grants: LedgerRow[] = [];
const usage: LedgerRow[] = [];
const store = new Map<string, string>();

/** Sums exactly the way the real aggregate does — inside the period window. */
const sumIn = (rows: LedgerRow[], from: Date, to: Date) =>
  rows.filter((r) => r.at >= from && r.at < to).reduce((s, r) => s + r.credits, 0);

const PERIOD = {
  periodStart: new Date("2026-08-01T00:00:00.000Z"),
  periodEnd: new Date("2026-09-01T00:00:00.000Z"),
};

vi.mock("@/lib/prisma", () => ({
  default: {
    creditLedger: {
      aggregate: vi.fn(async ({ where }: never) => {
        const w = (where as { createdAt: { gte: Date; lt: Date } }).createdAt;
        return { _sum: { credits: decimal(sumIn(grants, w.gte, w.lt)) } };
      }),
    },
    usageEvent: {
      aggregate: vi.fn(async ({ where }: never) => {
        const w = (where as { occurredAt: { gte: Date; lt: Date } }).occurredAt;
        return { _sum: { credits: decimal(sumIn(usage, w.gte, w.lt)) } };
      }),
    },
  },
}));

vi.mock("@/lib/queue/publisher", () => ({
  redis: {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    }),
    del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
    exists: vi.fn(async (k: string) => (store.has(k) ? 1 : 0)),
    incrbyfloat: vi.fn(async (k: string, delta: number) => {
      const next = Number(store.get(k) ?? 0) + delta;
      store.set(k, String(next));
      return String(next);
    }),
    expire: vi.fn(async () => 1),
  },
}));

vi.mock("../period", () => ({
  currentPeriod: vi.fn(async () => PERIOD),
}));

vi.mock("@/lib/generated/prisma/client", () => ({ Prisma: {} }));

function decimal(value: number) {
  return { toNumber: () => value };
}

const {
  adjustCachedBalance,
  computeBalanceFromLedger,
  getBalance,
  reconcileBalance,
  writeCachedBalance,
} = await import("../balance");

const KEY = "tenant_a:credits:balance";

beforeEach(() => {
  grants.length = 0;
  usage.length = 0;
  store.clear();
});

describe("balance derivation", () => {
  it("is grants minus usage for the period", async () => {
    grants.push({ credits: 500, at: new Date("2026-08-01T00:00:00Z") });
    usage.push({ credits: 120.5, at: new Date("2026-08-10T00:00:00Z") });
    usage.push({ credits: 30.25, at: new Date("2026-08-14T00:00:00Z") });

    expect(await computeBalanceFromLedger("tenant_a")).toBeCloseTo(349.25, 6);
  });

  it("ignores rows outside the period", async () => {
    grants.push({ credits: 500, at: new Date("2026-08-01T00:00:00Z") });
    // Last month's spend must not reduce this month's balance.
    usage.push({ credits: 400, at: new Date("2026-07-20T00:00:00Z") });
    // Next month's allowance must not inflate it either.
    grants.push({ credits: 500, at: new Date("2026-09-01T00:00:00Z") });

    expect(await computeBalanceFromLedger("tenant_a")).toBe(500);
  });

  it("counts a correction's negative row as a refund", async () => {
    grants.push({ credits: 100, at: new Date("2026-08-02T00:00:00Z") });
    usage.push({ credits: 40, at: new Date("2026-08-03T00:00:00Z") });
    usage.push({ credits: -40, at: new Date("2026-08-04T00:00:00Z") }); // correction

    expect(await computeBalanceFromLedger("tenant_a")).toBe(100);
  });
});

describe("reconcileBalance()", () => {
  it("reproduces the exact ledger balance in the cache", async () => {
    grants.push({ credits: 1_000, at: new Date("2026-08-01T00:00:00Z") });
    for (let i = 0; i < 37; i++) {
      usage.push({ credits: 1.5, at: new Date("2026-08-05T00:00:00Z") });
    }
    await writeCachedBalance("tenant_a", 999); // deliberately wrong

    const result = await reconcileBalance("tenant_a");

    expect(result.actual).toBeCloseTo(1_000 - 55.5, 6);
    expect(Number(store.get(KEY))).toBeCloseTo(result.actual, 6);
  });

  it("reports drift when the cache disagreed", async () => {
    grants.push({ credits: 200, at: new Date("2026-08-01T00:00:00Z") });
    usage.push({ credits: 50, at: new Date("2026-08-06T00:00:00Z") });
    // A charge that landed while Redis was unreachable: the cache never moved.
    await writeCachedBalance("tenant_a", 200);

    const result = await reconcileBalance("tenant_a");

    expect(result.cached).toBe(200);
    expect(result.actual).toBe(150);
    expect(result.drift).toBe(50);
  });

  it("reports no drift when the cache was already right", async () => {
    grants.push({ credits: 300, at: new Date("2026-08-01T00:00:00Z") });
    usage.push({ credits: 12.34, at: new Date("2026-08-07T00:00:00Z") });
    await writeCachedBalance("tenant_a", 287.66);

    const result = await reconcileBalance("tenant_a");

    // Below the 0.01 incident threshold the nightly job uses.
    expect(result.drift).toBeLessThan(0.01);
  });

  it("treats a cold cache as zero drift, not as an incident", async () => {
    grants.push({ credits: 300, at: new Date("2026-08-01T00:00:00Z") });

    const result = await reconcileBalance("tenant_a");

    // An evicted or never-written key is ordinary. Reporting it as drift would
    // page someone every time Redis restarts.
    expect(result.cached).toBeNull();
    expect(result.drift).toBe(0);
    expect(Number(store.get(KEY))).toBe(300);
  });
});

describe("cache maintenance", () => {
  it("recomputes on a miss rather than answering zero", async () => {
    grants.push({ credits: 750, at: new Date("2026-08-01T00:00:00Z") });
    usage.push({ credits: 250, at: new Date("2026-08-09T00:00:00Z") });

    expect(await getBalance("tenant_a")).toBe(500);
    expect(Number(store.get(KEY))).toBe(500);
  });

  it("populates from the ledger instead of applying a delta to a missing key", async () => {
    // The charge is ALREADY in the ledger when meter() calls this. Applying the
    // delta on top of a fresh recompute would count it twice.
    grants.push({ credits: 100, at: new Date("2026-08-01T00:00:00Z") });
    usage.push({ credits: 10, at: new Date("2026-08-02T00:00:00Z") });

    await adjustCachedBalance("tenant_a", -10);

    expect(Number(store.get(KEY))).toBe(90);
  });

  it("applies the delta when the key already exists", async () => {
    await writeCachedBalance("tenant_a", 90);
    await adjustCachedBalance("tenant_a", -10);

    expect(Number(store.get(KEY))).toBe(80);
  });

  it("survives concurrent charges without losing one", async () => {
    await writeCachedBalance("tenant_a", 100);

    // Read-modify-write would drop one of these; INCRBYFLOAT does not.
    await Promise.all([
      adjustCachedBalance("tenant_a", -1),
      adjustCachedBalance("tenant_a", -1),
      adjustCachedBalance("tenant_a", -1),
      adjustCachedBalance("tenant_a", -1),
    ]);

    expect(Number(store.get(KEY))).toBe(96);
  });
});

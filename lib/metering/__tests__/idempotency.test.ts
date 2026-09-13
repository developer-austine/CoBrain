import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * LAW 3 — every metered operation is idempotent.
 *
 * This is the test the build order gates on, and it is the one that matters
 * most: a double charge is the category of bug customers do not forgive, and it
 * is produced by exactly the ordinary conditions this suite simulates — a
 * retry, a resumed job, a redelivered webhook.
 *
 * Prisma and Redis are faked rather than mocked loosely, because the property
 * under test is a behaviour of the pair: the unique violation must be swallowed
 * AND the cached balance must not move. Asserting only the first would pass
 * while the balance silently drifted down on every retry.
 */

// ── Fakes ─────────────────────────────────────────────────────────────────
/** Rows written, keyed by idempotencyKey, imitating the unique index. */
const rows = new Map<string, Record<string, unknown>>();
/** Every balance mutation, so a double-decrement is visible rather than netted. */
const balanceAdjustments: number[] = [];

class FakeKnownRequestError extends Error {
  code: string;
  constructor(code: string) {
    super(`fake prisma error ${code}`);
    this.code = code;
  }
}

const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
  const key = String(data.idempotencyKey);
  if (rows.has(key)) throw new FakeKnownRequestError("P2002");
  rows.set(key, data);
  return { id: `row_${rows.size}`, ...data };
});

vi.mock("@/lib/prisma", () => ({
  default: { usageEvent: { create: (args: never) => create(args) } },
}));

vi.mock("@/lib/generated/prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: FakeKnownRequestError,
    // decimal.js semantics are not what this suite is testing; the number is
    // carried through so the assertions can read it back.
    Decimal: class {
      value: number;
      constructor(v: number | string) {
        this.value = Number(v);
      }
      toNumber() {
        return this.value;
      }
    },
  },
}));

vi.mock("../balance", () => ({
  adjustCachedBalance: vi.fn(async (_tenantId: string, delta: number) => {
    balanceAdjustments.push(delta);
  }),
}));

const { meter, recordCorrection, IDEMPOTENCY_KEYS } = await import("../meter");

beforeEach(() => {
  rows.clear();
  balanceAdjustments.length = 0;
  create.mockClear();
});

// ── The law ───────────────────────────────────────────────────────────────
describe("meter() idempotency (LAW 3)", () => {
  const call = () =>
    meter({
      tenantId: "tenant_a",
      actorUserId: "user_1",
      feature: "meeting_agent",
      quantity: 1,
      idempotencyKey: "meeting:m_42:min:7",
    });

  it("writes exactly one row for two calls with the same key", async () => {
    const first = await call();
    const second = await call();

    expect(rows.size).toBe(1);
    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
  });

  it("does not decrement the balance twice", async () => {
    await call();
    await call();
    await call();

    // Three attempts, one charge. Anything else is money invented or lost.
    expect(balanceAdjustments).toEqual([-1]);
  });

  it("reports the credits of the duplicate so callers can log correctly", async () => {
    await call();
    const second = await call();

    // The charge stands even though this attempt wrote nothing — a caller
    // logging `credits` must see what the operation cost, not zero.
    expect(second.credits).toBe(1);
  });

  it("still bills a different minute of the same meeting", async () => {
    await call();
    await meter({
      tenantId: "tenant_a",
      feature: "meeting_agent",
      quantity: 1,
      idempotencyKey: "meeting:m_42:min:8",
    });

    expect(rows.size).toBe(2);
    expect(balanceAdjustments).toEqual([-1, -1]);
  });

  it("rethrows errors that are not unique violations", async () => {
    create.mockImplementationOnce(async () => {
      throw new FakeKnownRequestError("P1001"); // cannot reach the database
    });

    await expect(call()).rejects.toThrow();
    expect(balanceAdjustments).toEqual([]);
  });
});

describe("price application", () => {
  it("prices by the native unit, not by the raw count", async () => {
    await meter({
      tenantId: "tenant_a",
      feature: "voice_synthesis", // 0.5 credits per 1k characters
      quantity: 4, // 4k characters
      idempotencyKey: "tts:u_1",
    });

    expect(balanceAdjustments).toEqual([-2]);
    expect(rows.get("tts:u_1")?.unit).toBe("kchar");
  });

  it("records our cost alongside the customer charge", async () => {
    await meter({
      tenantId: "tenant_a",
      feature: "bulk_ingest", // 40_000 micros per 1k documents
      quantity: 2.5,
      idempotencyKey: "ingest:b_1",
    });

    expect(rows.get("ingest:b_1")?.costMicros).toBe(BigInt(100_000));
  });

  it("does not round a fractional quantity's cost to zero", async () => {
    // A 12-second clip is 0.012 kchar. Rounding the quantity before the BigInt
    // multiply would report that this cost us nothing.
    await meter({
      tenantId: "tenant_a",
      feature: "voice_synthesis",
      quantity: 0.012,
      idempotencyKey: "tts:u_short",
    });

    expect(rows.get("tts:u_short")?.costMicros).toBeGreaterThan(BigInt(0));
  });
});

describe("guards", () => {
  const base = {
    tenantId: "tenant_a",
    feature: "meeting_agent" as const,
    quantity: 1,
    idempotencyKey: "k",
  };

  it("refuses a call with no idempotency key", async () => {
    await expect(meter({ ...base, idempotencyKey: "" })).rejects.toThrow(/LAW 3/);
  });

  it("refuses a negative quantity", async () => {
    // A negative charge is a refund. Refunds go through recordCorrection, where
    // they leave an auditable trail, rather than through an unexpected sign.
    await expect(meter({ ...base, quantity: -5 })).rejects.toThrow(/recordCorrection/);
  });

  it("refuses a non-finite quantity", async () => {
    await expect(meter({ ...base, quantity: Number.NaN })).rejects.toThrow();
  });
});

describe("recordCorrection()", () => {
  it("writes a negative row rather than mutating the original", async () => {
    await meter({
      tenantId: "tenant_a",
      feature: "meeting_agent",
      quantity: 10,
      idempotencyKey: "meeting:m_9:min:1",
    });

    await recordCorrection({
      tenantId: "tenant_a",
      correctsEventId: "row_1",
      feature: "meeting_agent",
      credits: 10,
      reason: "bot failed to join",
    });

    expect(rows.size).toBe(2);
    const correction = rows.get("correction:row_1");
    expect(correction?.credits).toMatchObject({ value: -10 });
    expect(correction?.metadata).toMatchObject({
      reason: "correction",
      correctsEventId: "row_1",
    });
    // Charged 10, refunded 10.
    expect(balanceAdjustments).toEqual([-10, 10]);
  });

  it("is itself idempotent", async () => {
    const args = {
      tenantId: "tenant_a",
      correctsEventId: "row_x",
      feature: "meeting_agent" as const,
      credits: 5,
      reason: "duplicate session",
    };

    await recordCorrection(args);
    const second = await recordCorrection(args);

    expect(second.recorded).toBe(false);
    expect(balanceAdjustments).toEqual([5]);
  });

  it("does not reverse our real cost", async () => {
    // The provider charged us whether or not we bill the customer. Zeroing the
    // cost on a refund would make the margin report claim a free session.
    await recordCorrection({
      tenantId: "tenant_a",
      correctsEventId: "row_y",
      feature: "meeting_agent",
      credits: 3,
      reason: "goodwill",
    });

    expect(rows.get("correction:row_y")?.costMicros).toBe(BigInt(0));
  });
});

describe("idempotency key recipes", () => {
  it("are deterministic for the same inputs", () => {
    expect(IDEMPOTENCY_KEYS.meetingMinute("m1", 3)).toBe(
      IDEMPOTENCY_KEYS.meetingMinute("m1", 3)
    );
  });

  it("match the spec's recipes exactly", () => {
    expect(IDEMPOTENCY_KEYS.meetingMinute("m1", 3)).toBe("meeting:m1:min:3");
    expect(IDEMPOTENCY_KEYS.voiceSynthesis("u1")).toBe("tts:u1");
    expect(IDEMPOTENCY_KEYS.bulkIngest("b1")).toBe("ingest:b1");
    expect(IDEMPOTENCY_KEYS.forecastTarget("t1", "2026-08")).toBe("forecast:t1:2026-08");
    expect(IDEMPOTENCY_KEYS.modelRetrain("r1")).toBe("retrain:r1");
    expect(IDEMPOTENCY_KEYS.apiRequests("ten", "2026-08-24-13", 0)).toBe(
      "api:ten:2026-08-24-13:0"
    );
  });
});

import { describe, it, expect } from "vitest";
import {
  SYNC_INTERVALS_MS,
  SYNC_LOCK_TIMEOUT_MS,
  isDue,
  isLocked,
  isSyncSource,
  msUntilDue,
  shouldSync,
} from "../policy";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("sync cadence", () => {
  it("refreshes email every 5 minutes", () => {
    expect(SYNC_INTERVALS_MS.gmail).toBe(5 * MIN);
  });

  it("refreshes knowledge sources every 3 hours", () => {
    expect(SYNC_INTERVALS_MS.notion).toBe(3 * HOUR);
    expect(SYNC_INTERVALS_MS.slack).toBe(3 * HOUR);
    expect(SYNC_INTERVALS_MS.drive).toBe(3 * HOUR);
    expect(SYNC_INTERVALS_MS.github).toBe(3 * HOUR);
  });
});

describe("isDue", () => {
  it("is due when never synced", () => {
    expect(isDue("gmail", null, NOW)).toBe(true);
    expect(isDue("notion", undefined, NOW)).toBe(true);
  });

  it("gmail: not due at 4 minutes, due at 5", () => {
    expect(isDue("gmail", ago(4 * MIN), NOW)).toBe(false);
    expect(isDue("gmail", ago(5 * MIN), NOW)).toBe(true);
    expect(isDue("gmail", ago(6 * MIN), NOW)).toBe(true);
  });

  it("notion: not due at 2h59m, due at 3h", () => {
    expect(isDue("notion", ago(3 * HOUR - MIN), NOW)).toBe(false);
    expect(isDue("notion", ago(3 * HOUR), NOW)).toBe(true);
  });

  it("a source is not dragged along by another source's cadence", () => {
    // 10 minutes since last sync: email is stale, notion is nowhere near due.
    const last = ago(10 * MIN);
    expect(isDue("gmail", last, NOW)).toBe(true);
    expect(isDue("notion", last, NOW)).toBe(false);
  });
});

describe("isLocked", () => {
  it("is not locked when no run is in flight", () => {
    expect(isLocked(null, NOW)).toBe(false);
  });

  it("is locked while a recent run is in flight", () => {
    expect(isLocked(ago(MIN), NOW)).toBe(true);
  });

  it("a lock older than the timeout is presumed dead", () => {
    expect(isLocked(ago(SYNC_LOCK_TIMEOUT_MS + MIN), NOW)).toBe(false);
  });
});

describe("shouldSync", () => {
  it("runs when due and free", () => {
    expect(shouldSync("gmail", { lastSyncedAt: ago(10 * MIN) }, NOW)).toBe(true);
  });

  it("does not run when not due", () => {
    expect(shouldSync("gmail", { lastSyncedAt: ago(MIN) }, NOW)).toBe(false);
  });

  it("does not start a second run while one is in flight", () => {
    expect(
      shouldSync("gmail", { lastSyncedAt: ago(10 * MIN), syncingSince: ago(MIN) }, NOW)
    ).toBe(false);
  });

  it("takes over a stale lock so a crashed run can't wedge the source", () => {
    expect(
      shouldSync(
        "gmail",
        { lastSyncedAt: ago(10 * MIN), syncingSince: ago(SYNC_LOCK_TIMEOUT_MS + MIN) },
        NOW
      )
    ).toBe(true);
  });

  it("runs a brand-new connection with no state", () => {
    expect(shouldSync("notion", null, NOW)).toBe(true);
  });
});

describe("msUntilDue", () => {
  it("is 0 when never synced or already due", () => {
    expect(msUntilDue("gmail", null, NOW)).toBe(0);
    expect(msUntilDue("gmail", ago(6 * MIN), NOW)).toBe(0);
  });

  it("reports the remaining wait", () => {
    expect(msUntilDue("gmail", ago(2 * MIN), NOW)).toBe(3 * MIN);
  });
});

describe("isSyncSource", () => {
  it("accepts polled sources", () => {
    expect(isSyncSource("gmail")).toBe(true);
    expect(isSyncSource("notion")).toBe(true);
  });

  it("rejects unknown sources and webhook-only custom", () => {
    // custom_api is push/webhook-driven — it must never be polled.
    expect(isSyncSource("custom")).toBe(false);
    expect(isSyncSource("nope")).toBe(false);
  });
});

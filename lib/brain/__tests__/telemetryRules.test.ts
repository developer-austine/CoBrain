import { describe, expect, it } from "vitest";
import {
  connectorState,
  derivedState,
  forecastState,
  newest,
  LIVE_WINDOW_MS,
} from "@/lib/brain/telemetryRules";

describe("connectorState", () => {
  const base = {
    hasConnection: true,
    syncError: null,
    syncing: false,
    recentEvents15m: 0,
    lastActivityAt: null,
  };

  it("reports an error even while the connector is mid-sync", () => {
    // The whole point of the coral node: a connector that is both syncing and
    // failing is a failing connector, and the movement must not hide that.
    expect(
      connectorState({
        ...base,
        syncError: "token expired",
        syncing: true,
        recentEvents15m: 40,
      })
    ).toBe("error");
  });

  it("is idle, not live, when nothing is connected", () => {
    expect(connectorState({ ...base, hasConnection: false })).toBe("idle");
  });

  it("is active while syncing with no events yet", () => {
    expect(connectorState({ ...base, syncing: true })).toBe("active");
  });

  it("is active on recent events alone", () => {
    expect(connectorState({ ...base, recentEvents15m: 1 })).toBe("active");
  });

  it("falls back to live inside the hour and idle outside it", () => {
    const now = Date.now();

    expect(
      connectorState({
        ...base,
        lastActivityAt: new Date(now - LIVE_WINDOW_MS + 60_000),
        now,
      })
    ).toBe("live");

    expect(
      connectorState({
        ...base,
        lastActivityAt: new Date(now - LIVE_WINDOW_MS - 60_000),
        now,
      })
    ).toBe("idle");
  });
});

describe("derivedState", () => {
  it("stays live with no recent writes — the knowledge is still there", () => {
    expect(derivedState(0)).toBe("live");
    expect(derivedState(3)).toBe("active");
  });
});

describe("forecastState", () => {
  it("degrades to error on a drift alarm even when forecasts are fresh", () => {
    // A drifting model looks healthiest from the outside precisely when it is
    // still writing confident forecasts, so the alarm has to outrank activity.
    expect(
      forecastState({ driftAlarm: true, cold: false, recentEvents15m: 9 })
    ).toBe("error");
  });

  it("marks thin history cold rather than pretending it is fine", () => {
    expect(
      forecastState({ driftAlarm: false, cold: true, recentEvents15m: 0 })
    ).toBe("cold");
  });

  it("is otherwise the ordinary derived ladder", () => {
    expect(
      forecastState({ driftAlarm: false, cold: false, recentEvents15m: 0 })
    ).toBe("live");
    expect(
      forecastState({ driftAlarm: false, cold: false, recentEvents15m: 2 })
    ).toBe("active");
  });
});

describe("newest", () => {
  it("ignores nulls and returns the latest timestamp", () => {
    const a = new Date("2026-01-01T00:00:00Z");
    const b = new Date("2026-06-01T00:00:00Z");
    expect(newest(a, null, b, undefined)).toBe(b);
  });

  it("returns null when there is nothing to compare", () => {
    expect(newest(null, undefined)).toBeNull();
  });
});

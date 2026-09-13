import { describe, expect, it } from "vitest";
import {
  bandWidth,
  formatSigma,
  medianChange,
  quantileBands,
  type Forecast,
} from "../types";

const forecast = (o: Partial<Forecast> = {}): Forecast => ({
  target: "burnout_risk",
  weeks: ["2026-01-05", "2026-01-12"],
  quantiles: { "0.1": [-1, -1], "0.5": [0, 0], "0.9": [1, 1] },
  lowConfidence: false,
  observedWeeks: 10,
  drivers: [],
  history: [],
  hasSignal: true,
  ...o,
});

describe("medianChange", () => {
  it("measures the move from the recent baseline to the horizon end", () => {
    const f = forecast({
      history: [1, 1, 1, 1].map((v, i) => ({ week: `w${i}`, value: v })),
      quantiles: { "0.1": [0, 0], "0.5": [1, 2], "0.9": [3, 3] },
    });
    expect(medianChange(f)).toBe(1);
  });

  it("ignores a single low final week", () => {
    // The last bucket is usually a partial week and reads artificially low;
    // anchoring the headline number to it inflated every move.
    const steady = forecast({
      history: [1, 1, 1, 1].map((v, i) => ({ week: `w${i}`, value: v })),
      quantiles: { "0.1": [0, 0], "0.5": [1, 1], "0.9": [2, 2] },
    });
    const withPartial = forecast({
      history: [1, 1, 1, -3].map((v, i) => ({ week: `w${i}`, value: v })),
      quantiles: { "0.1": [0, 0], "0.5": [1, 1], "0.9": [2, 2] },
    });

    expect(medianChange(steady)).toBe(0);
    expect(Math.abs(medianChange(withPartial))).toBeLessThan(1);
  });

  it("still reflects a genuine sustained shift", () => {
    const f = forecast({
      history: [3, 3, 3, 3].map((v, i) => ({ week: `w${i}`, value: v })),
      quantiles: { "0.1": [0, 0], "0.5": [0, 0], "0.9": [1, 1] },
    });
    expect(medianChange(f)).toBe(-3);
  });

  it("falls back to the first forecast point with no history", () => {
    expect(medianChange(forecast({ history: [] }))).toBe(0);
  });
});

describe("bandWidth", () => {
  it("is the P10–P90 spread at the horizon end", () => {
    expect(bandWidth(forecast())).toBe(2);
  });
});

describe("formatSigma", () => {
  it("signs the value and marks the unit", () => {
    expect(formatSigma(0.5)).toBe("+0.50σ");
    expect(formatSigma(-1.234)).toBe("-1.23σ");
  });

  it("collapses noise around zero rather than showing -0.00σ", () => {
    expect(formatSigma(-0.01)).toBe("0.00σ");
  });
});

describe("quantileBands", () => {
  it("pairs the trained checkpoint's three heads into one interval", () => {
    // CFG.QUANTILES is (0.1, 0.5, 0.9) today, so the honest fan is a single
    // 10-90 band. Rendering more would mean inventing intervals.
    expect(quantileBands(forecast())).toEqual([
      { lower: "0.1", upper: "0.9", label: "10–90%" },
    ]);
  });

  it("nests outward-in when a retrain adds more heads", () => {
    const wide = forecast({
      quantiles: {
        "0.01": [-3], "0.05": [-2], "0.1": [-1], "0.25": [-0.5],
        "0.5": [0],
        "0.75": [0.5], "0.9": [1], "0.95": [2], "0.99": [3],
      },
    });
    // Outermost first, so the denser inner bands paint on top of it.
    expect(quantileBands(wide).map((b) => b.label)).toEqual([
      "1–99%", "5–95%", "10–90%", "25–75%",
    ]);
  });

  it("excludes the median — it is a line, not an interval", () => {
    for (const band of quantileBands(forecast())) {
      expect(band.lower).not.toBe("0.5");
      expect(band.upper).not.toBe("0.5");
    }
  });

  it("drops an unpaired level rather than pairing it with itself", () => {
    const lopsided = forecast({ quantiles: { "0.1": [-1], "0.5": [0] } });
    expect(quantileBands(lopsided)).toEqual([]);
  });

  it("returns nothing when there are no intervals to draw", () => {
    expect(quantileBands(forecast({ quantiles: { "0.5": [0] } }))).toEqual([]);
    expect(quantileBands(forecast({ quantiles: {} }))).toEqual([]);
  });
});

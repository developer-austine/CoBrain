import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS, priceForCycle, YEARLY_DISCOUNT } from "@/lib/pricing/plans";

describe("priceForCycle", () => {
  it("returns the list price for monthly billing", () => {
    expect(priceForCycle(49, "monthly")).toBe(49);
  });

  it("applies the 25% yearly discount, floored", () => {
    expect(priceForCycle(19, "yearly")).toBe(14); // 14.25 → 14
    expect(priceForCycle(49, "yearly")).toBe(36); // 36.75 → 36
    expect(priceForCycle(129, "yearly")).toBe(96); // 96.75 → 96
  });

  it("keeps Free at zero on every cycle", () => {
    expect(priceForCycle(0, "monthly")).toBe(0);
    expect(priceForCycle(0, "yearly")).toBe(0);
  });

  it("discount constant matches the advertised badge", () => {
    expect(YEARLY_DISCOUNT).toBe(0.25);
  });
});

describe("DEFAULT_PLANS catalog", () => {
  it("ships the four advertised tiers in order", () => {
    expect(DEFAULT_PLANS.map((p) => p.name)).toEqual(["Free", "Starter", "Pro", "Scale"]);
  });

  it("has exactly one Most Popular tier", () => {
    expect(DEFAULT_PLANS.filter((p) => p.isPopular)).toHaveLength(1);
    expect(DEFAULT_PLANS.find((p) => p.isPopular)?.name).toBe("Pro");
  });

  it("every tier has a CTA and at least one feature", () => {
    for (const plan of DEFAULT_PLANS) {
      expect(plan.ctaText.length).toBeGreaterThan(0);
      expect(plan.features.length).toBeGreaterThan(0);
    }
  });

  it("prices ascend across tiers", () => {
    const prices = DEFAULT_PLANS.map((p) => p.monthlyPrice);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });
});

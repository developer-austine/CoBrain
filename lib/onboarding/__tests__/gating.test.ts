import { describe, expect, it } from "vitest";
import {
  INDUSTRIES,
  INDUSTRY_KEYS,
  industryLabel,
  isOnboardingComplete,
  PLAN_KEYS,
} from "@/lib/onboarding/constants";

describe("isOnboardingComplete", () => {
  it("is false with no profile (new user)", () => {
    expect(isOnboardingComplete(null)).toBe(false);
    expect(isOnboardingComplete(undefined)).toBe(false);
  });

  it("is false when the profile exists but no plan was chosen (bailed at plan step)", () => {
    expect(isOnboardingComplete({ plan: null })).toBe(false);
  });

  it("is true once any plan is chosen", () => {
    for (const plan of PLAN_KEYS) {
      expect(isOnboardingComplete({ plan })).toBe(true);
    }
  });
});

describe("industry vocabulary", () => {
  it("keeps keys unique", () => {
    expect(new Set(INDUSTRY_KEYS).size).toBe(INDUSTRIES.length);
  });

  it("keeps keys url/db-safe slugs", () => {
    // These are persisted on the profile and will key the label packs, so a
    // key with a space or a capital in it becomes a migration later.
    for (const key of INDUSTRY_KEYS) expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("pins the existing keys so a rename cannot pass silently", () => {
    // Renaming a key orphans every profile already carrying the old value.
    // Changing a *label* is free; changing a key must be a deliberate edit
    // here plus a data migration.
    expect(INDUSTRY_KEYS).toEqual([
      "technology", "healthcare", "finance", "legal", "education",
      "manufacturing", "retail", "media", "consulting", "construction",
      "logistics", "nonprofit", "government", "other",
    ]);
  });

  it("offers an escape hatch so nobody is forced into a wrong answer", () => {
    expect(INDUSTRY_KEYS).toContain("other");
  });

  it("resolves a label for every key", () => {
    for (const key of INDUSTRY_KEYS) expect(industryLabel(key)).toBeTruthy();
  });

  it("returns null for an unknown or absent industry", () => {
    // Profiles predating the field are null, and the UI must fall back to
    // neutral naming rather than guessing an industry for them.
    expect(industryLabel(null)).toBeNull();
    expect(industryLabel(undefined)).toBeNull();
    expect(industryLabel("aerospace")).toBeNull();
    expect(industryLabel("")).toBeNull();
  });
});

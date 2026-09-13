import { describe, it, expect } from "vitest";

/**
 * The typewriter's core decision, extracted so it can be tested without React:
 * given what we've already revealed and a new target, what prefix do we keep?
 *
 * Speech partials grow ("who" → "who was" → "who was given"), and occasionally
 * the recogniser revises the utterance. Growing must NOT restart the animation;
 * a revision must.
 */
function keptPrefix(shown: string, target: string): string {
  if (!target) return "";
  return target.startsWith(shown) ? shown : "";
}

describe("useTypewriter prefix logic", () => {
  it("keeps the revealed prefix while the partial merely grows", () => {
    expect(keptPrefix("who was", "who was given a task")).toBe("who was");
  });

  it("resets when the recogniser revises the utterance", () => {
    // "who was" → revised to "how was" — the prefix no longer holds.
    expect(keptPrefix("who was", "how was the meeting")).toBe("");
  });

  it("resets when the transcript is cleared", () => {
    expect(keptPrefix("who was", "")).toBe("");
  });

  it("is a no-op when nothing has been shown yet", () => {
    expect(keptPrefix("", "who was given a task")).toBe("");
  });

  it("keeps the full string once fully caught up", () => {
    expect(keptPrefix("who was given", "who was given")).toBe("who was given");
  });
});

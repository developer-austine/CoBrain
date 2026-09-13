import { describe, it, expect } from "vitest";
import { resolveSearchSources } from "../sourceScope";
import type { ParsedPrompt } from "../types";

const parsed = (o: Partial<ParsedPrompt> = {}): ParsedPrompt => ({
  prose: "",
  writeTargets: [],
  model: null,
  contextRefs: [],
  ...o,
});

describe("resolveSearchSources", () => {
  it("honours an explicit @notion entity mention", () => {
    const p = parsed({
      prose: "Who was given a task on this page?",
      contextRefs: [{ type: "entity", id: "notion", label: "@notion" }],
    });
    expect(resolveSearchSources(p, "QUERY")).toEqual(["notion"]);
  });

  it("supports multiple entity mentions", () => {
    const p = parsed({
      contextRefs: [
        { type: "entity", id: "notion", label: "@notion" },
        { type: "entity", id: "github", label: "@github" },
      ],
    });
    expect(resolveSearchSources(p, "QUERY")).toEqual(["notion", "github"]);
  });

  it("ignores non-source entities like @voice-agent", () => {
    const p = parsed({
      prose: "what is our refund policy",
      contextRefs: [{ type: "entity", id: "voice-agent", label: "@voice-agent" }],
    });
    expect(resolveSearchSources(p, "QUERY")).toEqual([]);
  });

  it("scopes a QUERY to @brain when the brain page is mentioned", () => {
    const p = parsed({ prose: "what do we know", writeTargets: ["brain"] });
    expect(resolveSearchSources(p, "QUERY")).toEqual(["brain"]);
  });

  it("does NOT read from @brain on a WRITE — it is the destination", () => {
    // "Edit the @brain page with who was given a task from @notion and why"
    const p = parsed({
      prose: "Edit the page with who was given a task and why",
      writeTargets: ["brain"],
      contextRefs: [{ type: "entity", id: "notion", label: "@notion" }],
    });
    expect(resolveSearchSources(p, "WRITE")).toEqual(["notion"]);
  });

  it("on a WRITE with only @brain, does not scope the search to brain", () => {
    const p = parsed({ prose: "remember that we ship on friday", writeTargets: ["brain"] });
    expect(resolveSearchSources(p, "WRITE")).toEqual([]);
  });

  it("falls back to prose keywords when nothing is mentioned", () => {
    const p = parsed({ prose: "what tasks are in notion?" });
    expect(resolveSearchSources(p, "QUERY")).toEqual(["notion"]);
  });

  it("entity mentions beat prose keywords", () => {
    // Prose says "email" but the user explicitly tokenised @notion.
    const p = parsed({
      prose: "summarize the email thread",
      contextRefs: [{ type: "entity", id: "notion", label: "@notion" }],
    });
    expect(resolveSearchSources(p, "QUERY")).toEqual(["notion"]);
  });

  it("returns empty (search everything) for an unscoped question", () => {
    expect(resolveSearchSources(parsed({ prose: "what is our refund policy?" }))).toEqual([]);
  });
});

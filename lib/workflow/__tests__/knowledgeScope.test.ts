import { describe, it, expect } from "vitest";
import {
  resolveUpstreamWorkflows,
  resolveKnowledgeScope,
  canLink,
  type WorkflowLinkEdge,
} from "../knowledgeScope";

const link = (s: string, t: string): WorkflowLinkEdge => ({
  sourceWorkflowId: s,
  targetWorkflowId: t,
});

describe("resolveUpstreamWorkflows", () => {
  it("finds the direct feeder (A -> B means B reads A)", () => {
    expect(resolveUpstreamWorkflows("B", [link("A", "B")])).toEqual(["A"]);
  });

  it("does not flow backwards (A cannot read B)", () => {
    expect(resolveUpstreamWorkflows("A", [link("A", "B")])).toEqual([]);
  });

  it("is transitive: A -> B -> C lets C read both B and A", () => {
    const links = [link("A", "B"), link("B", "C")];
    expect(resolveUpstreamWorkflows("C", links)).toEqual(["B", "A"]);
  });

  it("merges several feeders into one workflow", () => {
    const links = [link("A", "C"), link("B", "C")];
    expect(resolveUpstreamWorkflows("C", links).sort()).toEqual(["A", "B"]);
  });

  it("survives a cycle in the data without hanging", () => {
    // Corrupted rows: A -> B -> A. Must terminate and not include the self.
    const links = [link("A", "B"), link("B", "A")];
    expect(resolveUpstreamWorkflows("A", links)).toEqual(["B"]);
  });

  it("returns nothing for an unlinked workflow", () => {
    expect(resolveUpstreamWorkflows("solo", [])).toEqual([]);
  });
});

describe("resolveKnowledgeScope", () => {
  it("always includes the workflow itself, then its upstream", () => {
    const links = [link("A", "B"), link("B", "C")];
    expect(resolveKnowledgeScope("C", links)).toEqual(["C", "B", "A"]);
  });

  it("is just the workflow when nothing is linked", () => {
    expect(resolveKnowledgeScope("solo", [])).toEqual(["solo"]);
  });
});

describe("canLink", () => {
  it("allows a fresh link", () => {
    expect(canLink("A", "B", [])).toEqual({ ok: true });
  });

  it("refuses a self-link", () => {
    const r = canLink("A", "A", []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/itself/i);
  });

  it("refuses a duplicate link", () => {
    const r = canLink("A", "B", [link("A", "B")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already connected/i);
  });

  it("refuses a direct cycle (B -> A when A -> B exists)", () => {
    const r = canLink("B", "A", [link("A", "B")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/loop/i);
  });

  it("refuses a transitive cycle (C -> A when A -> B -> C exists)", () => {
    const existing = [link("A", "B"), link("B", "C")];
    const r = canLink("C", "A", existing);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/loop/i);
  });

  it("allows a diamond (not a cycle): A->B, A->C, then B->D and C->D", () => {
    const existing = [link("A", "B"), link("A", "C"), link("B", "D")];
    expect(canLink("C", "D", existing)).toEqual({ ok: true });
  });
});

import { describe, expect, it } from "vitest";
import {
  createDefaultPipeline,
  createOnboardingPipeline,
  ONBOARDING_SOURCES,
} from "@/lib/connector/createDefaultPipeline";
import { SOURCE_OPTIONS } from "@/lib/onboarding/constants";
import { TaskType } from "@/types/task";

describe("createDefaultPipeline", () => {
  it("builds the 6-node core pipeline with 5 edges", () => {
    const { nodes, edges } = createDefaultPipeline();
    expect(nodes).toHaveLength(6);
    expect(edges).toHaveLength(5);
  });

  it("every edge connects two existing nodes", () => {
    const { nodes, edges } = createDefaultPipeline();
    const ids = new Set(nodes.map((n) => n.id));
    for (const e of edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });
});

describe("createOnboardingPipeline", () => {
  it("adds one node + one edge per chosen source", () => {
    const { nodes, edges } = createOnboardingPipeline(["gmail", "notion", "slack"]);
    expect(nodes).toHaveLength(6 + 3);
    expect(edges).toHaveLength(5 + 3);
  });

  it("creates the right task types for chosen sources", () => {
    const { nodes } = createOnboardingPipeline(["gmail", "github"]);
    const types = nodes.map((n) => n.data.type);
    expect(types).toContain(TaskType.GMAIL_SOURCE);
    expect(types).toContain(TaskType.GITHUB_SOURCE);
  });

  it("wires every source into the Normalizer's Document Stream input", () => {
    const { nodes, edges } = createOnboardingPipeline(["gmail", "notion"]);
    const normalizer = nodes.find((n) => n.data.type === TaskType.NORMALIZER)!;
    const sourceIds = nodes
      .filter((n) => n.data.type === TaskType.GMAIL_SOURCE || n.data.type === TaskType.NOTION_SOURCE)
      .map((n) => n.id);

    const sourceEdges = edges.filter((e) => sourceIds.includes(e.source));
    expect(sourceEdges).toHaveLength(2);
    for (const e of sourceEdges) {
      expect(e.target).toBe(normalizer.id);
      expect(e.sourceHandle).toBe("Document Stream");
      expect(e.targetHandle).toBe("Document Stream");
    }
  });

  it("ignores unknown keys and dedupes repeats", () => {
    const { nodes, edges } = createOnboardingPipeline(["gmail", "gmail", "not-a-source"]);
    expect(nodes).toHaveLength(6 + 1);
    expect(edges).toHaveLength(5 + 1);
  });

  it("with no sources equals the default pipeline shape", () => {
    const { nodes, edges } = createOnboardingPipeline([]);
    expect(nodes).toHaveLength(6);
    expect(edges).toHaveLength(5);
  });

  it("stacks source nodes without overlapping positions", () => {
    const { nodes } = createOnboardingPipeline(["gmail", "notion", "slack"]);
    const sourcePositions = nodes.slice(6).map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(sourcePositions).size).toBe(sourcePositions.length);
  });
});

describe("onboarding source catalog", () => {
  it("every UI source option maps to a registered task type", () => {
    for (const opt of SOURCE_OPTIONS) {
      expect(ONBOARDING_SOURCES[opt.key], `missing mapping for ${opt.key}`).toBeDefined();
    }
  });
});

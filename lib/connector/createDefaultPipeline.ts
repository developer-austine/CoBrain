import { Edge } from "@xyflow/react";
import { AppNode } from "@/types/appNode";
import { CreateFlowNode } from "./createFlowNode";
import { TaskType } from "@/types/task";

/**
 * Connector keys a user can pick during onboarding, mapped to their source
 * task type and the output handle every source exposes.
 */
export const ONBOARDING_SOURCES: Record<string, TaskType> = {
  gmail: TaskType.GMAIL_SOURCE,
  slack: TaskType.SLACK_SOURCE,
  notion: TaskType.NOTION_SOURCE,
  drive: TaskType.DRIVE_SOURCE,
  jira: TaskType.JIRA_SOURCE,
  linear: TaskType.LINEAR_SOURCE,
  github: TaskType.GITHUB_SOURCE,
  confluence: TaskType.CONFLUENCE_SOURCE,
  custom: TaskType.CUSTOM_API_SOURCE,
};

const SOURCE_OUTPUT_HANDLE = "Document Stream";
const NORMALIZER_INPUT_HANDLE = "Document Stream";

/**
 * Builds the core processing pipeline pre-wired together so non-technical users
 * only have to connect their source (Gmail, Notion, Slack, GitHub, …) to the
 * Normalizer. Everything downstream — PII scrubbing, chunking, embedding,
 * deduplication and vector storage — is already connected.
 *
 *   [your source] ─▶ Normalizer ─▶ PII Scrubber ─▶ Chunker ─▶ Embedder
 *                                                                 │
 *                                                                 ▼
 *                                              Vector Store ◀─ Deduplicator
 *
 * The Normalizer's "Document Stream" input is intentionally left open — that is
 * the single handle the user wires their connector into.
 *
 * Handle ids equal the task param `name` (see NodeInputs/NodeOutputs), and the
 * execution plan validates links by `targetHandle === input.name`, so the
 * sourceHandle/targetHandle strings below must match the registry param names.
 */
export function createDefaultPipeline(): { nodes: AppNode[]; edges: Edge[] } {
  const normalizer   = CreateFlowNode(TaskType.NORMALIZER,   { x: 160,  y: 160 });
  const piiScrubber  = CreateFlowNode(TaskType.PII_SCRUBBER, { x: 640,  y: 160 });
  const chunker      = CreateFlowNode(TaskType.CHUNKER,      { x: 1120, y: 160 });
  const embedder     = CreateFlowNode(TaskType.EMBEDDER,     { x: 1600, y: 160 });
  const deduplicator = CreateFlowNode(TaskType.DEDUPLICATOR, { x: 2080, y: 160 });
  const vectorStore  = CreateFlowNode(TaskType.VECTOR_STORE, { x: 2080, y: 620 });

  const nodes: AppNode[] = [
    normalizer,
    piiScrubber,
    chunker,
    embedder,
    deduplicator,
    vectorStore,
  ];

  const link = (
    source: AppNode,
    sourceHandle: string,
    target: AppNode,
    targetHandle: string
  ): Edge => ({
    id: crypto.randomUUID(),
    source: source.id,
    target: target.id,
    sourceHandle,
    targetHandle,
    animated: true,
  });

  const edges: Edge[] = [
    link(normalizer,   "Clean Stream",    piiScrubber,  "Clean Stream"),
    link(piiScrubber,  "Scrubbed Stream", chunker,      "Scrubbed Stream"),
    link(chunker,      "Chunk Stream",    embedder,     "Chunk Stream"),
    link(embedder,     "Vector Stream",   deduplicator, "Chunk Stream"),
    link(deduplicator, "Deduped Stream",  vectorStore,  "Vector Stream"),
  ];

  return { nodes, edges };
}

/**
 * Onboarding pipeline: the core pipeline PLUS a node for every source the
 * user picked, each already wired into the Normalizer — the personalized,
 * end-to-end starting canvas. Unknown source keys are ignored.
 *
 *   Gmail  ─┐
 *   Notion ─┼▶ Normalizer ─▶ … ─▶ Vector Store
 *   Slack  ─┘
 */
export function createOnboardingPipeline(sourceKeys: string[]): {
  nodes: AppNode[];
  edges: Edge[];
} {
  const { nodes, edges } = createDefaultPipeline();
  const normalizer = nodes.find((n) => n.data.type === TaskType.NORMALIZER);
  if (!normalizer) throw new Error("Default pipeline is missing its Normalizer node");

  const validKeys = [...new Set(sourceKeys)].filter((k) => k in ONBOARDING_SOURCES);

  validKeys.forEach((key, i) => {
    const sourceNode = CreateFlowNode(ONBOARDING_SOURCES[key], {
      x: -480,
      y: 40 + i * 420,
    });
    nodes.push(sourceNode);
    edges.push({
      id: crypto.randomUUID(),
      source: sourceNode.id,
      target: normalizer.id,
      sourceHandle: SOURCE_OUTPUT_HANDLE,
      targetHandle: NORMALIZER_INPUT_HANDLE,
      animated: true,
    });
  });

  return { nodes, edges };
}

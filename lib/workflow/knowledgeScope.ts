/**
 * Knowledge flow between workflows.
 *
 * A link `source -> target` means the TARGET workflow may also search the
 * SOURCE workflow's ingested knowledge. Flow is transitive: with A -> B -> C,
 * workflow C can read A's knowledge as well as B's.
 *
 * This is what makes the Brain multi-source: a "Support" workflow linked to an
 * "Engineering" workflow can cite Engineering's GitHub issues without
 * re-ingesting them.
 *
 * Cycles are refused at write time (see canLink) rather than tolerated at read
 * time, so the graph stays a DAG and the closure always terminates. The
 * traversal is defensive against cycles anyway — a corrupted row must never
 * hang a query.
 *
 * Pure module — no I/O, unit-tested in isolation.
 */

export type WorkflowLinkEdge = {
  sourceWorkflowId: string;
  targetWorkflowId: string;
};

/**
 * Every workflow whose knowledge flows INTO `workflowId`, transitively.
 * Excludes `workflowId` itself. Order is breadth-first (nearest first).
 */
export function resolveUpstreamWorkflows(
  workflowId: string,
  links: WorkflowLinkEdge[]
): string[] {
  // target -> [sources feeding it]
  const feeders = new Map<string, string[]>();
  for (const l of links) {
    const bucket = feeders.get(l.targetWorkflowId);
    if (bucket) bucket.push(l.sourceWorkflowId);
    else feeders.set(l.targetWorkflowId, [l.sourceWorkflowId]);
  }

  const seen = new Set<string>([workflowId]);
  const out: string[] = [];
  const queue = [...(feeders.get(workflowId) ?? [])];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue; // cycle-safe
    seen.add(id);
    out.push(id);
    queue.push(...(feeders.get(id) ?? []));
  }

  return out;
}

/**
 * The full set of workflows a query running in `workflowId` may read:
 * itself plus everything upstream.
 */
export function resolveKnowledgeScope(
  workflowId: string,
  links: WorkflowLinkEdge[]
): string[] {
  return [workflowId, ...resolveUpstreamWorkflows(workflowId, links)];
}

export type LinkRefusal = { ok: false; reason: string };
export type LinkOk = { ok: true };

/**
 * Guard a proposed link. Refuses self-links, duplicates, and any link that
 * would introduce a cycle (i.e. the target already feeds the source).
 */
export function canLink(
  sourceWorkflowId: string,
  targetWorkflowId: string,
  existing: WorkflowLinkEdge[]
): LinkOk | LinkRefusal {
  if (sourceWorkflowId === targetWorkflowId) {
    return { ok: false, reason: "A workflow can't connect to itself." };
  }

  const duplicate = existing.some(
    (l) =>
      l.sourceWorkflowId === sourceWorkflowId &&
      l.targetWorkflowId === targetWorkflowId
  );
  if (duplicate) {
    return { ok: false, reason: "These workflows are already connected." };
  }

  // Adding source -> target creates a cycle iff target already reaches source,
  // i.e. target is somewhere upstream of source.
  const upstreamOfSource = resolveUpstreamWorkflows(sourceWorkflowId, existing);
  if (upstreamOfSource.includes(targetWorkflowId)) {
    return {
      ok: false,
      reason: "That would create a loop — knowledge already flows the other way.",
    };
  }

  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import {
  canLink,
  resolveUpstreamWorkflows,
  type WorkflowLinkEdge,
} from "@/lib/workflow/knowledgeScope";

/**
 * Workflow knowledge links (blueprint §9 — multi-source Brain).
 *
 * `source -> target` means the target workflow may also search the source
 * workflow's ingested knowledge, transitively. Every operation is scoped to
 * the signed-in user, and cycles are refused at write time so the graph stays
 * a DAG.
 */

export type WorkflowLinkView = {
  id: string;
  sourceWorkflowId: string;
  targetWorkflowId: string;
};

async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Unauthenticated");
  return userId;
}

/** All links owned by the current user. */
export async function listWorkflowLinks(): Promise<WorkflowLinkView[]> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    return prisma.workflowLink.findMany({
      where: { userId },
      select: { id: true, sourceWorkflowId: true, targetWorkflowId: true },
      orderBy: { createdAt: "asc" },
    });
  });
}

export type LinkResult = { ok: true } | { ok: false; error: string };

/** Connect two workflows so knowledge flows source -> target. */
export async function linkWorkflows(
  sourceWorkflowId: string,
  targetWorkflowId: string
): Promise<LinkResult> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {

    // Both workflows must belong to the caller.
    const owned = await prisma.workflow.count({
      where: { userId, id: { in: [sourceWorkflowId, targetWorkflowId] } },
    });
    if (owned !== 2) return { ok: false, error: "Workflow not found." };

    const existing: WorkflowLinkEdge[] = await prisma.workflowLink.findMany({
      where: { userId },
      select: { sourceWorkflowId: true, targetWorkflowId: true },
    });

    const verdict = canLink(sourceWorkflowId, targetWorkflowId, existing);
    if (!verdict.ok) return { ok: false, error: verdict.reason };

    await prisma.workflowLink.create({
      data: { userId, sourceWorkflowId, targetWorkflowId },
    });

    revalidatePath("/");
    return { ok: true };
  });
}

/** Remove a link. */
export async function unlinkWorkflows(linkId: string): Promise<LinkResult> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    const result = await prisma.workflowLink.deleteMany({
      where: { id: linkId, userId },
    });
    if (result.count === 0) return { ok: false, error: "Link not found." };

    revalidatePath("/");
    return { ok: true };
  });
}

/**
 * The workflows whose knowledge `workflowId` may read (itself + everything
 * upstream). Used to scope retrieval when a query runs in a workflow context.
 */
export async function getKnowledgeScope(workflowId: string): Promise<string[]> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    const links: WorkflowLinkEdge[] = await prisma.workflowLink.findMany({
      where: { userId },
      select: { sourceWorkflowId: true, targetWorkflowId: true },
    });
    return [workflowId, ...resolveUpstreamWorkflows(workflowId, links)];
  });
}

"use server";

import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import { embedBrainBlock } from "@/lib/interactive/pageMutation";

/**
 * Brain page data + the human-in-the-loop controls (blueprint §6.3):
 * confirm · correct · delete · pin. Humans hold final authority; every
 * correction is append-only (the old version is archived, never destroyed).
 */

async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Unauthenticated");
  return userId;
}

export type BrainBlockDTO = {
  id: string;
  type: string;
  title: string;
  body: string;
  confidence: number;
  createdBy: string;
  status: string;
  pinned: boolean;
  humanVerified: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

function toDTO(b: {
  id: string; type: string; title: string; body: string; confidence: number;
  createdBy: string; status: string; pinned: boolean; humanVerified: boolean;
  version: number; createdAt: Date; updatedAt: Date;
}): BrainBlockDTO {
  return {
    id: b.id,
    type: b.type,
    title: b.title,
    body: b.body,
    confidence: b.confidence,
    createdBy: b.createdBy,
    status: b.status,
    pinned: b.pinned,
    humanVerified: b.humanVerified,
    version: b.version,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

/** Active blocks (optionally by type) + the review queue, for the Brain page. */
export async function listBrainBlocks(): Promise<{
  active: BrainBlockDTO[];
  reviewQueue: BrainBlockDTO[];
}> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    const blocks = await prisma.brainBlock.findMany({
      where: { userId, status: { in: ["active", "queued_for_review"] } },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    });
    return {
      active: blocks.filter((b) => b.status === "active").map(toDTO),
      reviewQueue: blocks.filter((b) => b.status === "queued_for_review").map(toDTO),
    };
  });
}

/** Search only derived knowledge (blueprint: "Brain search"). */
export async function searchBrainBlocks(query: string): Promise<BrainBlockDTO[]> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    const q = query.trim();
    if (!q) return [];
    const blocks = await prisma.brainBlock.findMany({
      where: {
        userId,
        status: "active",
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { body: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      take: 30,
    });
    return blocks.map(toDTO);
  });
}

/** Confirm: mark human-verified — raises trust to 1.0 (§6.3). */
export async function confirmBrainBlock(id: string): Promise<boolean> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    const r = await prisma.brainBlock.updateMany({
      where: { id, userId },
      data: { humanVerified: true, confidence: 1 },
    });
    return r.count > 0;
  });
}

/**
 * Approve a review-queue block onto the page (and make it citable).
 *
 * When the block was extracted as a revision of something the brain already
 * knew, `data.supersedes` names the row it replaces, and approving it retires
 * that row here rather than at extraction time. That ordering is the point:
 * until a human agrees, the brain's current belief is still the old block, so
 * nothing is archived on the say-so of an automatic read.
 */
export async function approveBrainBlock(id: string): Promise<boolean> {
  const userId = await requireUserId();
  return withTenant(userId, () => applyApproval(userId, id));
}

/**
 * The approval itself, with the session lifted out.
 *
 * Split from `approveBrainBlock` so the supersede transaction can be exercised
 * against a real database without forging a session — it archives rows a user
 * is relying on, which is not logic to leave verified only by reading it.
 * Callers are responsible for auth and for the tenant scope.
 */
export async function applyApproval(userId: string, id: string): Promise<boolean> {
  const block = await prisma.brainBlock.findFirst({ where: { id, userId } });
  if (!block || block.status !== "queued_for_review") return false;

  const supersedes =
    block.data && typeof block.data === "object" && !Array.isArray(block.data)
      ? (block.data as Record<string, unknown>).supersedes
      : undefined;

  // Scoped by userId as well as id: `supersedes` arrives inside a JSON blob
  // written by an LLM, so it is untrusted input, not a verified reference.
  const old =
    typeof supersedes === "string" && supersedes !== block.id
      ? await prisma.brainBlock.findFirst({
          where: { id: supersedes, userId, status: "active" },
          select: { id: true, version: true },
        })
      : null;

  // Sequential, NOT prisma.$transaction([...]): callers run this inside
  // `withTenant`, which is itself an interactive transaction. A nested batch
  // transaction runs on a different connection, which cannot see rows this one
  // has not committed yet — approving a block fails with P2025. The ambient
  // transaction already makes these two writes atomic.
  await prisma.brainBlock.update({
    where: { id: block.id },
    data: {
      status: "active",
      humanVerified: true,
      ...(old ? { version: old.version + 1 } : {}),
    },
  });

  if (old) {
    await prisma.brainBlock.update({
      where: { id: old.id },
      data: { status: "archived", supersededById: block.id, pinned: false },
    });
  }

  await embedBrainBlock(userId, block.id, block.type, block.title, block.body);
  return true;
}

/**
 * Correct: append-only edit — a new version supersedes the old row, which is
 * archived (never hard-overwritten) so the history is auditable (§6.2).
 */
export async function correctBrainBlock(
  id: string,
  edits: { title?: string; body?: string }
): Promise<BrainBlockDTO | null> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    const old = await prisma.brainBlock.findFirst({ where: { id, userId } });
    if (!old) return null;

    const title = edits.title?.trim() || old.title;
    const body = edits.body?.trim() || old.body;

    const [, next] = await prisma.$transaction([
      prisma.brainBlock.update({
        where: { id: old.id },
        data: { status: "archived" },
      }),
      prisma.brainBlock.create({
        data: {
          userId,
          type: old.type,
          title,
          body,
          data: old.data ?? undefined,
          sourceRefs: old.sourceRefs ?? undefined,
          confidence: 1, // a human correction is ground truth
          createdBy: "human",
          status: old.status === "queued_for_review" ? "active" : old.status,
          pinned: old.pinned,
          humanVerified: true,
          version: old.version + 1,
        },
      }),
    ]);
    // Link the chain old → new, then re-embed the corrected content.
    await prisma.brainBlock.update({
      where: { id: old.id },
      data: { supersededById: next.id },
    });
    await embedBrainBlock(userId, next.id, next.type, next.title, next.body);
    return toDTO(next);
  });
}

/** Delete: soft — archived, recoverable (§6.3). */
export async function deleteBrainBlock(id: string): Promise<boolean> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    const r = await prisma.brainBlock.updateMany({
      where: { id, userId },
      data: { status: "archived", pinned: false },
    });
    return r.count > 0;
  });
}

/** Pin/unpin: pinned blocks are ground truth, prioritised and never overwritten. */
export async function setBrainBlockPinned(id: string, pinned: boolean): Promise<boolean> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    const r = await prisma.brainBlock.updateMany({
      where: { id, userId, status: "active" },
      data: { pinned },
    });
    return r.count > 0;
  });
}

/** One block by id (deep-link target /brain?block=...). */
export async function getBrainBlock(id: string): Promise<BrainBlockDTO | null> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    const b = await prisma.brainBlock.findFirst({ where: { id, userId } });
    return b ? toDTO(b) : null;
  });
}

// ─── Standing rules (AgentConfig management, blueprint §8.2) ────────────────

export type AgentConfigDTO = {
  id: string;
  name: string;
  triggers: string[];
  writeTarget: string;
  enabled: boolean;
  sourceText: string;
  createdAt: string;
};

export async function listAgentConfigs(): Promise<AgentConfigDTO[]> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    const configs = await prisma.agentConfig.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return configs.map((c) => ({
      id: c.id,
      name: c.name,
      triggers: c.triggers,
      writeTarget: c.writeTarget,
      enabled: c.enabled,
      sourceText: c.sourceText,
      createdAt: c.createdAt.toISOString(),
    }));
  });
}

export async function setAgentConfigEnabled(id: string, enabled: boolean): Promise<boolean> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    const r = await prisma.agentConfig.updateMany({ where: { id, userId }, data: { enabled } });
    return r.count > 0;
  });
}

export async function deleteAgentConfig(id: string): Promise<boolean> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    const r = await prisma.agentConfig.deleteMany({ where: { id, userId } });
    return r.count > 0;
  });
}

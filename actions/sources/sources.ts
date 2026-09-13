"use server";

import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import { removeObject, storageReachable } from "@/lib/sources/storage";

/**
 * Sources server actions — uploaded-file management for the Sources page.
 * Every operation is scoped to the signed-in user.
 */

export type UploadedSource = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string; // PENDING | QUEUED | PROCESSED | FAILED
  extractedChars: number | null;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
};

export type ConnectedSourceSummary = {
  source: string; // gmail | notion | github | custom
  connections: number;
  documents: number;
  processed: number;
};

async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Unauthenticated");
  return userId;
}

/** Uploaded files, newest first. */
export async function listUploadedSources(): Promise<UploadedSource[]> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    const rows = await prisma.sourceFile.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        extractedChars: true,
        errorMessage: true,
        createdAt: true,
        processedAt: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      processedAt: r.processedAt?.toISOString() ?? null,
    }));
  });
}

/** Live-connector rollup (blueprint §9.1 status cards). */
export async function listConnectedSources(): Promise<ConnectedSourceSummary[]> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {

    const [gmailConns, notionConns, githubConns, customConns] = await Promise.all([
      prisma.gmailConnection.count({ where: { userId } }),
      prisma.notionConnection.count({ where: { userId } }),
      prisma.gitHubConnection.count({ where: { userId } }),
      prisma.customConnection.count({ where: { userId } }),
    ]);

    const countBy = async (
      model: { groupBy: (args: any) => Promise<{ status: string; _count: number }[]> },
      where: object
    ) => {
      const grouped = await model.groupBy({ by: ["status"], where, _count: true });
      const total = grouped.reduce((s, g) => s + g._count, 0);
      const processed = grouped.find((g) => g.status === "PROCESSED")?._count ?? 0;
      return { total, processed };
    };

    const [gmail, notion, github, custom] = await Promise.all([
      countBy(prisma.email as any, { connection: { userId } }),
      countBy(prisma.notionPage as any, { connection: { userId } }),
      countBy(prisma.gitHubItem as any, { connection: { userId } }),
      countBy(prisma.customDocument as any, { connection: { userId } }),
    ]);

    return [
      { source: "gmail", connections: gmailConns, documents: gmail.total, processed: gmail.processed },
      { source: "notion", connections: notionConns, documents: notion.total, processed: notion.processed },
      { source: "github", connections: githubConns, documents: github.total, processed: github.processed },
      { source: "custom", connections: customConns, documents: custom.total, processed: custom.processed },
    ];
  });
}

/** Delete an uploaded file (DB row + its stored object). */
export async function deleteUploadedSource(id: string): Promise<boolean> {
  const userId = await requireUserId();
  return withTenant(userId, async () => {
    const file = await prisma.sourceFile.findFirst({
      where: { id, userId },
      select: { storageKey: true },
    });
    if (!file) return false;

    await removeObject(file.storageKey);
    const result = await prisma.sourceFile.deleteMany({ where: { id, userId } });
    return result.count > 0;
  });
}

/** Storage health for the page header badge. */
export async function getStorageStatus(): Promise<{ reachable: boolean }> {
  await requireUserId();
  return { reachable: await storageReachable() };
}

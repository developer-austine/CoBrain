import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { getCurrentUserId } from "@/lib/get-session";

export const runtime = "nodejs";

/**
 * GET /api/github/status?workflowId=&nodeId=
 *
 * Connection state for the node's UI: whether GitHub is authorised, which
 * repository is linked, and what has been indexed.
 *
 * Note the response field is `repository`. It previously returned
 * `workspaceName` — copied from the Notion connector — while every caller read
 * `data.repository`, so the check silently never matched and a connected node
 * could not tell it was connected.
 */
export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  return withTenant(userId, async () => {

    const { searchParams } = new URL(req.url);
    const nodeId = searchParams.get("nodeId");
    const workflowId = searchParams.get("workflowId");

    if (!nodeId || !workflowId) {
      return NextResponse.json(
        { error: "workflowId and nodeId are required" },
        { status: 400 }
      );
    }

    const connection = await prisma.gitHubConnection.findUnique({
      where: { workflowId_nodeId: { workflowId, nodeId } },
      select: {
        userId: true,
        repository: true,
        defaultBranch: true,
        isPrivate: true,
        linkedAt: true,
        commitsSyncedAt: true,
        codeSyncedAt: true,
      },
    });

    if (!connection) {
      return NextResponse.json({ connected: false, repository: null });
    }
    if (connection.userId !== userId) {
      return NextResponse.json({ error: "Not your connection" }, { status: 403 });
    }

    const counts = await prisma.gitHubItem.groupBy({
      by: ["type"],
      where: { connection: { workflowId, nodeId } },
      _count: { _all: true },
    });

    return NextResponse.json({
      connected: true,
      // Empty string means authorised but no repository chosen yet — the UI uses
      // this to decide between "connected" and "pick a repo".
      repository: connection.repository || null,
      defaultBranch: connection.defaultBranch,
      private: connection.isPrivate,
      linkedAt: connection.linkedAt,
      commitsSyncedAt: connection.commitsSyncedAt,
      codeSyncedAt: connection.codeSyncedAt,
      indexed: Object.fromEntries(counts.map((c) => [c.type, c._count._all])),
    });
  });
}

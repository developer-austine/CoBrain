import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import { syncDriveConnection } from "@/lib/connector/sync/drive";

/**
 * TENANT SCOPE: intentionally unscoped, and ownership-checked instead.
 *
 * Same reasoning as the Slack route: this spends minutes on external HTTP and
 * cannot hold `withTenant`'s interactive transaction open for that long, so the
 * session's user id is compared against the connection's before any work runs.
 */
export const runtime = "nodejs";
// Vercel Hobby caps functions at 60s. A large Drive is therefore walked across
// several clicks rather than one: MAX_FILES bounds the run and `version` dedup
// means the next run skips everything already ingested.
export const maxDuration = 60;

/** POST /api/drive/sync — the "Sync now" button on a Drive node. */
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  let body: { workflowId?: string; nodeId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { workflowId, nodeId } = body;
  if (!workflowId || !nodeId) {
    return NextResponse.json(
      { error: "workflowId and nodeId are required" },
      { status: 400 }
    );
  }

  const connection = await prisma.driveConnection.findUnique({
    where: { workflowId_nodeId: { workflowId, nodeId } },
  });

  if (!connection || connection.userId !== userId) {
    return NextResponse.json(
      { error: "No Drive connection found for this node. Please connect first." },
      { status: 404 }
    );
  }

  try {
    const result = await syncDriveConnection(connection);
    return NextResponse.json({
      success: true,
      synced: result.itemCount,
      skipped: result.skipped,
      connectedAs: connection.email,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    console.error("[drive/sync] fatal sync error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

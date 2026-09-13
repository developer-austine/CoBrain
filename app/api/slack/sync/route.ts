import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import { syncSlackConnection } from "@/lib/connector/sync/slack";

/**
 * TENANT SCOPE: intentionally unscoped, and ownership-checked instead.
 *
 * This handler spends minutes on external HTTP, and `withTenant` opens an
 * interactive transaction — holding a pooled connection that long would
 * exhaust the pool and trip the statement timeout. So it scopes itself: the
 * session's user id must match the connection's `userId` before any work runs.
 *
 * That check is written out rather than assumed. The equivalent Notion route
 * documents this same reasoning but never actually compares the ids, which
 * leaves any signed-in user able to trigger a sync on another tenant's
 * connection by guessing a workflow/node pair.
 */
export const runtime = "nodejs";

/** POST /api/slack/sync — the "Sync now" button on a Slack node. */
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

  const connection = await prisma.slackConnection.findUnique({
    where: { workflowId_nodeId: { workflowId, nodeId } },
  });

  // Same 404 whether the connection is missing or belongs to someone else —
  // distinguishing them would confirm that a given workflow/node pair exists.
  if (!connection || connection.userId !== userId) {
    return NextResponse.json(
      { error: "No Slack connection found for this node. Please connect first." },
      { status: 404 }
    );
  }

  try {
    const result = await syncSlackConnection(connection);
    return NextResponse.json({
      success: true,
      synced: result.itemCount,
      skipped: result.skipped,
      connectedAs: connection.teamName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    console.error("[slack/sync] fatal sync error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/get-session";

/**
 * GET /api/slack/status — what the node shows after the OAuth popup closes.
 *
 * Ownership-checked: this reports whether a workflow/node pair is connected,
 * which is exactly the kind of existence oracle worth not handing to any
 * signed-in user.
 */
export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ teamName: null }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const workflowId = searchParams.get("workflowId");
  const nodeId = searchParams.get("nodeId");

  if (!workflowId || !nodeId) {
    return NextResponse.json({ teamName: null }, { status: 400 });
  }

  const connection = await prisma.slackConnection.findUnique({
    where: { workflowId_nodeId: { workflowId, nodeId } },
    select: { teamName: true, userId: true },
  });

  return NextResponse.json({
    teamName: connection && connection.userId === userId ? connection.teamName : null,
  });
}

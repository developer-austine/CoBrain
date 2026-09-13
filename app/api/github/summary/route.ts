import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import { loadCommitsForSummary, summariseCommits } from "@/lib/connector/github/summarize";

export const runtime = "nodejs";

/**
 * POST /api/github/summary  { workflowId, nodeId, limit? }
 *
 * Summarise the repository's recent commits into a Brain block: what shipped,
 * grouped by theme, with who did it.
 *
 * Returns 503 rather than a placeholder block when synthesis is unavailable.
 * Writing "summary unavailable" into the Brain would look like knowledge on a
 * page whose whole purpose is knowledge.
 */
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  return withTenant(userId, async () => {

    let body: { workflowId?: string; nodeId?: string; limit?: number };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { workflowId, nodeId } = body;
    if (!workflowId || !nodeId) {
      return NextResponse.json(
        { error: "workflowId and nodeId are required" },
        { status: 400 }
      );
    }

    const connection = await prisma.gitHubConnection.findUnique({
      where: { workflowId_nodeId: { workflowId, nodeId } },
    });
    if (!connection) {
      return NextResponse.json({ error: "Connect GitHub first" }, { status: 404 });
    }
    if (connection.userId !== userId) {
      return NextResponse.json({ error: "Not your connection" }, { status: 403 });
    }
    if (!connection.repository) {
      return NextResponse.json({ error: "No repository linked" }, { status: 409 });
    }

    const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 500);
    const commits = await loadCommitsForSummary(connection.id, limit);

    if (commits.length === 0) {
      return NextResponse.json(
        { error: "No commits synced yet — run a commits sync first." },
        { status: 409 }
      );
    }

    const result = await summariseCommits(userId, connection.repository, commits);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason, commits: result.commits },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      repository: connection.repository,
      commits: result.commits,
      block: result.block,
    });
  });
}

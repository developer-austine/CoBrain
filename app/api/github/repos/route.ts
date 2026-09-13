import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import { GitHubApiError, listRepositories } from "@/lib/connector/github/client";

export const runtime = "nodejs";

/**
 * GET /api/github/repos?workflowId=&nodeId=
 *
 * The repositories this connection's token can see, so the user can pick one.
 * OAuth grants access to every repo they can read; choosing which one CoBrain
 * indexes is a separate, explicit decision — indexing a repo means its code and
 * discussions become searchable company knowledge.
 */
export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  return withTenant(userId, async () => {

    const { searchParams } = new URL(req.url);
    const workflowId = searchParams.get("workflowId");
    const nodeId = searchParams.get("nodeId");
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
    // The connection is keyed by workflow+node, not by user — check ownership
    // before handing back a token's repository list.
    if (connection.userId !== userId) {
      return NextResponse.json({ error: "Not your connection" }, { status: 403 });
    }

    try {
      const repos = await listRepositories(connection.accessToken);
      return NextResponse.json({
        repositories: repos,
        linked: connection.repository || null,
      });
    } catch (err) {
      if (err instanceof GitHubApiError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      console.error("[github/repos]", err);
      return NextResponse.json({ error: "Could not list repositories" }, { status: 502 });
    }
  });
}

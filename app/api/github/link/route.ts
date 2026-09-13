import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import { GitHubApiError, getRepository } from "@/lib/connector/github/client";

export const runtime = "nodejs";

/**
 * POST /api/github/link  { workflowId, nodeId, repository }
 *
 * Bind one repository to the connection. The repo is verified against GitHub
 * first: storing an unreadable name would leave the connector looking linked
 * and failing on every later sync, with the error surfacing far from its cause.
 *
 * Re-linking to a DIFFERENT repository clears the previously indexed items —
 * leaving them would mix two codebases in one namespace and answer questions
 * about the old repo as if they were about the new one.
 */
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  return withTenant(userId, async () => {

    let body: { workflowId?: string; nodeId?: string; repository?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { workflowId, nodeId, repository } = body;
    if (!workflowId || !nodeId || !repository) {
      return NextResponse.json(
        { error: "workflowId, nodeId and repository are required" },
        { status: 400 }
      );
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
      return NextResponse.json(
        { error: 'repository must be in "owner/name" form' },
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

    let repo;
    try {
      repo = await getRepository(connection.accessToken, repository);
    } catch (err) {
      if (err instanceof GitHubApiError) {
        const message =
          err.status === 404
            ? `Cannot see ${repository} — check the name, or that the token has access to it`
            : err.message;
        return NextResponse.json({ error: message }, { status: err.status });
      }
      return NextResponse.json({ error: "Could not verify repository" }, { status: 502 });
    }

    const switching =
      Boolean(connection.repository) && connection.repository !== repo.fullName;

    if (switching) {
      await prisma.gitHubItem.deleteMany({ where: { githubConnectionId: connection.id } });
    }

    await prisma.gitHubConnection.update({
      where: { id: connection.id },
      data: {
        repository: repo.fullName,
        repoId: repo.id,
        defaultBranch: repo.defaultBranch,
        isPrivate: repo.private,
        linkedAt: new Date(),
        // Cursors belong to the old repository; carrying them over would skip
        // the new repo's history entirely.
        ...(switching
          ? { lastCommitSha: null, codeTreeSha: null, commitsSyncedAt: null, codeSyncedAt: null }
          : {}),
      },
    });

    return NextResponse.json({
      success: true,
      repository: repo.fullName,
      defaultBranch: repo.defaultBranch,
      private: repo.private,
      clearedPreviousIndex: switching,
    });
  });
}

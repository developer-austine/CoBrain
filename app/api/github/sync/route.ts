import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import { GitHubApiError } from "@/lib/connector/github/client";
import { syncCode, syncCommits, syncDiscussions, type SyncOutcome } from "@/lib/connector/github/sync";
import { syncIssuesAndPrs } from "@/lib/connector/github/issues";

/**
 * TENANT SCOPE: intentionally unscoped.
 *
 * This handler spends minutes on external HTTP, and `withTenant` opens an
 * interactive transaction — holding a pooled connection for that long would
 * exhaust the pool and trip the statement timeout. It scopes itself by loading
 * the connection row and checking `connection.userId === userId` before doing
 * any work.
 *
 * Under the non-owner application role this handler therefore sees nothing and
 * must be converted before DATABASE_URL is switched. See
 * docs/refactor/SCALING_MODULE_STATUS.md.
 */
export const runtime = "nodejs";

/** What a caller may ask for. Omitted means everything. */
const ALL_KINDS = ["issues", "commits", "discussions", "code"] as const;
type Kind = (typeof ALL_KINDS)[number];

/**
 * POST /api/github/sync  { workflowId, nodeId, kinds?: Kind[] }
 *
 * Pulls the repository into the knowledge pipeline. Each kind runs
 * independently and reports its own outcome, because their failure modes are
 * genuinely different: Discussions may be disabled, code indexing is the part
 * that exhausts the rate limit, and neither should cost you your commits.
 *
 * `kinds` exists because a code re-index is expensive — the scheduler can pull
 * commits every few minutes while re-indexing code only when the tree changes.
 */
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  let body: { workflowId?: string; nodeId?: string; kinds?: string[] };
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

  const requested: Kind[] = Array.isArray(body.kinds)
    ? (body.kinds.filter((k): k is Kind => (ALL_KINDS as readonly string[]).includes(k)))
    : [...ALL_KINDS];

  const connection = await prisma.gitHubConnection.findUnique({
    where: { workflowId_nodeId: { workflowId, nodeId } },
  });
  if (!connection) {
    return NextResponse.json(
      { error: "No GitHub connection found. Please connect first." },
      { status: 404 }
    );
  }
  if (connection.userId !== userId) {
    return NextResponse.json({ error: "Not your connection" }, { status: 403 });
  }
  if (!connection.repository) {
    return NextResponse.json(
      { error: "No repository linked. Pick one first.", needsRepository: true },
      { status: 409 }
    );
  }

  const ctx = {
    id: connection.id,
    userId: connection.userId,
    accessToken: connection.accessToken,
    repository: connection.repository,
    defaultBranch: connection.defaultBranch,
    lastCommitSha: connection.lastCommitSha,
  };

  const runners: Record<Kind, () => Promise<SyncOutcome>> = {
    issues: () => syncIssuesAndPrs(ctx),
    commits: () => syncCommits(ctx),
    discussions: () => syncDiscussions(ctx),
    code: () => syncCode(ctx),
  };

  const results: SyncOutcome[] = [];
  const failures: { kind: Kind; error: string }[] = [];

  // Sequential on purpose: these share one GitHub rate-limit bucket, and
  // running them concurrently just reaches the ceiling faster.
  for (const kind of requested) {
    try {
      results.push(await runners[kind]());
    } catch (err) {
      const message =
        err instanceof GitHubApiError ? err.message : err instanceof Error ? err.message : String(err);
      console.error(`[github/sync] ${kind} failed:`, message);
      failures.push({ kind, error: message });
      // A rate limit will hit every remaining kind too — stop rather than
      // burn the rest of the quota producing identical failures.
      if (err instanceof GitHubApiError && (err.status === 403 || err.status === 401)) break;
    }
  }

  return NextResponse.json({
    success: failures.length === 0,
    repository: connection.repository,
    results,
    failures,
    synced: results.reduce((n, r) => n + r.synced, 0),
    skipped: results.reduce((n, r) => n + r.skipped, 0),
  });
}

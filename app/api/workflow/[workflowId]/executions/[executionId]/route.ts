import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/workflow/[workflowId]/executions/[executionId]
 *
 * Real progress for one run: the phases that were actually created from the
 * user's flow, plus the live document counts behind each source.
 *
 * The page that consumes this used to invent its own phase list — Gmail,
 * GitHub, Drive, Notion, hardcoded — and tick each one "done" on a 1.2s timer
 * whether or not the source was connected. It reported success for connectors
 * the workflow did not contain and finished before the pipeline had read a
 * single document.
 *
 * Phase names here come from ExecutionPhase rows, which runWorkflow builds from
 * the nodes actually on the canvas, so a workflow with only GitHub and Gmail
 * reports exactly those two.
 */

/**
 * Which item table backs each source task type.
 *
 * A phase is only a "source" if it appears here; the pipeline stages
 * (Normalizer, PII, Chunker, Embedder) run inside the Python worker and have no
 * per-document rows of their own to count.
 */
const SOURCE_TABLES = {
  GMAIL: "email",
  GITHUB: "gitHubItem",
  NOTION: "notionPage",
  CUSTOM_API: "customDocument",
  SLACK: "slackMessage",
  DRIVE: "driveFile",
} as const;

type SourceTask = keyof typeof SOURCE_TABLES;

const isSourceTask = (value: string): value is SourceTask =>
  Object.hasOwn(SOURCE_TABLES, value);

/** Terminal states the Python pipeline writes when a document is finished. */
const DONE_STATUSES = ["PROCESSED", "COMPLETED"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workflowId: string; executionId: string }> }
) {
  const { workflowId, executionId } = await params;

  const headersList = await headers();
  const cookie = headersList.get("cookie");
  const session = await auth.api.getSession({ headers: { cookie: cookie || "" } });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  return withTenant(userId, async () => {
    try {
      const execution = await prisma.workflowExecution.findFirst({
        where: { id: executionId, workflowId, userId },
        include: { executionPhases: { orderBy: { number: "asc" } } },
      });

      if (!execution) {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }

      const phases = await Promise.all(
        execution.executionPhases.map(async (phase) => {
          const taskType = readTaskType(phase.node);
          const counts =
            taskType && isSourceTask(taskType)
              ? await countDocuments(taskType, userId)
              : null;

          return {
            number: phase.number,
            name: phase.name,
            taskType,
            /** Null for pipeline stages, which have nothing per-document to count. */
            counts,
            status: derivePhaseStatus(phase.status, counts),
          };
        })
      );

      // The run is finished when every phase is, rather than when a timer says
      // so. A source still holding queued documents keeps the run open.
      const allDone = phases.length > 0 && phases.every((p) => p.status === "done");

      return NextResponse.json({
        executionId: execution.id,
        workflowId: execution.workflowId,
        status: allDone ? "COMPLETED" : execution.status,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        phases,
      });
    } catch (err) {
      console.error("[api/workflow/executions] GET error:", err);
      return NextResponse.json({ error: "Could not load this run" }, { status: 500 });
    }
  });
}

/** ExecutionPhase.node holds the serialised AppNode; we only want its task type. */
function readTaskType(node: string): string | null {
  try {
    return JSON.parse(node)?.data?.type ?? null;
  } catch {
    return null;
  }
}

type Counts = { total: number; done: number; failed: number; pending: number };

async function countDocuments(task: SourceTask, userId: string): Promise<Counts> {
  // Indexed by task rather than switch-cased so adding a connector is one entry
  // in SOURCE_TABLES above.
  const model = SOURCE_TABLES[task];
  const delegate = (prisma as unknown as Record<string, {
    count: (args: { where: Record<string, unknown> }) => Promise<number>;
  }>)[model];

  if (!delegate) return { total: 0, done: 0, failed: 0, pending: 0 };

  const [total, done, failed] = await Promise.all([
    delegate.count({ where: { userId } }),
    delegate.count({ where: { userId, status: { in: DONE_STATUSES } } }),
    delegate.count({ where: { userId, status: "FAILED" } }),
  ]);

  return { total, done, failed, pending: Math.max(0, total - done - failed) };
}

/**
 * A phase is done when its documents are, not when its row says CREATED.
 *
 * runWorkflow writes every phase as CREATED and never advances it — the real
 * work happens in the Python pipeline against the item tables — so the row's
 * own status cannot drive the UI. For a source we read the documents; for a
 * pipeline stage, which has none, we fall back to the row.
 */
function derivePhaseStatus(
  rowStatus: string,
  counts: Counts | null
): "pending" | "running" | "done" | "failed" {
  if (counts) {
    if (counts.total === 0) return "pending";
    if (counts.done + counts.failed >= counts.total) {
      return counts.failed > 0 && counts.done === 0 ? "failed" : "done";
    }
    return "running";
  }

  if (rowStatus === "COMPLETED") return "done";
  if (rowStatus === "FAILED") return "failed";
  if (rowStatus === "RUNNING") return "running";
  return "pending";
}

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { syncNotionConnection } from "@/lib/connector/sync/notion";

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

/**
 * POST /api/notion/sync — the "Sync now" button on a Notion node.
 *
 * Thin wrapper over the shared sync service. It used to carry its own copy of
 * the extraction logic, which drifted: it stored pages at status=PENDING and
 * never pushed them onto the ingest queue, so anything synced by hand never
 * reached Qdrant and never became answerable. One implementation now, shared
 * with the scheduler.
 */
export async function POST(req: NextRequest) {
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

  const connection = await prisma.notionConnection.findUnique({
    where: { workflowId_nodeId: { workflowId, nodeId } },
  });

  if (!connection) {
    return NextResponse.json(
      { error: "No Notion connection found for this node. Please connect first." },
      { status: 404 }
    );
  }

  try {
    const result = await syncNotionConnection(connection);
    return NextResponse.json({
      success: true,
      synced: result.itemCount,
      skipped: result.skipped,
      connectedAs: connection.workspaceName,
    });
  } catch (err: any) {
    console.error("[notion/sync] fatal sync error:", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Sync failed" }, { status: 500 });
  }
}

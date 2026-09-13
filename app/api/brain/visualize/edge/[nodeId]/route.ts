import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import { withTenant } from "@/lib/tenant/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/brain/visualize/edge/{nodeId}/recent
 *
 * The last three things that actually flowed down an edge (spec §3).
 *
 * This is the payoff of the whole map: hovering an edge and seeing three real
 * documents by name is the moment the particles stop reading as decoration and
 * start reading as your data moving. So it returns real titles and real
 * timestamps, or an empty list — never a placeholder.
 *
 * It also returns document *titles*, which makes the tenant predicate on every
 * query non-negotiable rather than a formality — RLS is forced on these tables
 * but inert under the superuser connection `DATABASE_URL` still uses.
 */

const LIMIT = 3;

type RecentItem = { title: string; at: string | null };

function clean(title: string | null | undefined, fallback: string): string {
  const trimmed = (title ?? "").trim();
  return trimmed.length ? trimmed : fallback;
}

async function recentFor(nodeId: string, userId: string): Promise<RecentItem[] | null> {
  switch (nodeId) {
    case "engineering": {
      const rows = await prisma.gitHubItem.findMany({
        where: { userId },
        orderBy: { syncedAt: "desc" },
        take: LIMIT,
        select: { title: true, type: true, syncedAt: true },
      });
      return rows.map((r) => ({
        title: clean(r.title, r.type || "GitHub item"),
        at: r.syncedAt?.toISOString() ?? null,
      }));
    }

    case "comms": {
      const rows = await prisma.email.findMany({
        where: { userId },
        orderBy: { syncedAt: "desc" },
        take: LIMIT,
        select: { subject: true, syncedAt: true },
      });
      return rows.map((r) => ({
        title: clean(r.subject, "(no subject)"),
        at: r.syncedAt?.toISOString() ?? null,
      }));
    }

    case "docs": {
      // Two tables feed this one edge, so both are read and merged by recency
      // rather than showing whichever source happens to be listed first.
      const [pages, files] = await Promise.all([
        prisma.notionPage.findMany({
          where: { userId },
          orderBy: { syncedAt: "desc" },
          take: LIMIT,
          select: { title: true, syncedAt: true },
        }),
        prisma.sourceFile.findMany({
          where: { userId, status: "PROCESSED" },
          orderBy: { processedAt: "desc" },
          take: LIMIT,
          select: { fileName: true, processedAt: true },
        }),
      ]);

      return [
        ...pages.map((p) => ({
          title: clean(p.title, "Untitled page"),
          at: p.syncedAt?.toISOString() ?? null,
        })),
        ...files.map((f) => ({
          title: clean(f.fileName, "Uploaded file"),
          at: f.processedAt?.toISOString() ?? null,
        })),
      ]
        .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
        .slice(0, LIMIT);
    }

    case "meetings":
    case "patterns":
    case "facts":
    case "decisions":
    case "forecasts": {
      const type =
        nodeId === "meetings"
          ? "meeting_summary"
          : nodeId === "patterns"
            ? "pattern"
            : nodeId === "facts"
              ? "learned_fact"
              : nodeId === "decisions"
                ? "decision"
                : "forecast";

      const rows = await prisma.brainBlock.findMany({
        where: { userId, type, status: "active" },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: { title: true, createdAt: true },
      });
      return rows.map((r) => ({
        title: clean(r.title, "Untitled"),
        at: r.createdAt.toISOString(),
      }));
    }

    default:
      return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { nodeId } = await params;

  try {
    const items = await withTenant(userId, () => recentFor(nodeId, userId));
    if (items === null) {
      return NextResponse.json({ error: "Unknown node" }, { status: 404 });
    }
    return NextResponse.json({ nodeId, items });
  } catch (error) {
    console.error(`[brain/visualize] recent items failed for ${nodeId}`, error);
    return NextResponse.json({ nodeId, items: [] });
  }
}

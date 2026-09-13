import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import { getObject } from "@/lib/sources/storage";

export const runtime = "nodejs";

/**
 * GET /api/sources/[id]/download — stream the original uploaded file back to
 * its owner (the "source of truth" behind an upload citation). Scoped to the
 * signed-in user; another user's id 404s.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  return withTenant(userId, async () => {

    const { id } = await params;
    const file = await prisma.sourceFile.findFirst({
      where: { id, userId },
      select: { fileName: true, mimeType: true, storageKey: true },
    });
    if (!file) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let body: Buffer;
    try {
      body = await getObject(file.storageKey);
    } catch (err) {
      console.error("[sources/download] storage error:", err);
      return NextResponse.json({ error: "File unavailable" }, { status: 503 });
    }

    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}

import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/get-session";
import { withTenant } from "@/lib/tenant/prisma";
import { getVisualizeTelemetry } from "@/lib/brain/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/brain/visualize
 *
 * The telemetry snapshot the visualize map animates from (spec §2). Every
 * count, state and rate on that screen traces back to this response.
 *
 * Cached ten seconds per tenant inside the service, so the client's 12-second
 * poll costs one query burst no matter how many tabs are open.
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const telemetry = await withTenant(userId, () => getVisualizeTelemetry(userId));
    return NextResponse.json(telemetry, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[brain/visualize] telemetry failed", error);
    return NextResponse.json(
      { error: "Could not read brain telemetry." },
      { status: 500 }
    );
  }
}

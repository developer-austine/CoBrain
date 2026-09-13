import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/get-session";
import { withTenant } from "@/lib/tenant/prisma";
import { buildSummary } from "@/lib/metering/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/usage/summary
 *
 * Balance, allowance, spend and the end-of-period projection — everything the
 * hero card needs in one round trip.
 *
 * Returns credits and dates only. No costMicros, no provider figures, no
 * "tokens": this is the layer customers read, and the vocabulary is credits and
 * human units.
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const summary = await withTenant(userId, () => buildSummary(userId));
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[usage/summary] failed:", err);
    return NextResponse.json(
      { error: "Could not load usage for this period." },
      { status: 500 }
    );
  }
}

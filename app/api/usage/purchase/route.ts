import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/get-session";
import { withTenant } from "@/lib/tenant/prisma";
import { assertTenantAdmin, AdminRequiredError } from "@/lib/metering/rbac";
import { CREDIT_PACKS, isValidPack, startCheckout } from "@/lib/metering/purchase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/usage/purchase — the packs on offer, and whether buying works here.
 * POST /api/usage/purchase — begin checkout for one pack.
 *
 * ADMIN ONLY: spending money on behalf of the workspace is the same class of
 * action as raising its cap.
 *
 * The credit amount is chosen from a fixed set of packs rather than taken from
 * the request. A client-supplied amount would mean the price is decided by the
 * caller, which is the oldest bug in commerce.
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  return NextResponse.json({
    packs: CREDIT_PACKS,
    available: Boolean(process.env.STRIPE_SECRET_KEY),
  });
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  let credits: unknown;
  try {
    credits = (await req.json())?.credits;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof credits !== "number" || !isValidPack(credits)) {
    return NextResponse.json(
      { error: `Choose one of the available packs: ${CREDIT_PACKS.map((p) => p.credits).join(", ")}.` },
      { status: 400 }
    );
  }

  try {
    const result = await withTenant(userId, async () => {
      await assertTenantAdmin(userId, userId);
      return startCheckout({ tenantId: userId, actorUserId: userId, credits });
    });

    if (!result.ok) {
      // Not an error — this deployment simply has no payment provider wired.
      return NextResponse.json({ error: result.message }, { status: 503 });
    }
    return NextResponse.json({ checkoutUrl: result.checkoutUrl });
  } catch (err) {
    if (err instanceof AdminRequiredError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[usage/purchase] failed:", err);
    return NextResponse.json({ error: "Could not start checkout." }, { status: 500 });
  }
}

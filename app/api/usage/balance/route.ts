import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/get-session";
import { withTenant } from "@/lib/tenant/prisma";
import { getBalance } from "@/lib/metering/balance";
import { getBilling } from "@/lib/metering/period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/usage/balance — just the two numbers the nav dot needs.
 *
 * Exists because the sidebar renders on EVERY dashboard page, and pointing it
 * at /api/usage/summary meant every page view paid for the projection, the
 * alerts, and a six-feature quota sweep in order to decide whether to draw a
 * 6px dot. This is one billing read plus one cached balance.
 *
 * Answers 200 with nulls rather than an error when metering is not set up yet
 * (tables not migrated, no billing row): the dot is decoration, and a nav that
 * logs a 500 on every page because a background detail is unavailable is worse
 * than a nav with no dot.
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ balance: null, included: null }, { status: 200 });
  }

  try {
    const data = await withTenant(userId, async () => {
      const [billing, balance] = await Promise.all([
        getBilling(userId),
        getBalance(userId),
      ]);
      return { balance, included: billing.includedCredits };
    });
    return NextResponse.json(data);
  } catch (err) {
    console.warn("[usage/balance] unavailable:", err);
    return NextResponse.json({ balance: null, included: null }, { status: 200 });
  }
}

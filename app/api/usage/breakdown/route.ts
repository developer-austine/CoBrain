import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/get-session";
import { withTenant } from "@/lib/tenant/prisma";
import { isTenantAdmin } from "@/lib/metering/rbac";
import {
  dailyBreakdown,
  featureBreakdown,
  featureHeadline,
  topConsumers,
} from "@/lib/metering/summary";
import { getBilling } from "@/lib/metering/period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/usage/breakdown?by=feature|user|day&from=&to=
 *
 * The aggregated rows behind the three charts. `from`/`to` default to the
 * tenant's current billing period, which is what the page asks for on load.
 *
 * `by=user` is ADMIN ONLY and 403s rather than returning an empty list: per-
 * person usage is data about employees, and a non-admin should be told they
 * cannot have it rather than shown a chart that looks like nobody used
 * anything.
 */
export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const by = searchParams.get("by") ?? "feature";
  if (by !== "feature" && by !== "user" && by !== "day") {
    return NextResponse.json(
      { error: `Unknown grouping: ${by}. Use feature, user, or day.` },
      { status: 400 }
    );
  }

  try {
    return await withTenant(userId, async () => {
      const billing = await getBilling(userId);
      const window = {
        from: parseDate(searchParams.get("from")) ?? billing.periodStart,
        to: parseDate(searchParams.get("to")) ?? billing.periodEnd,
      };

      if (window.to <= window.from) {
        return NextResponse.json(
          { error: "`to` must be after `from`." },
          { status: 400 }
        );
      }

      if (by === "feature") {
        const rows = await featureBreakdown(userId, window);
        return NextResponse.json({ by, rows, headline: featureHeadline(rows) });
      }

      if (by === "day") {
        const rows = await dailyBreakdown(userId, window);
        return NextResponse.json({ by, rows, pace: paceFor(billing, window) });
      }

      if (!(await isTenantAdmin(userId, userId))) {
        return NextResponse.json(
          { error: "Per-person usage is visible to workspace admins only." },
          { status: 403 }
        );
      }
      const { rows, more } = await topConsumers(userId, window);
      return NextResponse.json({ by, rows, more });
    });
  } catch (err) {
    console.error("[usage/breakdown] failed:", err);
    return NextResponse.json({ error: "Could not load the breakdown." }, { status: 500 });
  }
}

/**
 * The daily pace that stays inside the allowance — the dashed baseline on the
 * daily chart. Bars above it are the days that pushed the period over.
 */
function paceFor(
  billing: { includedCredits: number },
  window: { from: Date; to: Date }
): number {
  const days = Math.max(
    1,
    Math.round((window.to.getTime() - window.from.getTime()) / (24 * 60 * 60 * 1000))
  );
  return billing.includedCredits / days;
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

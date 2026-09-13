import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import { withTenant } from "@/lib/tenant/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { assertTenantAdmin, AdminRequiredError } from "@/lib/metering/rbac";
import { isMeteredFeature } from "@/lib/metering/pricebook";
import { getBilling } from "@/lib/metering/period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/usage/caps — set the spend ceiling, per-feature caps, thresholds
 * and the overage toggle.
 *
 * ADMIN ONLY, enforced server-side. Hiding the panel in the UI is presentation;
 * this is the control. A cap decides what the workspace is allowed to spend,
 * and a non-admin being able to raise it by posting JSON would make the whole
 * feature theatre.
 *
 * Body (all optional, only the keys present are changed):
 *   { hardCapCredits: number | null,
 *     featureCaps: { [feature]: number },
 *     alertThresholds: number[],
 *     overageAllowed: boolean }
 *
 * Note what this route CANNOT do: pause chat, search, or forecasts. There is no
 * field for it, because those are included in the subscription and stay working
 * at a hit cap and a zero balance (RULE 4-2).
 */
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const patch = body as Record<string, unknown>;
  const data: Prisma.TenantBillingUpdateInput = {};

  if ("hardCapCredits" in patch) {
    const raw = patch.hardCapCredits;
    if (raw === null) {
      data.hardCapCredits = null;
    } else if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      data.hardCapCredits = new Prisma.Decimal(raw);
    } else {
      return NextResponse.json(
        { error: "hardCapCredits must be a non-negative number, or null for no cap." },
        { status: 400 }
      );
    }
  }

  if ("featureCaps" in patch) {
    const raw = patch.featureCaps;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json(
        { error: "featureCaps must be an object of feature → credits." },
        { status: 400 }
      );
    }
    const caps: Record<string, number> = {};
    for (const [feature, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!isMeteredFeature(feature)) {
        return NextResponse.json({ error: `Unknown feature: ${feature}` }, { status: 400 });
      }
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return NextResponse.json(
          { error: `Cap for ${feature} must be a non-negative number.` },
          { status: 400 }
        );
      }
      caps[feature] = value;
    }
    data.featureCaps = caps;
  }

  if ("alertThresholds" in patch) {
    const raw = patch.alertThresholds;
    if (
      !Array.isArray(raw) ||
      raw.some((t) => typeof t !== "number" || !Number.isInteger(t) || t < 1 || t > 100)
    ) {
      return NextResponse.json(
        { error: "alertThresholds must be whole percentages between 1 and 100." },
        { status: 400 }
      );
    }
    data.alertThresholds = { set: [...new Set(raw as number[])].sort((a, b) => a - b) };
  }

  if ("overageAllowed" in patch) {
    if (typeof patch.overageAllowed !== "boolean") {
      return NextResponse.json(
        { error: "overageAllowed must be true or false." },
        { status: 400 }
      );
    }
    data.overageAllowed = patch.overageAllowed;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  try {
    const billing = await withTenant(userId, async () => {
      await assertTenantAdmin(userId, userId);
      // Ensures the row exists before the update — a tenant can reach this
      // panel before anything has ever been metered for them.
      await getBilling(userId);
      await prisma.tenantBilling.update({ where: { tenantId: userId }, data });
      return getBilling(userId);
    });

    return NextResponse.json({
      plan: billing.plan,
      hardCapCredits: billing.hardCapCredits,
      featureCaps: billing.featureCaps,
      alertThresholds: billing.alertThresholds,
      overageAllowed: billing.overageAllowed,
    });
  } catch (err) {
    if (err instanceof AdminRequiredError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[usage/caps] failed:", err);
    return NextResponse.json({ error: "Could not update the caps." }, { status: 500 });
  }
}

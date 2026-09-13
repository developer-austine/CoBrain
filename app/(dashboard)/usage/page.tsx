import React from "react";
import { getCurrentUserId } from "@/lib/get-session";
import { withTenant } from "@/lib/tenant/prisma";
import { getBilling } from "@/lib/metering/period";
import { isTenantAdmin } from "@/lib/metering/rbac";
import {
  buildSummary,
  dailyBreakdown,
  featureBreakdown,
  featureHeadline,
  receipts,
  topConsumers,
} from "@/lib/metering/summary";
import { UsageClient, type UsagePageData } from "./_components/UsageClient";

export const dynamic = "force-dynamic";

/**
 * Usage & Credits.
 *
 * Everything is loaded server-side inside ONE withTenant scope. The alternative
 * — six client fetches on mount — would open six tenant transactions for a
 * single page view, and every one of them would re-derive the same billing row.
 *
 * The period selector then refetches through /api/usage/*, so only the first
 * paint costs a scope.
 */
async function load(userId: string): Promise<UsagePageData> {
  return withTenant(userId, async () => {
    const billing = await getBilling(userId);
    const window = { from: billing.periodStart, to: billing.periodEnd };
    const admin = await isTenantAdmin(userId, userId);

    const [summary, features, daily, ledger, consumers] = await Promise.all([
      buildSummary(userId),
      featureBreakdown(userId, window),
      dailyBreakdown(userId, window),
      receipts(userId, { from: window.from, to: window.to, limit: 25 }),
      // Per-person data is only fetched when the viewer may see it. Loading it
      // and hiding it in the client would put employee activity in the HTML.
      admin ? topConsumers(userId, window) : Promise.resolve({ rows: [], more: 0 }),
    ]);

    const days = Math.max(
      1,
      Math.round((window.to.getTime() - window.from.getTime()) / 86_400_000)
    );

    return {
      summary,
      features,
      featureHeadline: featureHeadline(features),
      daily,
      dailyPace: billing.includedCredits / days,
      receipts: ledger,
      consumers,
      isAdmin: admin,
      caps: {
        plan: billing.plan,
        includedCredits: billing.includedCredits,
        hardCapCredits: billing.hardCapCredits,
        featureCaps: billing.featureCaps,
        alertThresholds: billing.alertThresholds,
        overageAllowed: billing.overageAllowed,
      },
    };
  });
}

export default async function UsagePage() {
  const userId = await getCurrentUserId();

  if (!userId) {
    return (
      <Shell>
        <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
          Sign in to see this workspace&apos;s usage.
        </p>
      </Shell>
    );
  }

  let data: UsagePageData | null = null;
  let error: string | null = null;
  try {
    data = await load(userId);
  } catch (err) {
    console.error("[usage] page load failed:", err);
    error = "Could not load usage for this period.";
  }

  return (
    <Shell>
      {data ? (
        <UsageClient data={data} />
      ) : (
        <p className="text-[13px]" style={{ color: "var(--coral)" }}>
          {error}
        </p>
      )}
    </Shell>
  );
}

/** Same padded column as the other dashboard pages, so headings line up. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3" style={{ background: "var(--bg-page)" }}>
      <div className="mx-auto w-full min-w-0 max-w-[1400px] px-4 pt-1 sm:px-6">
        <h1
          className="font-display text-[18px] font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          Usage &amp; Credits
        </h1>
        <p
          className="mt-0.5 max-w-[70ch] text-[12px]"
          style={{ color: "var(--text-secondary)" }}
        >
          What you&apos;ve used this period, what it costs, and what&apos;s left.
        </p>
      </div>
      {children}
    </div>
  );
}

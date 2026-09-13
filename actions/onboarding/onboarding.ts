"use server";

import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import {
  createOnboardingPipeline,
  ONBOARDING_SOURCES,
} from "@/lib/connector/createDefaultPipeline";
import {
  COMPANY_SIZES,
  INDUSTRY_KEYS,
  PLAN_KEYS,
  type OnboardingInput,
  type PlanKey,
} from "@/lib/onboarding/constants";

/** The signed-in user's company profile, or null when not yet onboarded. */
export async function getCompanyProfile() {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  return withTenant(userId, async () => {
    return prisma.companyProfile.findUnique({ where: { userId } });
  });
}

/**
 * Finish onboarding: persist the company profile and generate the user's
 * personalized starter workflow — every chosen source pre-wired into the
 * processing pipeline. Idempotent: re-running updates the profile and reuses
 * the existing workflow if one was already generated.
 */
export async function completeOnboarding(
  input: OnboardingInput
): Promise<{ workflowId: string }> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Unauthenticated");

  return withTenant(userId, async () => {

    const companyName = input.companyName.replace(/\s+/g, " ").trim();
    const companySize = input.companySize.trim();
    const industry = input.industry?.trim() ?? "";
    const sources = [...new Set(input.sources)].filter((s) => s in ONBOARDING_SOURCES);

    if (!companyName) throw new Error("Company name is required");
    if (!(COMPANY_SIZES as readonly string[]).includes(companySize))
      throw new Error("Invalid company size");
    if (!INDUSTRY_KEYS.includes(industry)) throw new Error("Invalid industry");
    if (sources.length === 0) throw new Error("Pick at least one source");

    // Reuse the previously generated workflow on re-runs.
    const existing = await prisma.companyProfile.findUnique({ where: { userId } });
    let workflowId = existing?.workflowId ?? null;

    if (!workflowId) {
      const pipeline = createOnboardingPipeline(sources);
      const workflow = await prisma.workflow.create({
        data: {
          userId,
          name: `${companyName} Brain`,
          description: `Auto-generated during onboarding — ${sources.join(", ")} wired end-to-end.`,
          definition: JSON.stringify(pipeline),
          status: "draft",
        },
        select: { id: true },
      });
      workflowId = workflow.id;
    }

    await prisma.companyProfile.upsert({
      where: { userId },
      create: { userId, companyName, companySize, industry, sources, workflowId },
      update: { companyName, companySize, industry, sources, workflowId },
    });

    return { workflowId };
  });
}

/**
 * Record the chosen plan — the final onboarding gate. Until this runs,
 * `requireOnboarded()` keeps the rest of the app locked.
 */
export async function choosePlan(plan: PlanKey): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Unauthenticated");

  return withTenant(userId, async () => {
    if (!PLAN_KEYS.includes(plan)) throw new Error("Unknown plan");

    const updated = await prisma.companyProfile.updateMany({
      where: { userId },
      data: { plan },
    });
    if (updated.count === 0) throw new Error("Finish onboarding before picking a plan");
  });
}

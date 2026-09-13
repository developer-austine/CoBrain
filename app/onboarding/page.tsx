import { redirect } from "next/navigation";
import { getCompanyProfile } from "@/actions/onboarding/onboarding";
import { isOnboardingComplete } from "@/lib/onboarding/constants";
import OnboardingWizard from "./_components/OnboardingWizard";

/**
 * Post-signup onboarding. Fully onboarded users (plan chosen) go straight to
 * the app; users who bailed before picking a plan resume at the plan step.
 */
export default async function OnboardingPage() {
  const profile = await getCompanyProfile();
  if (isOnboardingComplete(profile)) redirect("/");

  return (
    <OnboardingWizard
      resumeWorkflowId={profile?.workflowId ?? null}
    />
  );
}

import { redirect } from "next/navigation";
import { getCompanyProfile } from "@/actions/onboarding/onboarding";
import { isOnboardingComplete } from "./constants";

/**
 * Server-side gate for app pages: anyone who hasn't finished onboarding
 * (through plan selection) is sent back to the wizard. Call from server
 * layouts/pages — unauthenticated users are already handled by the proxy.
 */
export async function requireOnboarded(): Promise<void> {
  const profile = await getCompanyProfile();
  if (!isOnboardingComplete(profile)) redirect("/onboarding");
}

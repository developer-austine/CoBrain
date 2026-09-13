"use server";

import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { auth } from "@/lib/auth";
import { getCurrentUserId } from "@/lib/get-session";

/**
 * Permanently delete the signed-in user's account.
 *
 * Order matters: the Better Auth deletion runs FIRST (it verifies the
 * password) — if that fails nothing is touched. Only after the auth user is
 * gone do we purge the business data, using the userId captured up front.
 * Connections cascade to their synced items; workflows cascade to executions.
 */
export async function deleteAccount(
  password?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Unauthenticated" };

  try {
    await auth.api.deleteUser({
      headers: await headers(),
      body: password ? { password } : {},
    });
  } catch (err) {
    const message =
      err instanceof Error && err.message
        ? err.message
        : "Account deletion failed — check your password.";
    return { ok: false, error: message };
  }

  return withTenant(userId, async () => {

    try {
      await prisma.$transaction([
        prisma.chatConversation.deleteMany({ where: { userId } }),
        prisma.companyProfile.deleteMany({ where: { userId } }),
        prisma.gmailConnection.deleteMany({ where: { userId } }),
        prisma.notionConnection.deleteMany({ where: { userId } }),
        prisma.gitHubConnection.deleteMany({ where: { userId } }),
        prisma.customConnection.deleteMany({ where: { userId } }),
        prisma.workflowExecution.deleteMany({ where: { userId } }),
        prisma.workflow.deleteMany({ where: { userId } }),
      ]);
    } catch (err) {
      // Auth account is already gone — log the orphaned data, don't block the user.
      console.error(`[deleteAccount] business-data purge failed for ${userId}:`, err);
    }

    return { ok: true };
  });
}

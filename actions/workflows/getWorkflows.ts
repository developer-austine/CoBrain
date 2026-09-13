"use server"

import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { getCurrentUserId } from "@/lib/get-session";

export async function getWorkflows() {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Unauthenticated");

  return withTenant(userId, async () => {

    return prisma.workflow.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id:          true,
        name:        true,
        description: true,
        status:      true,
        createdAt:   true,
        updatedAt:   true,
      },
    });
  });
}
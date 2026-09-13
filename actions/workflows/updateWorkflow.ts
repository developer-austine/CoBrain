"use server"

import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { getCurrentUserId } from "@/lib/get-session";

export async function UpdateWorkflow({
    id,
    definition
}: {
    id: string;
    definition: string
}) {
    const userId = await getCurrentUserId();
    if (!userId) {
        throw new Error("unauthenticated")
    }

    return withTenant(userId, async () => {
      const workflow = await prisma.workflow.findUnique({
          where: {
              id,
              userId,
          },
      });

      if (!workflow) throw new Error("Workflow not found");

      await prisma.workflow.update({
          data: {
              definition,
          },
          where: {
              id,
              userId
          },
      });
    });
}
"use server"

import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import { revalidatePath } from "next/cache";

export async function deleteWorkflow(id: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Unauthenticated");

  return withTenant(userId, async () => {

    await prisma.workflow.delete({
      where: { id, userId },
    });

    revalidatePath("/");
  });
}
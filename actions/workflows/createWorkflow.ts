"use server"

import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import { redirect } from "next/navigation";

export async function createWorkflow({
  name,
  description,
}: {
  name: string;
  description?: string;
}) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Unauthenticated");

  return withTenant(userId, async () => {

    const workflow = await prisma.workflow.create({
      data: {
        userId,
        name,
        description: description ?? "",
        definition: JSON.stringify({ nodes: [], edges: [] }), // empty canvas
        status: "draft",
      },
    });

    redirect(`/connectors/${workflow.id}`);
  });
}
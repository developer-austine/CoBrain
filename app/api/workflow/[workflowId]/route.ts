import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const { workflowId } = await params;

  const headersList = await headers();
  const cookie = headersList.get("cookie");

  const session = await auth.api.getSession({
    headers: { cookie: cookie || "" },
  });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const userId = session.user.id;

  return withTenant(userId, async () => {
  try {
    const workflow = await prisma.workflow.findUnique({
      where:  { id: workflowId, userId },
      select: { definition: true, name: true, status: true },
    });

    if (!workflow) {
      return NextResponse.json({ definition: null });
    }

    return NextResponse.json({ definition: workflow.definition });
  } catch (err) {
    console.error("[api/workflow] GET error:", err);
    return NextResponse.json({ definition: null });
  }
  });
}
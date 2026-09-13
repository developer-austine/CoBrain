import { NextRequest, NextResponse } from "next/server";
import { PrismaClient }              from "@/lib/generated/prisma/client";
import { PrismaPg }                  from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter });

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const workflowId = searchParams.get("workflowId");
  const nodeId     = searchParams.get("nodeId");

  if (!workflowId || !nodeId) {
    return NextResponse.json({ workspaceName: null }, { status: 400 });
  }

  const connection = await prisma.notionConnection.findUnique({
    where:  { workflowId_nodeId: { workflowId, nodeId } },
    select: { workspaceName: true },
  });

  // Frontend uses this to show "connected as X"
  return NextResponse.json({
    workspaceName: connection?.workspaceName ?? null,
  });
}
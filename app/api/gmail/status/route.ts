import { NextRequest, NextResponse } from "next/server";
import { PrismaClient }              from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({adapter});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const workflowId = searchParams.get("workflowId");
  const nodeId     = searchParams.get("nodeId");

  if (!workflowId || !nodeId) {
    return NextResponse.json({ email: null }, { status: 400 });
  }

  const connection = await prisma.gmailConnection.findUnique({
    where:  { workflowId_nodeId: { workflowId, nodeId } },
    select: { email: true },
  });

  return NextResponse.json({ email: connection?.email ?? null });
}
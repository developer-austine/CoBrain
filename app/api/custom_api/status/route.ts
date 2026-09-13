import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
    const headersList = await headers();
    const cookie = headersList.get("cookie");

    const session = await auth.api.getSession({
      headers: { cookie: cookie || "" },
    });

    if (!session?.user?.id) {
        return NextResponse.json({ connected: false}, { status: 401 })
    }

    const userId = session.user.id;

    const { searchParams } = new URL(req.url)
    const workflowId = searchParams.get("workflowId")
    const nodeId = searchParams.get("nodeId")

    if(!workflowId || !nodeId) {
        return NextResponse.json({ connected: false}, { status: 400 })
    }

    const conn = await prisma.customConnection.findUnique({
        where: { workflowId_nodeId: { workflowId, nodeId } }
    })

    return NextResponse.json({
        connected: conn?.status === 'CONNECTED',
        name: conn?.name,
        lastSyncAt: conn?.lastSyncAt,
        lastSyncError: conn?.lastSyncError,
    })
}
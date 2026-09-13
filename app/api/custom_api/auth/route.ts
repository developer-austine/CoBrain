import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { randomBytes } from "crypto"
import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
    const headersList = await headers();
    const cookie = headersList.get("cookie");

    const session = await auth.api.getSession({
      headers: { cookie: cookie || "" },
    });

    if (!session?.user?.id) {
        return new Response("Unauthorized", { status: 401 })
    }

    const userId = session.user.id;

    const { workflowId, nodeId, name } = await req.json()

    const connection = await prisma.customConnection.upsert({
        where: { workflowId_nodeId: { workflowId: workflowId, nodeId } },
        create: {
            userId,
            workflowId,
            nodeId,
            name,
            clientSecret: `cs_${randomBytes(32).toString('hex')}`,
            webhookSecret: `whsec_${randomBytes(32).toString('hex')}`,
        },
        update: {
            name,
        }
    })

    return NextResponse.json({
        clientId: connection.clientId,
        clientSecret: connection.clientSecret,
        webhookSecret: connection.webhookSecret,
        ingestUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/api/custom_api/ingest`
    })
 }
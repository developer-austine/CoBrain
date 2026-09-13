import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * POST /api/workflow/[workflowId]/run
 *
 * Trigger a workflow execution:
 * 1. Create WorkflowExecution record
 * 2. Queue all PENDING documents from this workflow's connections
 * 3. Update statuses to QUEUED
 * 4. Return execution ID + count of queued documents
 *
 * This is the main entry point for running a workflow end-to-end.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const headersList = await headers();
  const cookie = headersList.get("cookie");

  const session = await auth.api.getSession({
    headers: { cookie: cookie || "" },
  });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const userId = session.user.id;

  const { workflowId } = await params;

  try {
    // Verify workflow exists and belongs to user
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId, userId },
    });
    if (!workflow) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }

    // Create execution record
    const execution = await prisma.workflowExecution.create({
      data: {
        workflowId,
        userId,
        trigger: "manual",
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    // Queue all PENDING documents from this workflow's connections
    let emailsQueued = 0;
    let githubQueued = 0;
    let notionQueued = 0;
    let customQueued = 0;

    // Get all connections for this workflow and queue their PENDING documents
    // For simplicity, queue all PENDING documents (could filter by connection later)

    // Queue Gmail emails
    const emails = await prisma.email.findMany({
      where: { status: "PENDING" },
      select: { id: true, gmailConnectionId: true, from: true, subject: true, date: true, bodyText: true, bodyHtml: true },
    });
    for (const email of emails) {
      // Only queue if from a connection in this workflow
      const conn = await prisma.gmailConnection.findUnique({
        where: { id: email.gmailConnectionId },
      });
      if (conn?.workflowId === workflowId) {
        await queueDocument("gmail", email.id, email.from || "", email.subject || "", email.bodyText || email.bodyHtml || "", email.date?.toISOString() || new Date().toISOString(), userId);
        emailsQueued++;
      }
    }

    // Queue GitHub items
    const githubItems = await prisma.gitHubItem.findMany({
      where: { status: "PENDING" },
      select: { id: true, githubConnectionId: true, author: true, title: true, body: true, createdAt: true },
    });
    for (const item of githubItems) {
      const conn = await prisma.gitHubConnection.findUnique({
        where: { id: item.githubConnectionId },
      });
      if (conn?.workflowId === workflowId) {
        await queueDocument("github", item.id, item.author || "", item.title || "", item.body || "", item.createdAt?.toISOString() || new Date().toISOString(), userId);
        githubQueued++;
      }
    }

    // Queue Notion pages
    const notionPages = await prisma.notionPage.findMany({
      where: { status: "PENDING" },
      select: { id: true, notionConnectionId: true, createdByName: true, title: true, plainText: true, syncedAt: true },
    });
    for (const page of notionPages) {
      const conn = await prisma.notionConnection.findUnique({
        where: { id: page.notionConnectionId },
      });
      if (conn?.workflowId === workflowId) {
        await queueDocument("notion", page.id, page.createdByName || "", page.title || "", page.plainText || "", page.syncedAt?.toISOString() || new Date().toISOString(), userId);
        notionQueued++;
      }
    }

    // Queue Custom documents
    const customDocs = await prisma.customDocument.findMany({
      where: { status: "PENDING" },
      select: { id: true, connectionId: true, source: true },
    });
    for (const doc of customDocs) {
      const conn = await prisma.customConnection.findUnique({
        where: { id: doc.connectionId },
      });
      if (conn?.workflowId === workflowId) {
        // For custom docs, extract content from rawPayload
        const content = typeof doc.source === "string" ? doc.source : JSON.stringify(doc);
        await queueDocument("custom", doc.id, doc.source || "", doc.source || "", content, new Date().toISOString(), userId);
        customQueued++;
      }
    }

    const totalQueued = emailsQueued + githubQueued + notionQueued + customQueued;

    return NextResponse.json({
      success: true,
      executionId: execution.id,
      totalQueued,
      breakdown: {
        emails: emailsQueued,
        github: githubQueued,
        notion: notionQueued,
        custom: customQueued,
      },
      message: `Queued ${totalQueued} documents for processing`,
    });
  } catch (err) {
    console.error("[api/workflow/run] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Helper: Queue a document by publishing to Redis
 */
async function queueDocument(
  source: string,
  docId: string,
  author: string,
  subject: string,
  content: string,
  timestamp: string,
  userId: string
) {
  try {
    const queuePayload = {
      raw_document_id: docId,
      source,
      external_id: docId,
      author,
      subject,
      content,
      timestamp,
      metadata: {},
      connector_id: "",
      namespace: `${userId}:${source}`,
    };

    // Publish via Redis
    const redis = require("redis").createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
    await redis.connect();
    await redis.lPush("company_brain:ingest", JSON.stringify(queuePayload));
    await redis.disconnect();

    // Update document status to QUEUED
    switch (source) {
      case "gmail":
        await prisma.email.update({
          where: { id: docId },
          data: { status: "QUEUED", queuedAt: new Date() },
        });
        break;
      case "github":
        await prisma.gitHubItem.update({
          where: { id: docId },
          data: { status: "QUEUED", queuedAt: new Date() },
        });
        break;
      case "notion":
        await prisma.notionPage.update({
          where: { id: docId },
          data: { status: "QUEUED", queuedAt: new Date() },
        });
        break;
      case "custom":
        await prisma.customDocument.update({
          where: { id: docId },
          data: { status: "QUEUED", queuedAt: new Date() },
        });
        break;
    }
  } catch (err) {
    console.error(`[queueDocument] Failed to queue ${source}:${docId}:`, err);
  }
}

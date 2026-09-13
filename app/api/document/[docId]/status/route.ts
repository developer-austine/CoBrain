import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * GET /api/document/[docId]/status
 *
 * Returns the pipeline status of a document (Email, GitHubItem, NotionPage, CustomDocument).
 * Used by frontend to track processing progress.
 *
 * Response: { status, errorMessage, processedAt, source, author, subject }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const headersList = await headers();
  const cookie = headersList.get("cookie");

  const session = await auth.api.getSession({
    headers: { cookie: cookie || "" },
  });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { docId } = await params;

  try {
    // Try each source type — documents don't have a fixed table
    // Frontend should pass docId + source for efficiency, but we'll search all

    // 1. Check Email
    const email = await prisma.email.findUnique({
      where: { id: docId },
      select: {
        status: true,
        errorMessage: true,
        queuedAt: true,
        processedAt: true,
        subject: true,
        from: true,
      },
    });
    if (email) {
      return NextResponse.json({
        id: docId,
        source: "gmail",
        status: email.status,
        errorMessage: email.errorMessage,
        queuedAt: email.queuedAt,
        processedAt: email.processedAt,
        subject: email.subject,
        author: email.from,
      });
    }

    // 2. Check GitHubItem
    const githubItem = await prisma.gitHubItem.findUnique({
      where: { id: docId },
      select: {
        status: true,
        errorMessage: true,
        queuedAt: true,
        processedAt: true,
        title: true,
        author: true,
      },
    });
    if (githubItem) {
      return NextResponse.json({
        id: docId,
        source: "github",
        status: githubItem.status,
        errorMessage: githubItem.errorMessage,
        queuedAt: githubItem.queuedAt,
        processedAt: githubItem.processedAt,
        title: githubItem.title,
        author: githubItem.author,
      });
    }

    // 3. Check NotionPage
    const notionPage = await prisma.notionPage.findUnique({
      where: { id: docId },
      select: {
        status: true,
        errorMessage: true,
        queuedAt: true,
        processedAt: true,
        title: true,
        createdByName: true,
      },
    });
    if (notionPage) {
      return NextResponse.json({
        id: docId,
        source: "notion",
        status: notionPage.status,
        errorMessage: notionPage.errorMessage,
        queuedAt: notionPage.queuedAt,
        processedAt: notionPage.processedAt,
        title: notionPage.title,
        author: notionPage.createdByName,
      });
    }

    // 4. Check CustomDocument
    const customDoc = await prisma.customDocument.findUnique({
      where: { id: docId },
      select: {
        status: true,
        errorMessage: true,
        queuedAt: true,
        processedAt: true,
        source: true,
      },
    });
    if (customDoc) {
      return NextResponse.json({
        id: docId,
        source: "custom",
        customSource: customDoc.source,
        status: customDoc.status,
        errorMessage: customDoc.errorMessage,
        queuedAt: customDoc.queuedAt,
        processedAt: customDoc.processedAt,
      });
    }

    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  } catch (err) {
    console.error("[api/document/status] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

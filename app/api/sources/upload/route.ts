import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import { redis } from "@/lib/queue/publisher";
import { validateUpload } from "@/lib/sources/constants";
import { buildStorageKey, putObject } from "@/lib/sources/storage";
import { extractText } from "@/lib/sources/extract";
import { runExtractionFor } from "@/lib/brain/extractionRunner";

export const runtime = "nodejs";

const QUEUE_KEY = "company_brain:ingest";

/**
 * POST /api/sources/upload  (multipart/form-data, field "file")
 *
 * Uploaded files are just a new source type feeding the existing pipeline
 * (blueprint §9.3): store in MinIO → SourceFile row (PENDING) → extract text
 * → push to Redis (source="upload") → mark QUEUED. The Python consumer then
 * normalises → PII scrubs → chunks → embeds → Qdrant, exactly like a
 * connector document, and flips the row to PROCESSED/FAILED.
 *
 * Two things happen to the text, not one. The Redis leg makes the document
 * *findable*; the `after()` leg below makes the brain *know* it — reading the
 * whole file and queueing what it learned. They are deliberately independent:
 * knowledge extraction calls an LLM and can fail or be rate-limited, and a
 * document that is searchable but not yet read is a much better outcome than an
 * upload that failed outright.
 */
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  return withTenant(userId, async () => {

    let file: File | null = null;
    try {
      const form = await req.formData();
      const value = form.get("file");
      if (value instanceof File) file = value;
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const check = validateUpload(file.name, file.type, file.size);
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 415 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const storageKey = buildStorageKey(userId, file.name);

    // 1. Persist the raw file to sovereign storage.
    try {
      await putObject(storageKey, buffer, file.type || "application/octet-stream");
    } catch (err) {
      console.error("[sources/upload] storage error:", err);
      return NextResponse.json(
        { error: "Storage is unavailable — is MinIO running?" },
        { status: 503 }
      );
    }

    // 2. Record the source (PENDING).
    const record = await prisma.sourceFile.create({
      data: {
        userId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        storageKey,
        sizeBytes: file.size,
        status: "PENDING",
      },
      select: { id: true },
    });

    // 3. Extract text; empty/failed extraction fails softly (row marked FAILED).
    let extracted: { text: string; chars: number };
    try {
      extracted = await extractText(check.kind, buffer);
    } catch (err) {
      console.error("[sources/upload] extraction error:", err);
      await prisma.sourceFile.update({
        where: { id: record.id },
        data: { status: "FAILED", errorMessage: "Could not extract text from this file" },
      });
      return NextResponse.json(
        { id: record.id, status: "FAILED", error: "Could not read text from this file" },
        { status: 422 }
      );
    }

    if (!extracted.text) {
      await prisma.sourceFile.update({
        where: { id: record.id },
        data: {
          status: "FAILED",
          extractedChars: 0,
          errorMessage: "No extractable text (scanned images need OCR — coming soon)",
        },
      });
      return NextResponse.json(
        { id: record.id, status: "FAILED", error: "No readable text found in this file" },
        { status: 422 }
      );
    }

    // 4. Queue through the same pipeline as connectors, then mark QUEUED.
    const payload = JSON.stringify({
      raw_document_id: record.id,
      source: "upload",
      external_id: record.id,
      author: "",
      subject: file.name,
      content: extracted.text,
      timestamp: new Date().toISOString(),
      metadata: { file_name: file.name, mime_type: file.type },
      connector_id: "",
      namespace: `${userId}:upload`,
    });

    try {
      await redis.lpush(QUEUE_KEY, payload);
      await prisma.sourceFile.update({
        where: { id: record.id },
        data: { status: "QUEUED", queuedAt: new Date(), extractedChars: extracted.chars },
      });
    } catch (err) {
      console.error("[sources/upload] queue error:", err);
      await prisma.sourceFile.update({
        where: { id: record.id },
        data: { status: "FAILED", errorMessage: "Could not queue for processing" },
      });
      return NextResponse.json({ error: "Could not queue file for processing" }, { status: 503 });
    }

    // 5. Read it into the brain once the response is on its way.
    //
    // `after()` rather than awaiting: extraction on a long PDF is several model
    // calls, and the upload UI should not sit spinning through them. If the
    // process dies mid-read the row stays brainStatus=PENDING and the cron
    // picks it up — which is also what makes this safe to fire and forget.
    after(async () => {
      try {
        await runExtractionFor(userId, record.id);
      } catch (err) {
        console.error(`[sources/upload] extraction failed for ${record.id}:`, err);
      }
    });

    return NextResponse.json({
      id: record.id,
      fileName: file.name,
      status: "QUEUED",
      extractedChars: extracted.chars,
    });
  });
}

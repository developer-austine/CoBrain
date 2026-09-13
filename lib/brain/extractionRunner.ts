import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { kindForFile } from "@/lib/sources/constants";
import { getObject, putObject } from "@/lib/sources/storage";
import { extractImages, extractText } from "@/lib/sources/extract";
import { extractKnowledge, type ExtractionOutcome } from "./extraction";

/**
 * Lifecycle around `extractKnowledge` — locking, status, and retry.
 *
 * The engine itself is pure-ish: text in, blocks out. Everything about *which*
 * sources are owed a read, and making sure each is read exactly once, lives
 * here, because two callers need identical behaviour:
 *
 *  - the upload route, firing immediately so a user sees their document turn
 *    into knowledge while they are still looking at the page
 *  - the cron, sweeping up anything the first path never finished
 *
 * The text is re-read from object storage rather than passed in from the
 * upload. It costs one fetch, and it means the retry path is the same code as
 * the happy path instead of a second implementation that only runs when
 * something has already gone wrong.
 */

/** A read stuck in RUNNING this long is from a process that died mid-file. */
const STALE_LOCK_MS = 10 * 60 * 1000;

/**
 * Documents read per cron tick.
 *
 * One, not a batch: reading a single document is up to MAX_WINDOWS sequential
 * model calls, and the serverless host this runs on caps a request at 60
 * seconds. A batch of three reliably exceeds that, and a timeout mid-document
 * leaves the row locked until the stale-lock window expires — slower overall
 * than doing one document per poke and letting the next poke take the next.
 */
const CRON_BATCH = 1;

/**
 * Claim a source for extraction, or report that it is not ours to run.
 *
 * The conditional `updateMany` is the lock: `brainStatus` moves PENDING →
 * RUNNING only if it is still PENDING, so the cron and an in-flight upload
 * racing on the same row means one of them updates zero rows and backs off.
 */
async function claim(sourceId: string, userId: string): Promise<boolean> {
  const stale = new Date(Date.now() - STALE_LOCK_MS);
  const claimed = await prisma.sourceFile.updateMany({
    where: {
      id: sourceId,
      userId,
      OR: [
        { brainStatus: "PENDING" },
        // A crashed run left RUNNING behind; reclaim it rather than stranding
        // the document unread forever.
        { brainStatus: "RUNNING", brainAt: { lt: stale } },
      ],
    },
    data: { brainStatus: "RUNNING", brainAt: new Date() },
  });
  return claimed.count > 0;
}

/**
 * Pull the document's diagrams into object storage and return their keys.
 *
 * Stored beside the source file under a per-source prefix, so they are covered
 * by the same retention and the same tenant path as the document they came from.
 * Fail-soft throughout: a picture that cannot be saved must not cost us the
 * knowledge in the text.
 */
async function storeImages(
  kind: Parameters<typeof extractImages>[0],
  buffer: Buffer,
  userId: string,
  sourceId: string
): Promise<{ key: string; page: number }[]> {
  const images = await extractImages(kind, buffer);
  const stored: { key: string; page: number }[] = [];

  for (const image of images) {
    const key = `${userId}/source-images/${sourceId}/p${image.page}-${image.index}.png`;
    try {
      await putObject(key, image.data, "image/png");
      stored.push({ key, page: image.page });
    } catch (err) {
      console.error(`[brain/extraction] could not store image ${key}:`, err);
    }
  }

  return stored;
}

/** Read one uploaded file into the brain. Safe to call twice; the second is a no-op. */
export async function runExtractionFor(
  userId: string,
  sourceId: string
): Promise<ExtractionOutcome> {
  return withTenant(userId, async () => {
    if (!(await claim(sourceId, userId))) {
      return { status: "SKIPPED", created: 0, updated: 0, skipped: 0, reason: "already running or done" };
    }

    const file = await prisma.sourceFile.findFirst({
      where: { id: sourceId, userId },
      select: { id: true, fileName: true, mimeType: true, storageKey: true },
    });

    if (!file) {
      return { status: "SKIPPED", created: 0, updated: 0, skipped: 0, reason: "source not found" };
    }

    let outcome: ExtractionOutcome;
    try {
      const kind = kindForFile(file.fileName, file.mimeType);
      if (!kind) {
        outcome = { status: "SKIPPED", created: 0, updated: 0, skipped: 0, reason: "unsupported file type" };
      } else {
        const buffer = await getObject(file.storageKey);
        const { text } = await extractText(kind, buffer);
        const images = await storeImages(kind, buffer, userId, file.id);

        outcome = await extractKnowledge(userId, {
          id: file.id,
          kind: "upload",
          title: file.fileName,
          text,
          images,
        });
      }
    } catch (err) {
      console.error(`[brain/extraction] run failed for ${sourceId}:`, err);
      outcome = {
        status: "FAILED",
        created: 0,
        updated: 0,
        skipped: 0,
        reason: err instanceof Error ? err.message : "extraction failed",
      };
    }

    await prisma.sourceFile.updateMany({
      where: { id: sourceId, userId },
      data: {
        // FAILED goes back to PENDING so the cron retries it: the usual causes
        // are transient (no API key yet, rate limit, MinIO restarting), and a
        // permanent FAILED would mean a document silently never read.
        brainStatus: outcome.status === "FAILED" ? "PENDING" : "DONE",
        brainError: outcome.status === "FAILED" ? (outcome.reason ?? null) : null,
        brainBlocks: outcome.created + outcome.updated,
        brainAt: new Date(),
      },
    });

    return outcome;
  });
}

/**
 * Sweep sources that were never read — the safety net behind the upload path.
 *
 * Ordered oldest-first so a backlog drains in the order it arrived rather than
 * the newest upload starving everything behind it.
 */
export async function runPendingExtractions(limit = CRON_BATCH): Promise<{
  ran: number;
  outcomes: { sourceId: string; outcome: ExtractionOutcome }[];
}> {
  const stale = new Date(Date.now() - STALE_LOCK_MS);

  // Deliberately unscoped by tenant: this is the machine-to-machine sweep, and
  // it has to see every tenant's backlog. Each row is then processed inside its
  // own owner's tenant scope below.
  const due = await prisma.sourceFile.findMany({
    where: {
      status: { in: ["QUEUED", "PROCESSED"] },
      OR: [{ brainStatus: "PENDING" }, { brainStatus: "RUNNING", brainAt: { lt: stale } }],
    },
    select: { id: true, userId: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const outcomes: { sourceId: string; outcome: ExtractionOutcome }[] = [];
  for (const row of due) {
    outcomes.push({ sourceId: row.id, outcome: await runExtractionFor(row.userId, row.id) });
  }

  return { ran: outcomes.length, outcomes };
}

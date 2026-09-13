import prisma from "@/lib/prisma";
import { redis } from "@/lib/queue/publisher";

const QUEUE_KEY = "company_brain:ingest";
const BATCH = 500;

/**
 * Queue every PENDING document belonging to a workflow's connections onto the
 * Redis ingest queue, then mark them QUEUED. Payload shape must match what the
 * Python consumer parses (QueuePayload.from_dict).
 *
 * Returns per-source queued counts.
 */
export async function queueWorkflowDocuments(workflowId: string, userId: string) {
  const payloads: string[] = [];
  // Docs with no text content crash the consumer's payload validation — skip
  // them at queue time and mark them PROCESSED (there is nothing to process).
  const skipped: { emails: string[]; github: string[]; notion: string[]; custom: string[] } =
    { emails: [], github: [], notion: [], custom: [] };

  const make = (
    source: string,
    id: string,
    author: string,
    subject: string,
    content: string,
    timestamp: string
  ) =>
    JSON.stringify({
      raw_document_id: id,
      source,
      external_id: id,
      author,
      subject,
      content,
      timestamp,
      metadata: {},
      connector_id: "",
      namespace: `${userId}:${source}`,
    });

  // NOTE: small sources (Notion/GitHub/Custom) are queued BEFORE the email
  // flood so a handful of pages is never starved behind thousands of emails.

  // ── GitHub ───────────────────────────────────────────────────────────────
  const items = await prisma.gitHubItem.findMany({
    where: { status: "PENDING", connection: { workflowId } },
    select: { id: true, author: true, title: true, body: true, createdAt: true },
  });
  for (const g of items) {
    const content = g.body ?? "";
    if (!content.trim()) { skipped.github.push(g.id); continue; }
    payloads.push(
      make("github", g.id, g.author ?? "", g.title ?? "", content, (g.createdAt ?? new Date()).toISOString())
    );
  }

  // ── Notion ───────────────────────────────────────────────────────────────
  const pages = await prisma.notionPage.findMany({
    where: { status: "PENDING", connection: { workflowId } },
    select: { id: true, createdByName: true, title: true, plainText: true, syncedAt: true },
  });
  for (const p of pages) {
    const content = p.plainText ?? "";
    if (!content.trim()) { skipped.notion.push(p.id); continue; }
    payloads.push(
      make(
        "notion",
        p.id,
        p.createdByName ?? "",
        p.title ?? "",
        content,
        (p.syncedAt ?? new Date()).toISOString()
      )
    );
  }

  // ── Custom ───────────────────────────────────────────────────────────────
  const docs = await prisma.customDocument.findMany({
    where: { status: "PENDING", connection: { workflowId } },
    select: { id: true, externalId: true, rawPayload: true, createdAt: true },
  });
  for (const d of docs) {
    const content =
      typeof d.rawPayload === "string" ? d.rawPayload : JSON.stringify(d.rawPayload ?? {});
    if (!content.trim() || content === "{}") { skipped.custom.push(d.id); continue; }
    payloads.push(
      make("custom", d.id, "", d.externalId ?? "", content, (d.createdAt ?? new Date()).toISOString())
    );
  }

  // ── Gmail (largest source last) ──────────────────────────────────────────
  const emails = await prisma.email.findMany({
    where: { status: "PENDING", connection: { workflowId } },
    select: { id: true, from: true, subject: true, bodyText: true, bodyHtml: true, date: true },
  });
  for (const e of emails) {
    const content = e.bodyText || e.bodyHtml || "";
    if (!content.trim()) { skipped.emails.push(e.id); continue; }
    payloads.push(
      make(
        "gmail",
        e.id,
        e.from ?? "",
        e.subject ?? "",
        content,
        (e.date ?? new Date()).toISOString()
      )
    );
  }

  // ── Push to Redis in batches, then flip statuses to QUEUED ──────────────
  for (let i = 0; i < payloads.length; i += BATCH) {
    await redis.lpush(QUEUE_KEY, ...payloads.slice(i, i + BATCH));
  }

  const now = new Date();
  const queuedWhere = { status: "PENDING", connection: { workflowId } } as const;
  await Promise.all([
    prisma.email.updateMany({ where: queuedWhere, data: { status: "QUEUED", queuedAt: now } }),
    prisma.gitHubItem.updateMany({ where: queuedWhere, data: { status: "QUEUED", queuedAt: now } }),
    prisma.notionPage.updateMany({ where: queuedWhere, data: { status: "QUEUED", queuedAt: now } }),
    prisma.customDocument.updateMany({ where: queuedWhere, data: { status: "QUEUED", queuedAt: now } }),
  ]);

  // Empty-content docs were never queued — mark them PROCESSED directly.
  await Promise.all([
    skipped.emails.length
      ? prisma.email.updateMany({ where: { id: { in: skipped.emails } }, data: { status: "PROCESSED", processedAt: now } })
      : null,
    skipped.github.length
      ? prisma.gitHubItem.updateMany({ where: { id: { in: skipped.github } }, data: { status: "PROCESSED", processedAt: now } })
      : null,
    skipped.notion.length
      ? prisma.notionPage.updateMany({ where: { id: { in: skipped.notion } }, data: { status: "PROCESSED", processedAt: now } })
      : null,
    skipped.custom.length
      ? prisma.customDocument.updateMany({ where: { id: { in: skipped.custom } }, data: { status: "PROCESSED", processedAt: now } })
      : null,
  ]);

  return {
    total: payloads.length,
    emails: emails.length - skipped.emails.length,
    github: items.length - skipped.github.length,
    notion: pages.length - skipped.notion.length,
    custom: docs.length - skipped.custom.length,
  };
}

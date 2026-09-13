import "server-only";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/queue/publisher";
import type { SyncResult } from "./types";
import {
  composePageDocument,
  createUserResolver,
  extractPageText,
  extractTitle,
  fetchPageComments,
  hasSubstance,
  renderProperties,
  RATE_LIMIT_MS,
} from "./notionExtract";

/**
 * Notion sync service.
 *
 * One implementation shared by the "Sync now" button (app/api/notion/sync) and
 * the scheduler (lib/connector/sync/runner), so a manual sync and an automatic
 * one can never diverge — and both enqueue for ingestion, which the old route
 * did not (it left rows at status=PENDING waiting for a manual queue flush).
 *
 * Already incremental: Notion's search API filters on `last_edited_time`, and
 * we persist the high-water mark in NotionSyncCursor. So a 3-hour refresh only
 * walks pages that actually changed.
 *
 * Text extraction lives in ./notionExtract — a page's meaning is spread across
 * its title, its database properties, its block tree AND its comments, and
 * reading only the blocks loses every task assignee and every member
 * discussion.
 */

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const QUEUE_KEY = "company_brain:ingest";
const SUB_SOURCE = "notion";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type NotionConnection = {
  id: string;
  userId: string;
  accessToken: string;
  workspaceName: string | null;
};

function notionHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function searchAllPages(accessToken: string, lastEditedAfter: string | null) {
  const pages: any[] = [];
  let startCursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const body: Record<string, any> = {
      filter: { property: "object", value: "page" },
      page_size: 100,
      ...(startCursor ? { start_cursor: startCursor } : {}),
    };
    if (lastEditedAfter) {
      body.filter = {
        and: [
          { property: "object", value: "page" },
          { timestamp: "last_edited_time", last_edited_time: { after: lastEditedAfter } },
        ],
      };
    }

    const res = await fetch(`${NOTION_API}/search`, {
      method: "POST",
      headers: notionHeaders(accessToken),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Notion search failed: ${res.status} ${await res.text()}`);

    const data = await res.json();
    pages.push(...(data.results ?? []));
    hasMore = data.has_more;
    startCursor = data.next_cursor ?? undefined;
    if (hasMore) await sleep(RATE_LIMIT_MS);
  }
  return pages;
}

/** Sync one Notion connection: delta-search → flatten → upsert → enqueue → advance cursor. */
export async function syncNotionConnection(connection: NotionConnection): Promise<SyncResult> {
  const cursorRecord = await prisma.notionSyncCursor.findUnique({
    where: { connectionId_subSource: { connectionId: connection.id, subSource: SUB_SOURCE } },
  });
  const lastEditedAfter = cursorRecord?.cursor ?? null;

  // One resolver per run: member names repeat across every page, so the cache
  // turns N property lookups into one call per distinct person.
  const resolveUser = createUserResolver(connection.accessToken);

  let synced = 0;
  let skipped = 0;
  let latestEditedTime: string | null = lastEditedAfter;

  const pages = await searchAllPages(connection.accessToken, lastEditedAfter);

  for (const page of pages) {
    const notionPageId = page.id as string;
    const lastEdited = page.last_edited_time as string;

    // Unchanged since we last stored it — nothing to do.
    const existing = await prisma.notionPage.findUnique({
      where: {
        notionConnectionId_notionPageId: { notionConnectionId: connection.id, notionPageId },
      },
      select: { notionEditedTime: true },
    });
    if (existing?.notionEditedTime === lastEdited) {
      skipped++;
      continue;
    }

    const title = extractTitle(page);

    await sleep(RATE_LIMIT_MS);
    const body = await extractPageText(connection.accessToken, notionPageId);

    // Properties carry the task metadata (owner, status, dates); comments carry
    // the conversation. A database row often has ONLY properties.
    const properties = await renderProperties(page, resolveUser);
    await sleep(RATE_LIMIT_MS);
    const comments = await fetchPageComments(connection.accessToken, notionPageId, resolveUser);

    const plainText = composePageDocument({ title, properties, body, comments });

    if (!hasSubstance(plainText, title)) {
      skipped++;
      continue;
    }

    const createdByName = (await resolveUser(page.created_by?.id)) ?? page.created_by?.id ?? null;

    try {
      const stored = await prisma.notionPage.upsert({
        where: {
          notionConnectionId_notionPageId: { notionConnectionId: connection.id, notionPageId },
        },
        create: {
          notionConnectionId: connection.id,
          notionPageId,
          notionEditedTime: lastEdited,
          title,
          plainText,
          snippet: plainText.slice(0, 200),
          createdByName,
          parentType: page.parent?.type ?? null,
          url: page.url ?? null,
        },
        update: {
          notionEditedTime: lastEdited,
          title,
          plainText,
          snippet: plainText.slice(0, 200),
          createdByName,
          status: "PENDING", // edited again — must be re-embedded
        },
      });

      await redis.lpush(
        QUEUE_KEY,
        JSON.stringify({
          raw_document_id: stored.id,
          source: "notion",
          external_id: notionPageId,
          author: stored.createdByName || "",
          subject: stored.title || "",
          content: plainText,
          timestamp: lastEdited,
          metadata: {
            url: stored.url,
            parent_type: stored.parentType,
            has_properties: Boolean(properties.trim()),
            has_comments: Boolean(comments.trim()),
          },
          connector_id: connection.id,
          namespace: `${connection.userId}:notion`, // RBAC boundary
        })
      );

      synced++;
      if (!latestEditedTime || lastEdited > latestEditedTime) latestEditedTime = lastEdited;
    } catch (err) {
      console.error(`[sync/notion] failed to store page ${notionPageId}:`, err);
      skipped++;
    }
  }

  // Advance the high-water mark only after the whole run — a partial failure
  // must not skip the pages it never reached.
  if (latestEditedTime && latestEditedTime !== lastEditedAfter) {
    await prisma.notionSyncCursor.upsert({
      where: { connectionId_subSource: { connectionId: connection.id, subSource: SUB_SOURCE } },
      create: { connectionId: connection.id, subSource: SUB_SOURCE, cursor: latestEditedTime },
      update: { cursor: latestEditedTime },
    });
  }

  return { source: "notion", itemCount: synced, skipped, incremental: Boolean(lastEditedAfter) };
}

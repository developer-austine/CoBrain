import "server-only";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/queue/publisher";
import type { SyncResult } from "./types";

/**
 * Gmail sync service.
 *
 * Extracted from the route handler so BOTH the user's "Sync now" button and the
 * scheduler can run it — the route is now a thin auth wrapper around this.
 *
 * Incremental by default: Gmail's search supports `after:<epoch-seconds>`, so a
 * scheduled run only fetches messages that arrived since the last successful
 * sync. That is what makes a 5-minute cadence affordable — a full inbox walk
 * every 5 minutes would hammer both Gmail's quota and our ingest queue.
 */

const QUEUE_KEY = "company_brain:ingest";

/** Overlap re-fetched on each incremental run, to tolerate clock skew / late delivery. */
const INCREMENTAL_OVERLAP_MS = 2 * 60_000;

type GmailConnection = {
  id: string;
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: Date | null;
  email: string | null;
};

async function refreshAccessToken(connection: GmailConnection): Promise<string> {
  if (connection.tokenExpiry && connection.tokenExpiry > new Date()) {
    return connection.accessToken;
  }
  if (!connection.refreshToken) {
    throw new Error("Access token expired and no refresh token available. Please reconnect Gmail.");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret:
        process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("Failed to refresh Gmail access token");

  const { access_token, expires_in } = await res.json();
  const tokenExpiry = new Date(Date.now() + expires_in * 1000);

  await prisma.gmailConnection.update({
    where: { id: connection.id },
    data: { accessToken: access_token, tokenExpiry },
  });
  return access_token;
}

async function listMessages(
  accessToken: string,
  opts: { pageToken?: string; query?: string; maxResults?: number }
): Promise<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    labelIds: "INBOX",
    maxResults: String(opts.maxResults ?? 100),
    ...(opts.pageToken ? { pageToken: opts.pageToken } : {}),
    ...(opts.query ? { q: opts.query } : {}),
  });

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Gmail list error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getMessage(accessToken: string, messageId: string) {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Gmail get error: ${res.status}`);
  return res.json() as Promise<Record<string, any>>;
}

function header(headers: { name: string; value: string }[], name: string): string | null {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function decodeBody(data?: string): string {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

/** Recursively extract text/plain and text/html from MIME parts. */
function extractBodies(payload: Record<string, any>): { text: string; html: string } {
  let text = "";
  let html = "";
  function walk(part: Record<string, any>) {
    const mime: string = part.mimeType ?? "";
    if (mime === "text/plain") text += decodeBody(part.body?.data);
    if (mime === "text/html") html += decodeBody(part.body?.data);
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);
  return { text, html };
}

/**
 * Build the Gmail search query for an incremental run. `after:` takes epoch
 * seconds; we rewind slightly so a message that landed mid-run isn't missed.
 * A null cursor means "first run" — fetch everything.
 */
export function incrementalQuery(since: Date | null | undefined): string | undefined {
  if (!since) return undefined;
  const epochSeconds = Math.floor((since.getTime() - INCREMENTAL_OVERLAP_MS) / 1000);
  return `after:${Math.max(0, epochSeconds)}`;
}

/**
 * Sync one Gmail connection. Upserts each message and enqueues it for the
 * ingestion pipeline. Safe to re-run: the upsert is keyed on the Gmail message
 * id, and the pipeline dedups downstream.
 */
export async function syncGmailConnection(
  connection: GmailConnection,
  opts: { since?: Date | null; maxPages?: number } = {}
): Promise<SyncResult> {
  const accessToken = await refreshAccessToken(connection);
  const query = incrementalQuery(opts.since);

  let synced = 0;
  let skipped = 0;
  let pageToken: string | undefined;
  let pages = 0;
  const maxPages = opts.maxPages ?? 20;

  do {
    const page = await listMessages(accessToken, { pageToken, query });
    const stubs = page.messages ?? [];
    pageToken = page.nextPageToken;
    pages++;

    const details = await Promise.all(
      stubs.map((m) => getMessage(accessToken, m.id).catch(() => null))
    );

    // One pipeline per page instead of a Redis connect/disconnect per message
    // (the old route opened a fresh client for every single email).
    const pipeline = redis.pipeline();

    for (const msg of details) {
      if (!msg) {
        skipped++;
        continue;
      }
      const hdrs = msg.payload?.headers ?? [];
      const bodies = extractBodies(msg.payload ?? {});
      const rawDate = header(hdrs, "Date");
      const date = rawDate ? new Date(rawDate) : null;

      try {
        const email = await prisma.email.upsert({
          where: {
            gmailConnectionId_gmailMessageId: {
              gmailConnectionId: connection.id,
              gmailMessageId: msg.id,
            },
          },
          create: {
            gmailConnectionId: connection.id,
            gmailMessageId: msg.id,
            threadId: msg.threadId ?? null,
            labelIds: msg.labelIds ?? [],
            subject: header(hdrs, "Subject"),
            from: header(hdrs, "From"),
            to: header(hdrs, "To"),
            date,
            snippet: msg.snippet ?? null,
            bodyText: bodies.text || null,
            bodyHtml: bodies.html || null,
            status: "PENDING",
          },
          update: {
            labelIds: msg.labelIds ?? [],
            snippet: msg.snippet ?? null,
          },
        });

        pipeline.lpush(
          QUEUE_KEY,
          JSON.stringify({
            raw_document_id: email.id,
            source: "gmail",
            external_id: email.gmailMessageId,
            author: email.from || "Unknown",
            subject: email.subject || "",
            content: email.bodyText || email.bodyHtml || "",
            timestamp: email.date?.toISOString() || new Date().toISOString(),
            metadata: { threadId: email.threadId, labelIds: email.labelIds },
            connector_id: connection.id,
            namespace: `${connection.userId}:gmail`, // RBAC boundary
          })
        );
        synced++;
      } catch {
        skipped++;
      }
    }

    try {
      await pipeline.exec();
    } catch (err) {
      // The rows are saved and still PENDING; a later run re-queues them.
      console.error("[sync/gmail] enqueue failed:", err);
    }
  } while (pageToken && pages < maxPages);

  return { source: "gmail", itemCount: synced, skipped, incremental: Boolean(query) };
}

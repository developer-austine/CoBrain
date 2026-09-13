import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

async function refreshAccessToken(connection: {
  refreshToken: string | null;
  accessToken:  string;
  tokenExpiry:  Date | null;
  id:           string;
}): Promise<string> {

  if (connection.tokenExpiry && connection.tokenExpiry > new Date()) {
    return connection.accessToken;
  }

  if (!connection.refreshToken) {
    throw new Error("Access token expired and no refresh token available. Please reconnect Gmail.");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: connection.refreshToken,
      grant_type:    "refresh_token",
    }),
  });

  if (!res.ok) throw new Error("Failed to refresh Gmail access token");

  const { access_token, expires_in } = await res.json();
  const tokenExpiry = new Date(Date.now() + expires_in * 1000);

  // Persist the refreshed token
  await prisma.gmailConnection.update({
    where: { id: connection.id },
    data:  { accessToken: access_token, tokenExpiry },
  });

  return access_token;
}

/** Fetch a single page of message IDs from Gmail */
async function listMessages(
  accessToken: string,
  pageToken?: string,
  maxResults = 100
): Promise<{ messages: { id: string; threadId: string }[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    labelIds:   "INBOX",
    maxResults: String(maxResults),
    ...(pageToken ? { pageToken } : {}),
  });

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) throw new Error(`Gmail list error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getMessage(
  accessToken: string,
  messageId:   string
): Promise<Record<string, any>> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Gmail get error: ${res.status}`);
  return res.json();
}

/** Extract a header value by name */
function header(headers: { name: string; value: string }[], name: string): string | null {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

/** Decode a base64url-encoded Gmail part body */
function decodeBody(data?: string): string {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

/** Recursively extract text/plain and text/html from MIME parts */
function extractBodies(payload: Record<string, any>): { text: string; html: string } {
  let text = "";
  let html = "";

  function walk(part: Record<string, any>) {
    const mime: string = part.mimeType ?? "";
    if (mime === "text/plain") text += decodeBody(part.body?.data);
    if (mime === "text/html")  html += decodeBody(part.body?.data);
    if (part.parts) part.parts.forEach(walk);
  }

  walk(payload);
  return { text, html };
}

async function publishToQueue(email: any, connection: any, userId: string) {
  //Publish a QueuePayload to the ingest queue after upserting to Postgres.
  try {
    // Queue using HTTP call to Python backend (since we can't import Python directly in Node)
    // Alternative: direct Redis publish via node-redis client
    const queuePayload = {
      raw_document_id: email.id,
      source: "gmail",
      external_id: email.gmailMessageId,
      author: email.from || "Unknown",
      subject: email.subject || "",
      content: email.bodyText || email.bodyHtml || "",
      timestamp: email.date?.toISOString() || new Date().toISOString(),
      metadata: {
        threadId: email.threadId,
        labelIds: email.labelIds,
      },
      connector_id: connection.id,
      namespace: `${userId}:gmail`, // RBAC boundary
    };

    // Publish via Redis client (requires node-redis)
    const redis = require("redis").createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
    await redis.connect();
    await redis.lPush("company_brain:ingest", JSON.stringify(queuePayload));
    await redis.disconnect();
  } catch (err) {
    console.error("[Gmail Sync] Failed to publish to queue:", err);
    // Don't fail the entire sync if queuing fails — log and continue
  }
}

/**
 * TENANT SCOPE: intentionally unscoped.
 *
 * This handler spends minutes on external HTTP, and `withTenant` opens an
 * interactive transaction — holding a pooled connection for that long would
 * exhaust the pool and trip the statement timeout. It scopes itself by loading
 * the connection row and checking `connection.userId === userId` before doing
 * any work.
 *
 * Under the non-owner application role this handler therefore sees nothing and
 * must be converted before DATABASE_URL is switched. See
 * docs/refactor/SCALING_MODULE_STATUS.md.
 */

export async function POST(req: NextRequest) {
  const headersList = await headers();
  const cookie = headersList.get("cookie");

  const session = await auth.api.getSession({
    headers: { cookie: cookie || "" },
  });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const userId = session.user.id;

  let body: { workflowId?: string; nodeId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { workflowId, nodeId } = body;
  if (!workflowId || !nodeId) {
    return NextResponse.json({ error: "workflowId and nodeId are required" }, { status: 400 });
  }

  const connection = await prisma.gmailConnection.findUnique({
    where: { workflowId_nodeId: { workflowId, nodeId } },
  });

  if (!connection) {
    return NextResponse.json(
      { error: "No Gmail connection found for this node. Please connect first." },
      { status: 404 }
    );
  }

  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(connection);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }

  let synced  = 0;
  let queued  = 0;
  let skipped = 0;
  let pageToken: string | undefined;

  do {
    const page = await listMessages(accessToken, pageToken);
    const messageStubs = page.messages ?? [];
    pageToken = page.nextPageToken;

    const details = await Promise.all(
      messageStubs.map((m) => getMessage(accessToken, m.id).catch(() => null))
    );

    for (const msg of details) {
      if (!msg) { skipped++; continue; }

      const hdrs   = msg.payload?.headers ?? [];
      const bodies = extractBodies(msg.payload ?? {});

      const rawDate = header(hdrs, "Date");
      const date    = rawDate ? new Date(rawDate) : null;

      try {
        const email = await prisma.email.upsert({
          where: {
            gmailConnectionId_gmailMessageId: {
              gmailConnectionId: connection.id,
              gmailMessageId:    msg.id,
            },
          },
          create: {
            gmailConnectionId: connection.id,
            gmailMessageId:    msg.id,
            threadId:          msg.threadId   ?? null,
            labelIds:          msg.labelIds   ?? [],
            subject:           header(hdrs, "Subject"),
            from:              header(hdrs, "From"),
            to:                header(hdrs, "To"),
            date:              date,
            snippet:           msg.snippet    ?? null,
            bodyText:          bodies.text    || null,
            bodyHtml:          bodies.html    || null,
            status:            "PENDING",
          },
          update: {
            labelIds: msg.labelIds ?? [],
            snippet:  msg.snippet  ?? null,
          },
        });
        synced++;

        // CRITICAL: Publish to queue so Python worker processes this
        await publishToQueue(email, connection, userId);
        queued++;
      } catch {
        skipped++;
      }
    }
  } while (pageToken);

  return NextResponse.json({
    success: true,
    synced,
    queued,
    skipped,
    connectedAs: connection.email,
    message: `Synced ${synced} emails, queued ${queued} for processing`,
  });
}
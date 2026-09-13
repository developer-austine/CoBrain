import "server-only";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/queue/publisher";
import type { SyncResult } from "./types";

/**
 * Slack sync service.
 *
 * One implementation shared by the "Sync now" button (app/api/slack/sync) and
 * the scheduler (lib/connector/sync/runner), so a manual sync and an automatic
 * one can never diverge.
 *
 * Incremental by construction: `conversations.history` takes an `oldest`
 * timestamp, so a 3-hour refresh only walks what was said since the last run
 * rather than re-reading each channel from the beginning.
 *
 * Two decisions worth stating, because both cost work and both are load-bearing:
 *
 *  - **Threads are fetched, and replies stay separate messages.** Most of the
 *    substance in an active workspace lives in replies, and
 *    `conversations.history` returns only thread parents — read it alone and
 *    you get every question and never an answer. Replies keep their own author
 *    and timestamp, because collapsing a forty-reply thread into one document
 *    loses who said what.
 *  - **Only channels the bot has joined.** Slack lists channels it cannot read,
 *    and calling history on those fails per channel. Filtering up front turns a
 *    run full of errors into an honest, smaller run.
 */

const SLACK_API = "https://slack.com/api";
const QUEUE_KEY = "company_brain:ingest";

/** Slack's tier-3 methods allow roughly 50 requests/minute; stay well under. */
const RATE_LIMIT_MS = 350;
/** Channels walked per run — a workspace can have thousands. */
const MAX_CHANNELS = 50;
/** Messages per channel per run. */
const PAGE_SIZE = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type SlackConnectionLike = {
  id: string;
  userId: string;
  accessToken: string;
  teamName: string | null;
};

type SlackChannel = { id: string; name?: string; is_member?: boolean };

type SlackMsg = {
  ts: string;
  text?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  thread_ts?: string;
  reply_count?: number;
};

/**
 * Call the Slack Web API.
 *
 * Slack reports failure in the BODY (`ok: false`) with HTTP 200, so checking
 * `res.ok` alone reports success on an expired token. Rate limiting is the one
 * case worth retrying inline, because Slack tells us exactly how long to wait.
 */
async function slackApi<T>(
  token: string,
  method: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = new URL(`${SLACK_API}/${method}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? 5);
      await sleep(Math.min(retryAfter, 30) * 1000);
      continue;
    }

    const body = (await res.json()) as { ok: boolean; error?: string } & T;
    if (!body.ok) throw new Error(`slack ${method}: ${body.error ?? "unknown error"}`);
    return body;
  }
  throw new Error(`slack ${method}: rate limited after 3 attempts`);
}

/** Channels this bot can actually read. */
async function listReadableChannels(token: string): Promise<SlackChannel[]> {
  const out: SlackChannel[] = [];
  let cursor: string | undefined;

  do {
    const body = await slackApi<{
      channels: SlackChannel[];
      response_metadata?: { next_cursor?: string };
    }>(token, "conversations.list", {
      limit: 200,
      exclude_archived: "true",
      types: "public_channel,private_channel",
      cursor,
    });

    out.push(...(body.channels ?? []).filter((c) => c.is_member));
    cursor = body.response_metadata?.next_cursor || undefined;
    if (cursor) await sleep(RATE_LIMIT_MS);
  } while (cursor && out.length < MAX_CHANNELS);

  return out.slice(0, MAX_CHANNELS);
}

/** Human names for author ids, resolved once per run and reused. */
function createUserResolver(token: string) {
  const cache = new Map<string, string>();

  return async function resolve(userId: string | undefined): Promise<string> {
    if (!userId) return "";
    const hit = cache.get(userId);
    if (hit !== undefined) return hit;

    try {
      const body = await slackApi<{ user?: { real_name?: string; name?: string } }>(
        token,
        "users.info",
        { user: userId }
      );
      const name = body.user?.real_name || body.user?.name || userId;
      cache.set(userId, name);
      return name;
    } catch {
      // A deactivated or inaccessible user must not fail the message itself.
      cache.set(userId, userId);
      return userId;
    }
  };
}

/** Slack `ts` is "1723473000.001200" — seconds with a microsecond suffix. */
export function tsToDate(ts: string): Date | null {
  const seconds = Number.parseFloat(ts);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000);
}

/**
 * Is there anything here worth embedding?
 *
 * Join/leave notices and topic changes are `subtype`d events carrying no
 * knowledge, and bot posts are usually automation echoing itself. Indexing them
 * buries real discussion under noise at retrieval time.
 */
export function isWorthIngesting(msg: SlackMsg): boolean {
  if (msg.subtype) return false;
  if (msg.bot_id) return false;
  return Boolean(msg.text && msg.text.trim().length > 1);
}

/** A thread's replies, minus the parent (already stored in its own right). */
async function fetchReplies(
  token: string,
  channelId: string,
  threadTs: string
): Promise<SlackMsg[]> {
  try {
    const body = await slackApi<{ messages: SlackMsg[] }>(token, "conversations.replies", {
      channel: channelId,
      ts: threadTs,
      limit: PAGE_SIZE,
    });
    return (body.messages ?? []).filter((m) => m.ts !== threadTs);
  } catch (err) {
    console.error(`[sync/slack] replies failed for ${channelId}/${threadTs}:`, err);
    return [];
  }
}

export async function syncSlackConnection(
  connection: SlackConnectionLike,
  opts: { since?: Date | null } = {}
): Promise<SyncResult> {
  const token = connection.accessToken;
  const resolveUser = createUserResolver(token);

  // A small overlap is safer than a gap: the unique key makes a re-read an
  // idempotent upsert, whereas a missed window is lost silently.
  const oldest = opts.since ? (opts.since.getTime() / 1000).toFixed(6) : undefined;

  const channels = await listReadableChannels(token);
  let synced = 0;
  let skipped = 0;

  for (const channel of channels) {
    let history: SlackMsg[];
    try {
      const body = await slackApi<{ messages: SlackMsg[] }>(token, "conversations.history", {
        channel: channel.id,
        limit: PAGE_SIZE,
        oldest,
      });
      history = body.messages ?? [];
    } catch (err) {
      // One unreadable channel must not end the run.
      console.error(`[sync/slack] history failed for ${channel.id}:`, err);
      skipped++;
      continue;
    }

    // Parents plus their replies, so an answer is never orphaned from its question.
    const messages: SlackMsg[] = [];
    for (const msg of history) {
      messages.push(msg);
      if (msg.reply_count && msg.reply_count > 0) {
        await sleep(RATE_LIMIT_MS);
        messages.push(...(await fetchReplies(token, channel.id, msg.ts)));
      }
    }

    for (const msg of messages) {
      if (!isWorthIngesting(msg)) continue;

      try {
        const authorName = await resolveUser(msg.user);
        const postedAt = tsToDate(msg.ts);
        const text = msg.text ?? "";

        const stored = await prisma.slackMessage.upsert({
          where: {
            slackConnectionId_channelId_messageTs: {
              slackConnectionId: connection.id,
              channelId: channel.id,
              messageTs: msg.ts,
            },
          },
          create: {
            slackConnectionId: connection.id,
            userId: connection.userId,
            messageTs: msg.ts,
            channelId: channel.id,
            channelName: channel.name ?? null,
            threadTs: msg.thread_ts ?? null,
            authorId: msg.user ?? null,
            authorName,
            text,
            postedAt,
          },
          update: {
            text,
            authorName,
            channelName: channel.name ?? null,
            status: "PENDING", // edited — must be re-embedded
          },
        });

        await redis.lpush(
          QUEUE_KEY,
          JSON.stringify({
            raw_document_id: stored.id,
            source: "slack",
            external_id: `${channel.id}:${msg.ts}`,
            author: authorName,
            // Slack has no subject line, and the channel is the closest thing
            // to one — it is what makes a retrieved snippet locatable.
            subject: channel.name ? `#${channel.name}` : "Slack message",
            content: text,
            timestamp: postedAt?.toISOString() ?? new Date().toISOString(),
            metadata: {
              channel_id: channel.id,
              channel_name: channel.name ?? null,
              thread_ts: msg.thread_ts ?? null,
              is_reply: Boolean(msg.thread_ts && msg.thread_ts !== msg.ts),
            },
            connector_id: connection.id,
            namespace: `${connection.userId}:slack`, // RBAC boundary
          })
        );

        synced++;
      } catch (err) {
        console.error(`[sync/slack] failed to store ${channel.id}/${msg.ts}:`, err);
        skipped++;
      }
    }

    await sleep(RATE_LIMIT_MS);
  }

  return { source: "slack", itemCount: synced, skipped, incremental: Boolean(oldest) };
}

import { NextRequest, NextResponse } from "next/server";
import { runDueSyncs } from "@/lib/connector/sync/runner";
import { isSyncSource, type SyncSource } from "@/lib/connector/sync/policy";

export const runtime = "nodejs";
// Never cached or statically analysed — this has side effects.
export const dynamic = "force-dynamic";
// 60s is the Vercel Hobby ceiling (Pro allows 300). The schedule is driven
// from outside Vercel — Hobby crons only fire once a day, which is useless for
// a 5-minute sync — so this endpoint must finish its work inside one minute and
// leave the rest for the next poke. See docs/DEPLOYMENT.md.
export const maxDuration = 60;

/**
 * POST /api/cron/sync — refresh every connector whose interval has elapsed.
 *
 * This is the scheduler's single entry point. It is deliberately dumb to call:
 * poke it often (every ~5 min) and the runner decides what is actually due
 * (Gmail every 5 min, Notion/Slack/Drive every 3 h — see
 * lib/connector/sync/policy.ts). Concurrent pokes are safe: each connection is
 * locked in the DB before it runs.
 *
 * Triggered by:
 *   - local/self-hosted → Celery Beat POSTs here (backend/python/workers/scheduler.py)
 *   - production        → Vercel Cron GETs here (see vercel.json), sending
 *                         `Authorization: Bearer $CRON_SECRET` automatically.
 * Both verbs run the same handler; GET exists purely because platform crons
 * issue GETs.
 *
 * Auth: Bearer CRON_SECRET. This is machine-to-machine — there is no user
 * session — so it must never rely on cookies. Without CRON_SECRET set, the
 * route refuses to run rather than sitting open to the internet.
 *
 * Body (optional, POST only): { "sources": ["gmail"] } to target specific sources.
 */
export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/sync] refused: CRON_SECRET is not configured");
    return NextResponse.json(
      { error: "Scheduler is not configured (missing CRON_SECRET)" },
      { status: 503 }
    );
  }

  // Accept the standard Bearer header; Vercel Cron sends the same.
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!timingSafeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let only: SyncSource[] | undefined;
  try {
    const body = await req.json().catch(() => null);
    if (body?.sources && Array.isArray(body.sources)) {
      const requested: string[] = body.sources.filter(
        (s: unknown): s is string => typeof s === "string"
      );
      const invalid = requested.filter((s: string) => !isSyncSource(s));
      if (invalid.length) {
        return NextResponse.json(
          { error: `Unknown source(s): ${invalid.join(", ")}` },
          { status: 400 }
        );
      }
      only = requested.filter(isSyncSource);
    }
  } catch {
    /* no body — sync everything that's due */
  }

  try {
    const summary = await runDueSyncs({ only });
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync run failed";
    console.error("[cron/sync] run failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Constant-time compare so the secret can't be discovered byte-by-byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

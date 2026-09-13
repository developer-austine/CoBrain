import { NextRequest, NextResponse } from "next/server";
import { runPendingExtractions } from "@/lib/brain/extractionRunner";

export const runtime = "nodejs";
// Never cached or statically analysed — this has side effects.
export const dynamic = "force-dynamic";
// 60s is the Vercel Hobby ceiling (Pro allows 300). The schedule is driven
// from outside Vercel — Hobby crons only fire once a day, which is useless for
// a 5-minute sync — so this endpoint must finish its work inside one minute and
// leave the rest for the next poke. See docs/DEPLOYMENT.md.
export const maxDuration = 60;

/**
 * POST /api/cron/extract — read any uploaded source the brain never got to.
 *
 * The upload route already fires extraction itself, so on a healthy system this
 * finds nothing. It exists for the cases where that in-request read never
 * finished: the process was redeployed mid-file, the LLM was rate-limited, the
 * API key was missing at the time, MinIO was restarting. Without it, a document
 * that failed once is simply never read again, and the failure is invisible —
 * the file still uploaded, still searchable, just quietly not learned from.
 *
 * Same contract as /api/cron/sync: poke it often, it decides what is due, and
 * concurrent pokes are safe because each source is locked before it runs.
 *
 * Auth: Bearer CRON_SECRET — machine-to-machine, never cookies. Without the
 * secret configured the route refuses rather than sitting open.
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
    console.error("[cron/extract] refused: CRON_SECRET is not configured");
    return NextResponse.json(
      { error: "Scheduler is not configured (missing CRON_SECRET)" },
      { status: 503 }
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!timingSafeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runPendingExtractions();
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction run failed";
    console.error("[cron/extract] run failed:", err);
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

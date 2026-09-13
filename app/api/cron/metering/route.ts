import { NextRequest, NextResponse } from "next/server";
import {
  expireUnusedCredits,
  grantPlanAllowance,
  marginReport,
  meterActiveForecasts,
  reconcileBalances,
} from "@/lib/metering/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/cron/metering — run the metering module's scheduled jobs.
 *
 * Same contract as /api/cron/sync: dumb to call, safe to call often, and
 * machine-to-machine only. Every job it runs is idempotent by construction, so
 * a double poke, a retried delivery, or two schedulers pointed at the same
 * deployment cannot double-grant an allowance or double-charge a target.
 *
 * Auth: Bearer CRON_SECRET. No cookies — there is no user here. Without the
 * secret configured the route refuses rather than sitting open.
 *
 * Body (optional): { "jobs": ["reconcile"] } to run a subset.
 *   reconcile  nightly — rebuild balances from the ledger, alarm on drift
 *   allowance  on rollover — grant each tenant its plan allowance
 *   expiry     on rollover — expire unused credits where they do not roll over
 *   forecasts  monthly — one charge per active forecast target
 *   margin     weekly — the internal margin report
 *
 * Cadence is the scheduler's business, not this route's: it runs what it is
 * asked and each job decides whether there is anything to do.
 */

const JOBS = {
  reconcile: reconcileBalances,
  allowance: () => grantPlanAllowance(),
  expiry: () => expireUnusedCredits(),
  forecasts: () => meterActiveForecasts(),
  margin: () => marginReport(),
} as const;

type JobName = keyof typeof JOBS;

const isJobName = (value: string): value is JobName => Object.hasOwn(JOBS, value);

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/metering] refused: CRON_SECRET is not configured");
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

  let requested: JobName[] = ["reconcile"];
  try {
    const body = await req.json().catch(() => null);
    if (body?.jobs && Array.isArray(body.jobs)) {
      const names: string[] = body.jobs.filter((j: unknown): j is string => typeof j === "string");
      const invalid = names.filter((j) => !isJobName(j));
      if (invalid.length) {
        return NextResponse.json(
          { error: `Unknown job(s): ${invalid.join(", ")}` },
          { status: 400 }
        );
      }
      requested = names.filter(isJobName);
    }
  } catch {
    /* no body — run the nightly default */
  }

  const results: Record<string, unknown> = {};
  for (const job of requested) {
    try {
      results[job] = await JOBS[job]();
    } catch (err) {
      // One failing job must not abandon the rest: the allowance grant is far
      // more urgent than the margin report that happened to be listed first.
      console.error(`[cron/metering] ${job} failed:`, err);
      results[job] = { error: err instanceof Error ? err.message : "failed" };
    }
  }

  return NextResponse.json({ success: true, results });
}

/** Constant-time compare so the secret can't be discovered byte-by-byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { config } from "@/lib/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness + dependency readiness.
 *
 * Used by the container HEALTHCHECK and any upstream load balancer. Reports
 * each dependency separately so a failing deploy tells you *which* one is
 * down, and returns 503 when a hard dependency (Postgres) is unreachable.
 */
export async function GET() {
  const checks: Record<string, "ok" | "down"> = {};

  // Postgres — hard dependency. Nothing works without it.
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "down";
  }

  // Search API — soft: chat degrades, the rest of the app still runs.
  try {
    const r = await fetch(`${config.pythonBackendUrl}/docs`, {
      signal: AbortSignal.timeout(3000),
    });
    checks.search = r.ok ? "ok" : "down";
  } catch {
    checks.search = "down";
  }

  const healthy = checks.database === "ok";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      env: config.env,
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  );
}

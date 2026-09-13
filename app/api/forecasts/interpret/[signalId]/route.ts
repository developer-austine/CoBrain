import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/prisma";
import { getCurrentUserId } from "@/lib/get-session";
import { FORECAST_TARGETS, type ForecastTargetKey } from "@/lib/forecast/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/forecasts/interpret/{signalId} — the extras the drawer needs (spec §7.4).
 *
 * Only what the client cannot already compute. Momentum is deliberately NOT
 * served: it is a first difference of the observed series the page already
 * holds, and a second copy computed server-side is a second thing that can
 * disagree with the chart.
 *
 * The narrative itself is never served. It is a pure function of the payload
 * and computing it here would create exactly the drift this layer exists to
 * prevent — the words arriving from one place and the numbers from another.
 */

const CACHE_SECONDS = 60;
/** Matches DriftReport.coverage12w — the window the monitor scores over. */
const CALIBRATION_WINDOW_WEEKS = 12;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ signalId: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { signalId } = await params;
  if (!(FORECAST_TARGETS as readonly string[]).includes(signalId)) {
    return NextResponse.json({ error: "Unknown signal" }, { status: 404 });
  }

  try {
    const payload = await withTenant(userId, async () => {
      // The monitor writes one row per target per week; the newest is the
      // current verdict on this signal.
      const latest = await prisma.driftReport.findFirst({
        where: { userId, target: signalId },
        orderBy: { week: "desc" },
        select: { coverage12w: true, status: true, week: true },
      });

      // Recent weeks, oldest first, for the track-record cells. A row with no
      // coverage score is skipped rather than drawn as a miss — "not yet
      // scored" and "missed" are different facts.
      const history = await prisma.driftReport.findMany({
        where: { userId, target: signalId, coverage12w: { not: null } },
        orderBy: { week: "desc" },
        take: CALIBRATION_WINDOW_WEEKS,
        select: { coverage12w: true, week: true },
      });

      return {
        calibration:
          latest?.coverage12w != null
            ? { coverage: latest.coverage12w, window: CALIBRATION_WINDOW_WEEKS }
            : null,
        driftAlarm: latest?.status === "alarm",
        driftStatus: latest?.status ?? null,
        // Each week counts as a hit when that week's rolling coverage held at
        // or above the nominal 80% band the P10–P90 interval promises.
        hits: history
          .slice()
          .reverse()
          .map((r) => (r.coverage12w ?? 0) >= 0.8),
      };
    });

    return NextResponse.json(payload, {
      headers: { "Cache-Control": `private, max-age=${CACHE_SECONDS}` },
    });
  } catch (err) {
    console.error(`[forecasts/interpret] failed for ${signalId}:`, err);
    // The drawer degrades to its client-side sections rather than failing: a
    // missing accuracy tile is a smaller loss than an empty panel.
    return NextResponse.json(
      { calibration: null, driftAlarm: false, driftStatus: null, hits: [] },
      { status: 200 }
    );
  }
}

export type InterpretExtras = {
  calibration: { coverage: number; window: number } | null;
  driftAlarm: boolean;
  driftStatus: string | null;
  hits: boolean[];
};

export type { ForecastTargetKey };

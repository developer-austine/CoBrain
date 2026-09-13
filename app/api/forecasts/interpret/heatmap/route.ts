import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/get-session";
import { withTenant } from "@/lib/tenant/prisma";
import { afterHoursHeatmap } from "@/lib/forecasts/heatmap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/forecasts/interpret/heatmap?signal=burnout_risk&tz=-60
 *
 * Burnout only, per spec §7.3g: after-hours concentration is what that signal
 * measures, and the same grid against delivery velocity would be a chart with
 * no claim attached.
 *
 * `tz` is the viewer's offset in minutes east of UTC. It is required rather
 * than defaulted: silently assuming UTC would move every team's evening by
 * their real offset and quietly report the wrong hotspot — a plausible-looking
 * answer is worse here than an error.
 */

const CACHE_SECONDS = 60;
const SUPPORTED_SIGNAL = "burnout_risk";
/** UTC-14 .. UTC+14, the real range of civil offsets. */
const MAX_OFFSET_MINUTES = 14 * 60;

export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  if (searchParams.get("signal") !== SUPPORTED_SIGNAL) {
    return NextResponse.json(
      { error: `Heatmap is only defined for ${SUPPORTED_SIGNAL}` },
      { status: 404 }
    );
  }

  const tzRaw = searchParams.get("tz");
  const tz = Number(tzRaw);
  if (tzRaw === null || !Number.isFinite(tz) || Math.abs(tz) > MAX_OFFSET_MINUTES) {
    return NextResponse.json(
      { error: "tz (minutes east of UTC) is required" },
      { status: 400 }
    );
  }

  try {
    const heatmap = await withTenant(userId, () =>
      afterHoursHeatmap(userId, Math.round(tz))
    );
    return NextResponse.json(heatmap, {
      headers: { "Cache-Control": `private, max-age=${CACHE_SECONDS}` },
    });
  } catch (err) {
    console.error("[forecasts/interpret/heatmap] failed:", err);
    // The drawer hides the section rather than showing an empty grid, which
    // would read as "no late work" instead of "we could not measure it".
    return NextResponse.json({ error: "Could not build the heatmap" }, { status: 500 });
  }
}

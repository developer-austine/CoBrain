import "server-only";
import { Prisma } from "@/lib/generated/prisma/client";
import prisma from "@/lib/prisma";

/**
 * After-hours activity heatmap (spec §7.3g).
 *
 * Computed from RAW EVENT TIMESTAMPS, not from the weekly model. The forecast
 * says after-hours pressure is rising; this says *when* — and it has to come
 * from the events themselves, because the model only ever sees one number per
 * week.
 *
 * Two things make or break this query, and both are silent when wrong:
 *
 *  1. **Never `syncedAt`.** It is the time WE fetched a row, and syncing runs
 *     on a cron cadence — every 5 minutes for Gmail, every 3 hours for the
 *     rest. Grouping by it manufactures a perfect "hotspot" at whatever hour
 *     the scheduler happens to run, which looks exactly like a real finding.
 *     Only columns recording when a human actually did something are unioned
 *     here.
 *  2. **Timezone.** "After hours" is 6pm *where the team sits*, and Postgres
 *     stores UTC. A team at UTC+3 working at 19:00 local is 16:00 UTC — inside
 *     business hours, so an unshifted query reports no late work at all. There
 *     is no tenant timezone on record, so the caller passes the viewer's own
 *     offset and the shift happens in SQL.
 */

/** Trailing window, per the spec. */
export const HEATMAP_WEEKS = 8;

/** Evening bands. Anything before 18:00 on a weekday is not after-hours. */
export const BANDS = [
  { key: "18-21", label: "6–9pm", from: 18, to: 21 },
  { key: "21-24", label: "9pm–12am", from: 21, to: 24 },
] as const;

/**
 * Columns. Saturday and Sunday are collapsed into one because weekend work is
 * the same finding either day, and two near-empty columns make the weekday
 * pattern harder to read.
 */
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat–Sun"] as const;

export type Heatmap = {
  /** cells[band][day] — counts, band-major to match the render order. */
  cells: number[][];
  days: readonly string[];
  bands: readonly string[];
  total: number;
  /** Busiest cell, or null when there is no after-hours activity at all. */
  hotspot: { day: string; band: string; count: number } | null;
  weeks: number;
  /** Minutes east of UTC the counts were shifted by. */
  utcOffsetMinutes: number;
};

type Row = { dow: number; hour: number; n: bigint | number };

/**
 * Bucket raw (day-of-week, hour) counts into the grid.
 *
 * Split out from the query so the bucketing — where the off-by-one lives — is
 * testable without a database. Postgres `EXTRACT(DOW)` is 0=Sunday..6=Saturday.
 */
export function bucketRows(rows: Row[], utcOffsetMinutes: number): Heatmap {
  const cells: number[][] = BANDS.map(() => DAYS.map(() => 0));
  let total = 0;

  for (const row of rows) {
    const count = Number(row.n);
    if (!Number.isFinite(count) || count <= 0) continue;

    const bandIndex = BANDS.findIndex((b) => row.hour >= b.from && row.hour < b.to);
    // Weekend hours outside the evening bands still count as weekend work; on a
    // weekday, only the evening bands are "after hours".
    const isWeekend = row.dow === 0 || row.dow === 6;
    if (bandIndex === -1 && !isWeekend) continue;

    const dayIndex = isWeekend ? DAYS.length - 1 : row.dow - 1; // Mon(1) -> 0
    if (dayIndex < 0 || dayIndex >= DAYS.length) continue;

    // Weekend activity outside the evening bands is attributed to the earlier
    // band rather than dropped: it is still weekend work, and the grid has no
    // daytime row to put it in.
    const band = bandIndex === -1 ? 0 : bandIndex;

    cells[band][dayIndex] += count;
    total += count;
  }

  let hotspot: Heatmap["hotspot"] = null;
  for (let b = 0; b < cells.length; b++) {
    for (let d = 0; d < cells[b].length; d++) {
      if (cells[b][d] > (hotspot?.count ?? 0)) {
        hotspot = { day: DAYS[d], band: BANDS[b].label, count: cells[b][d] };
      }
    }
  }

  return {
    cells,
    days: DAYS,
    bands: BANDS.map((b) => b.label),
    total,
    hotspot,
    weeks: HEATMAP_WEEKS,
    utcOffsetMinutes,
  };
}

/**
 * Read the trailing window's after-hours activity for one tenant.
 *
 * `utcOffsetMinutes` is minutes EAST of UTC (so UTC+3 is +180), matching the
 * sign convention of `-new Date().getTimezoneOffset()`.
 */
export async function afterHoursHeatmap(
  userId: string,
  utcOffsetMinutes: number
): Promise<Heatmap> {
  const since = new Date(Date.now() - HEATMAP_WEEKS * 7 * 24 * 60 * 60 * 1000);

  // Every branch selects a column recording when a person acted. NotionPage
  // keeps its edit time as an ISO string, so it is guarded by shape before the
  // cast — one malformed row would otherwise fail the whole query.
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    WITH events AS (
      SELECT "createdAt" AS ts
        FROM "GitHubItem"
       WHERE "userId" = ${userId} AND "createdAt" IS NOT NULL AND "createdAt" >= ${since}
      UNION ALL
      SELECT "date" AS ts
        FROM "Email"
       WHERE "userId" = ${userId} AND "date" IS NOT NULL AND "date" >= ${since}
      UNION ALL
      SELECT "postedAt" AS ts
        FROM "SlackMessage"
       WHERE "userId" = ${userId} AND "postedAt" IS NOT NULL AND "postedAt" >= ${since}
      UNION ALL
      SELECT "notionEditedTime"::timestamptz AS ts
        FROM "NotionPage"
       WHERE "userId" = ${userId}
         AND "notionEditedTime" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
         AND "notionEditedTime"::timestamptz >= ${since}
    ),
    local AS (
      SELECT ts + make_interval(mins => ${utcOffsetMinutes}) AS lts FROM events
    )
    SELECT
      EXTRACT(DOW  FROM lts)::int AS dow,
      EXTRACT(HOUR FROM lts)::int AS hour,
      COUNT(*)                    AS n
    FROM local
    GROUP BY 1, 2
  `);

  return bucketRows(rows, utcOffsetMinutes);
}

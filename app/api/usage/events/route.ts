import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/get-session";
import { withTenant } from "@/lib/tenant/prisma";
import { receipts } from "@/lib/metering/summary";
import { isMeteredFeature } from "@/lib/metering/pricebook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/usage/events?cursor=&feature=&from=&to=&format=csv
 *
 * The raw ledger — the receipt. This is the dispute-resolution surface, so
 * every row is returned with its id and nothing is aggregated or rounded away
 * from what the ledger actually holds.
 *
 * `format=csv` streams the same rows as a download. It deliberately shares one
 * query with the JSON path: an export that disagreed with the table above it
 * would be worse than no export at all.
 */
export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const feature = searchParams.get("feature") ?? undefined;
  if (feature && !isMeteredFeature(feature)) {
    return NextResponse.json({ error: `Unknown feature: ${feature}` }, { status: 400 });
  }

  const wantsCsv = searchParams.get("format") === "csv";

  try {
    const page = await withTenant(userId, () =>
      receipts(userId, {
        feature,
        actorUserId: searchParams.get("user") ?? undefined,
        from: parseDate(searchParams.get("from")),
        to: parseDate(searchParams.get("to")),
        cursor: searchParams.get("cursor") ?? undefined,
        // An export wants the whole period, not a screenful.
        limit: wantsCsv ? 200 : 50,
      })
    );

    if (!wantsCsv) return NextResponse.json(page);

    return new NextResponse(toCsv(page.rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="usage-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    console.error("[usage/events] failed:", err);
    return NextResponse.json({ error: "Could not load usage events." }, { status: 500 });
  }
}

/**
 * RFC 4180 quoting. Every field is quoted rather than only the ones that need
 * it: a feature name is safe today, and a note field added later will not be.
 */
function toCsv(rows: Awaited<ReturnType<typeof receipts>>["rows"]): string {
  const header = ["id", "occurred_at", "feature", "quantity", "unit", "credits", "actor"];
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

  const lines = rows.map((row) =>
    [
      row.id,
      row.occurredAt,
      row.label,
      row.quantity,
      row.quantityLabel,
      row.credits,
      row.actorUserId ?? "system",
    ]
      .map(escape)
      .join(",")
  );

  return [header.map(escape).join(","), ...lines].join("\r\n");
}

function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

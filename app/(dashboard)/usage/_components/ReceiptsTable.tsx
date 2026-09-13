"use client";

import React, { useCallback, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { PRICE_BOOK } from "@/lib/metering/pricebook";
import { Card, SectionTitle, formatCredits, formatDateTime } from "./primitives";

/**
 * Receipts (§8f).
 *
 * The dispute-resolution surface. Every row here is one ledger row, unrounded
 * and unaggregated, because the question this table answers is "what exactly
 * was I charged for" and any summarising defeats it.
 *
 * The CSV export hits the same endpoint with format=csv rather than serialising
 * what is on screen: an export that showed a different set of rows than the
 * table above it would be worse than no export.
 */

export type ReceiptRow = {
  id: string;
  occurredAt: string;
  feature: string;
  label: string;
  quantity: number;
  quantityLabel: string;
  credits: number;
  actorUserId: string | null;
};

export function ReceiptsTable({
  initial,
  window,
}: {
  initial: { rows: ReceiptRow[]; nextCursor: string | null };
  window: { from: string; to: string };
}) {
  const [rows, setRows] = useState(initial.rows);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [feature, setFeature] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const query = useCallback(
    (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams({ from: window.from, to: window.to, ...extra });
      if (feature) params.set("feature", feature);
      return params.toString();
    },
    [window, feature]
  );

  const applyFilter = useCallback(
    async (nextFeature: string) => {
      setFeature(nextFeature);
      setLoading(true);
      try {
        const params = new URLSearchParams({ from: window.from, to: window.to });
        if (nextFeature) params.set("feature", nextFeature);
        const res = await fetch(`/api/usage/events?${params}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const page = await res.json();
        setRows(page.rows);
        setCursor(page.nextCursor);
      } catch {
        toast.error("Could not filter the receipts.");
      } finally {
        setLoading(false);
      }
    },
    [window]
  );

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/usage/events?${query({ cursor })}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const page = await res.json();
      // Appended, not replaced: a receipts table that reset its scroll on every
      // page would be unusable for the dispute it exists to settle.
      setRows((prev) => [...prev, ...page.rows]);
      setCursor(page.nextCursor);
    } catch {
      toast.error("Could not load more receipts.");
    } finally {
      setLoading(false);
    }
  }, [cursor, query]);

  return (
    <Card className="p-4">
      <SectionTitle
        right={
          <div className="flex items-center gap-2">
            <select
              value={feature}
              onChange={(e) => applyFilter(e.target.value)}
              className="rounded-lg px-2 py-1 text-[11px]"
              style={{
                background: "var(--bg-inset)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              <option value="">All features</option>
              {Object.entries(PRICE_BOOK).map(([key, entry]) => (
                <option key={key} value={key}>
                  {entry.displayName}
                </option>
              ))}
            </select>
            <a
              href={`/api/usage/events?${query({ format: "csv" })}`}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              <Download className="h-3 w-3" />
              Export CSV
            </a>
          </div>
        }
      >
        Receipts
      </SectionTitle>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-[12.5px]" style={{ color: "var(--text-muted)" }}>
          No metered activity in this period.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr>
                {["When", "Feature", "Quantity", "Credits", "Who"].map((h) => (
                  <th
                    key={h}
                    className="pb-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td
                    className="font-data tnum py-2 pr-3 text-[11.5px] whitespace-nowrap"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {formatDateTime(row.occurredAt)}
                  </td>
                  <td className="py-2 pr-3 text-[12.5px]" style={{ color: "var(--text-primary)" }}>
                    {row.label}
                  </td>
                  <td
                    className="font-data tnum py-2 pr-3 text-[11.5px]"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {row.quantityLabel}
                  </td>
                  <td
                    className="font-data tnum py-2 pr-3 text-[12.5px] font-semibold"
                    style={{
                      // A correction is a negative row; showing it in the
                      // improving colour is how a refund reads as good news.
                      color: row.credits < 0 ? "var(--teal)" : "var(--text-primary)",
                    }}
                  >
                    {formatCredits(row.credits)}
                  </td>
                  <td className="py-2 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                    {row.actorUserId ? (
                      <span className="font-data">…{row.actorUserId.slice(-8)}</span>
                    ) : (
                      "system"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="mt-3 flex h-8 w-full items-center justify-center gap-2 rounded-lg text-[12px] font-medium"
          style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Load more
        </button>
      )}
    </Card>
  );
}

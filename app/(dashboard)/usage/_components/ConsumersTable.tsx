"use client";

import React from "react";
import { Card, SectionTitle, formatCredits } from "./primitives";

/**
 * Top consumers (§8e). ADMIN ONLY.
 *
 * This is per-person activity data about colleagues, so the server does not
 * send it to a non-admin at all — this component simply is not rendered for
 * them, and /api/usage/breakdown?by=user answers 403 rather than returning an
 * empty list. Hiding it client-side would leave the data in the page source.
 */

export type ConsumerRow = {
  userId: string;
  credits: number;
  share: number;
  topFeature: string | null;
};

export function ConsumersTable({ rows, more }: { rows: ConsumerRow[]; more: number }) {
  if (rows.length === 0) return null;

  return (
    <Card className="p-4">
      <SectionTitle
        right={
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            Admins only
          </span>
        }
      >
        Top consumers
      </SectionTitle>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse">
          <thead>
            <tr>
              {["Person", "Credits", "Share", "Top feature"].map((h) => (
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
              <tr key={row.userId} style={{ borderTop: "1px solid var(--border)" }}>
                <td
                  className="py-2 pr-3 text-[12.5px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  {/* Better Auth ids are opaque and long; the tail is enough to
                      tell two people apart without a cross-database lookup. */}
                  <span className="font-data">…{row.userId.slice(-8)}</span>
                </td>
                <td
                  className="font-data tnum py-2 pr-3 text-[12.5px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  {formatCredits(row.credits)}
                </td>
                <td className="w-[38%] py-2 pr-3">
                  <span
                    className="flex h-1.5 w-full overflow-hidden rounded-[3px]"
                    style={{ background: "var(--bar-track)" }}
                  >
                    <span
                      className="h-full rounded-[3px]"
                      style={{
                        width: `${Math.max(2, row.share * 100)}%`,
                        background: "var(--accent)",
                      }}
                    />
                  </span>
                </td>
                <td className="py-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
                  {row.topFeature ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {more > 0 && (
        <p className="mt-2 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
          {more} more {more === 1 ? "person" : "people"} used credits this period.
        </p>
      )}
    </Card>
  );
}

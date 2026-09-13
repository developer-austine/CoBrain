"use client";

import React from "react";

/**
 * Shared chrome for the Usage page.
 *
 * Same card treatment as the forecasts page rather than a second one: two
 * dashboard surfaces that draw their cards differently read as two products.
 */

export function Card({
  children,
  className = "",
  style,
}: React.PropsWithChildren<{ className?: string; style?: React.CSSProperties }>) {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        boxShadow: "var(--card-shadow)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The small uppercase label every section carries. */
export function SectionTitle({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
      <p
        className="text-[10px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: "var(--text-muted)" }}
      >
        {children}
      </p>
      {right}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="p-8 text-center">
      <p className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </p>
      <p
        className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed"
        style={{ color: "var(--text-secondary)" }}
      >
        {body}
      </p>
    </Card>
  );
}

/**
 * Credits, formatted.
 *
 * Whole numbers when they are whole — "412 credits" not "412.00 credits" —
 * because the trailing zeros read as false precision on a number the customer
 * is being asked to trust.
 */
export function formatCredits(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString()
    : rounded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Status colour for the projection, shared by the hero and the banners. */
export function stateColor(state: "on_track" | "near" | "over"): string {
  if (state === "over") return "var(--coral)";
  if (state === "near") return "var(--amber)";
  return "var(--teal)";
}

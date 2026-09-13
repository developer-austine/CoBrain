"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { PRICE_BOOK } from "@/lib/metering/pricebook";
import { Card, SectionTitle, formatCredits } from "./primitives";

/**
 * Plan & caps (§8g). ADMIN ONLY.
 *
 * The panel is collapsed by default and opens from the hero's "Set a cap"
 * button. Spend controls are consulted rarely and changed rarely; giving them
 * permanent real estate at the bottom of the page would push the receipts —
 * which people actually come for — below the fold.
 *
 * Every value here is also enforced server-side in /api/usage/caps. This form
 * is a convenience, not the control.
 */

export type CapsState = {
  plan: string;
  includedCredits: number;
  hardCapCredits: number | null;
  featureCaps: Record<string, number>;
  alertThresholds: number[];
  overageAllowed: boolean;
};

export function PlanAndCaps({
  caps,
  open,
  onOpenChange,
}: {
  caps: CapsState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [hardCap, setHardCap] = useState(
    caps.hardCapCredits === null ? "" : String(caps.hardCapCredits)
  );
  const [overage, setOverage] = useState(caps.overageAllowed);
  const [thresholds, setThresholds] = useState(caps.alertThresholds.join(", "));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const trimmed = hardCap.trim();
    const parsedCap = trimmed === "" ? null : Number(trimmed);
    if (parsedCap !== null && (!Number.isFinite(parsedCap) || parsedCap < 0)) {
      toast.error("The cap must be a positive number of credits, or blank for no cap.");
      return;
    }

    const parsedThresholds = thresholds
      .split(",")
      .map((t) => Number(t.trim()))
      .filter((t) => Number.isInteger(t) && t >= 1 && t <= 100);
    if (thresholds.trim() !== "" && parsedThresholds.length === 0) {
      toast.error("Alert thresholds must be whole percentages between 1 and 100.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/usage/caps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hardCapCredits: parsedCap,
          overageAllowed: overage,
          ...(parsedThresholds.length ? { alertThresholds: parsedThresholds } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      toast.success("Spend controls updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center justify-between gap-2"
      >
        <SectionTitle>Plan &amp; caps</SectionTitle>
        <ChevronDown
          size={15}
          className="transition-transform duration-200"
          style={{
            color: "var(--text-muted)",
            transform: open ? "rotate(180deg)" : undefined,
          }}
        />
      </button>

      {/* Plan facts stay visible collapsed — they are read far more often than
          they are changed. */}
      <div
        className="font-data tnum flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]"
        style={{ color: "var(--text-muted)" }}
      >
        <span>
          Plan <strong style={{ color: "var(--text-primary)" }}>{caps.plan}</strong>
        </span>
        <span>
          Included{" "}
          <strong style={{ color: "var(--text-primary)" }}>
            {formatCredits(caps.includedCredits)} credits
          </strong>
        </span>
        <span>
          Cap{" "}
          <strong style={{ color: "var(--text-primary)" }}>
            {caps.hardCapCredits === null ? "none" : formatCredits(caps.hardCapCredits)}
          </strong>
        </span>
        <span>
          Overage{" "}
          <strong style={{ color: "var(--text-primary)" }}>
            {caps.overageAllowed ? "on" : "off"}
          </strong>
        </span>
      </div>

      {open && (
        <div className="mt-4 flex flex-col gap-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <Field
            label="Spending cap"
            hint="When the cap is reached, metered features pause. Chat, search, and forecasts keep working."
          >
            <input
              value={hardCap}
              onChange={(e) => setHardCap(e.target.value)}
              inputMode="decimal"
              placeholder="No cap"
              className="font-data tnum h-9 w-40 rounded-lg px-2.5 text-[12.5px]"
              style={{
                background: "var(--bg-inset)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
            />
          </Field>

          <Field
            label="Alert thresholds"
            hint="Percentages of the allowance at which admins are notified. Each fires once per period."
          >
            <input
              value={thresholds}
              onChange={(e) => setThresholds(e.target.value)}
              placeholder="75, 90"
              className="font-data tnum h-9 w-40 rounded-lg px-2.5 text-[12.5px]"
              style={{
                background: "var(--bg-inset)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
            />
          </Field>

          <Field
            label="Allow overage"
            hint="With overage off, metered features stop at a zero balance rather than running negative."
          >
            <button
              type="button"
              role="switch"
              aria-checked={overage}
              onClick={() => setOverage((v) => !v)}
              className="relative h-6 w-11 rounded-full transition-colors"
              style={{ background: overage ? "var(--accent)" : "var(--bar-track)" }}
            >
              <span
                className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
                style={{ transform: overage ? "translateX(22px)" : "translateX(2px)" }}
              />
            </button>
          </Field>

          {Object.keys(caps.featureCaps).length > 0 && (
            <Field
              label="Per-feature limits"
              hint="Set from the API. A limit of 0 means the feature is not included on this plan."
            >
              <ul className="flex flex-col gap-1">
                {Object.entries(caps.featureCaps).map(([feature, limit]) => (
                  <li
                    key={feature}
                    className="font-data tnum text-[11.5px]"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {PRICE_BOOK[feature as keyof typeof PRICE_BOOK]?.displayName ?? feature}
                    {" — "}
                    {limit === 0 ? "not included" : `${formatCredits(limit)} credits`}
                  </li>
                ))}
              </ul>
            </Field>
          )}

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex h-9 w-fit items-center gap-2 rounded-lg px-4 text-[12.5px] font-semibold text-white transition-all duration-150 hover:brightness-110 disabled:cursor-default"
            style={{ background: saved ? "var(--teal)" : "var(--accent)" }}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saved && <Check className="h-3.5 w-3.5" />}
            {saved ? "Saved" : "Save changes"}
          </button>
        </div>
      )}
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: React.PropsWithChildren<{ label: string; hint: string }>) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 max-w-[46ch]">
        <p className="text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>
          {label}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

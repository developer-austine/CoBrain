"use client";

import React, { useState } from "react";
import { Check } from "lucide-react";
import {
  DEFAULT_PLANS,
  priceForCycle,
  type BillingCycle,
  type PricingPlan,
} from "@/lib/pricing/plans";

type PricingSectionProps = {
  /** Plan catalog — defaults to the product's standard four tiers. */
  plans?: PricingPlan[];
  /** Called when a plan CTA is pressed. */
  onSelect: (plan: PricingPlan) => void;
  /** Plan name currently processing (disables its CTA). */
  busyPlan?: string | null;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
};

/**
 * Premium "ticket-cut" 4-tier pricing grid.
 *
 * Visual anchor: each card is a voucher — gold-gradient header, inward
 * circular cuts at the seam, dashed divider, clean feature list below.
 * Fully theme-token driven (bg-background/foreground), so the cut masks
 * always match the page canvas in both light and dark mode.
 */
export default function PricingSection({
  plans = DEFAULT_PLANS,
  onSelect,
  busyPlan = null,
  eyebrow = "Pricing",
  title = "Simple pricing, serious results",
  subtitle = "Start for free, upgrade when you're ready. Every plan includes unlimited access to core features — no credit card needed to begin.",
}: PricingSectionProps) {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const isYearly = cycle === "yearly";

  return (
    <section className="w-full bg-background text-foreground transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-6 text-center">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <span className="block mb-3 text-[0.8rem] font-bold tracking-[0.2em] uppercase text-muted-foreground/70">
          {eyebrow}
        </span>
        <h2 className="font-extrabold text-3xl md:text-5xl tracking-tight mb-4">{title}</h2>
        <p className="text-[0.95rem] md:text-[1.05rem] text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          {subtitle}
        </p>

        {/* ── Billing cycle toggle ────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-4 mb-14">
          <span
            className={`text-[0.92rem] font-medium transition-colors ${
              !isYearly ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            Monthly
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={isYearly}
            aria-label="Toggle yearly billing"
            onClick={() => setCycle(isYearly ? "monthly" : "yearly")}
            className="w-12 h-6 rounded-full bg-stone-200 dark:bg-stone-800 relative p-1 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <span
              className={`block w-4 h-4 rounded-full bg-stone-900 dark:bg-white transition-transform duration-200 ${
                isYearly ? "translate-x-6" : "translate-x-0"
              }`}
            />
          </button>
          <span
            className={`flex items-center gap-2 text-[0.92rem] font-medium transition-colors ${
              isYearly ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            Yearly
            <span className="bg-amber-400/20 text-amber-600 dark:text-amber-400 font-bold text-[0.7rem] px-2 py-0.5 rounded-full uppercase tracking-wider">
              Save 25%
            </span>
          </span>
        </div>

        {/* ── Ticket cards ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
          {plans.map((plan) => (
            <TicketCard
              key={plan.name}
              plan={plan}
              cycle={cycle}
              busy={busyPlan === plan.name}
              onSelect={() => onSelect(plan)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Page-canvas colored circle used to notch the voucher silhouette. */
function Notch({ className }: { className: string }) {
  return (
    <div
      aria-hidden
      className={`absolute w-6 h-6 rounded-full bg-background z-20 transition-colors duration-300 ${className}`}
    />
  );
}

const GOLD = "bg-gradient-to-br from-amber-300 via-amber-400 to-amber-500";

function TicketCard({
  plan,
  cycle,
  busy,
  onSelect,
}: {
  plan: PricingPlan;
  cycle: BillingCycle;
  busy: boolean;
  onSelect: () => void;
}) {
  const price = priceForCycle(plan.monthlyPrice, cycle);
  const popular = !!plan.isPopular;

  return (
    <div
      className={`relative w-full rounded-2xl overflow-hidden flex flex-col group transition-all duration-300 shadow-md hover:shadow-lg ${
        popular ? "shadow-lg" : ""
      }`}
    >
      {/* Scalloped corners — quarter circles clipped by overflow-hidden. */}
      <Notch className="left-[-12px] top-[-12px]" />
      <Notch className="right-[-12px] top-[-12px]" />
      <Notch className="left-[-12px] bottom-[-12px]" />
      <Notch className="right-[-12px] bottom-[-12px]" />

      {/* ── Top: gold voucher header ──────────────────────────────────────── */}
      <div
        className={`relative w-full ${GOLD} text-stone-950 p-6 text-left min-h-[200px] flex flex-col justify-between`}
      >
        <div>
          <div className="flex items-center justify-between mb-2 gap-2">
            <h3 className="font-extrabold text-[1.5rem] tracking-tight">{plan.name}</h3>
            {popular && (
              <span className="bg-white/90 text-stone-900 text-[0.65rem] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shadow-sm whitespace-nowrap">
                Most Popular
              </span>
            )}
          </div>
          <p className="text-[0.85rem] leading-snug text-stone-900/90 font-medium">
            {plan.desc}
          </p>
        </div>

        <div className="mt-4">
          <span className="font-extrabold text-[2.6rem] tracking-tight leading-none">
            {price}
          </span>
          <span className="text-[0.95rem] font-medium opacity-80">/ mo</span>
          {cycle === "yearly" && plan.monthlyPrice > 0 && (
            <span className="ml-2 text-[0.7rem] font-semibold uppercase tracking-wide opacity-70">
              billed yearly
            </span>
          )}
        </div>

        {/* Seam notches — the classic ticket punch at the divider. */}
        <Notch className="left-[-12px] bottom-[-12px]" />
        <Notch className="right-[-12px] bottom-[-12px]" />
      </div>

      {/* ── Seam: dashed divider running notch-to-notch ───────────────────── */}
      <div className={`relative w-full px-6 z-10 ${popular ? GOLD : "bg-white dark:bg-stone-950"}`}>
        <div
          className={`w-full border-t-2 border-dashed ${
            popular ? "border-stone-900/25" : "border-stone-300/70 dark:border-stone-700"
          }`}
        />
      </div>

      {/* ── Bottom: features + CTA (Pro stays fully gold) ─────────────────── */}
      <div
        className={`w-full p-6 pt-7 text-left flex-grow flex flex-col justify-between ${
          popular ? `${GOLD} text-stone-950` : "bg-white dark:bg-stone-950"
        }`}
      >
        <ul className="space-y-3.5 mb-8">
          {plan.features.map((feat) => (
            <li key={feat} className="flex items-start gap-2.5">
              <Check
                className={`mt-0.5 w-4 h-4 stroke-[3] shrink-0 ${
                  popular ? "text-stone-800" : "text-lime-600"
                }`}
              />
              <span
                className={`text-[0.88rem] font-medium leading-tight ${
                  popular ? "text-stone-900" : "text-stone-700 dark:text-stone-300"
                }`}
              >
                {feat}
              </span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          disabled={busy}
          onClick={onSelect}
          className={`w-fit mx-auto px-6 py-2.5 rounded-md font-bold text-[0.9rem] tracking-wide transition-all duration-200 active:scale-[0.99] shadow-sm disabled:opacity-60 disabled:cursor-wait ${
            popular
              ? "bg-white text-stone-900 hover:bg-stone-100"
              : `${GOLD} text-stone-900 hover:brightness-105`
          }`}
        >
          {busy ? "Opening…" : plan.ctaText}
        </button>
      </div>
    </div>
  );
}

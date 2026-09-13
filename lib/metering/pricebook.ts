/**
 * The price book — the one place a feature is mapped to money.
 *
 * Two tables, deliberately separate:
 *   PRICE_BOOK  what the CUSTOMER pays, in credits per human unit.
 *   COST_MODEL  what WE pay, in micro-USD per the same unit. Internal only.
 *
 * The decoupling is the whole point. Swapping a TTS vendor or moving a model to
 * a cheaper tier changes COST_MODEL and nothing else; the customer's bill does
 * not move because a provider's did. Fusing them would mean every infra change
 * is also a repricing, which is the thing customers do not forgive.
 *
 * Pure module — no DB, no React, no server-only import — so both the ledger
 * writer and the usage page can read it, and so the margin arithmetic is unit
 * testable without a database.
 *
 * TERMINOLOGY: the customer-facing unit is CREDITS. The word "tokens" must not
 * reach a customer-visible string. Provider token counts may be recorded in
 * UsageEvent.metadata for cost analysis; they are never displayed or returned.
 */

/** Native units. Prefix `k` means "per thousand", which is how these are sold. */
export type MeteredUnit =
  | "minute"
  | "kchar"
  | "kdoc"
  | "month"
  | "run"
  | "krequest";

export type PriceEntry = {
  unit: MeteredUnit;
  creditsPerUnit: number;
  /** Singular, lower case, for "412 credits · 412 meeting minutes". */
  displayUnit: string;
  /** Title case, for chart labels and table cells. */
  displayName: string;
};

export const PRICE_BOOK = {
  meeting_agent: {
    unit: "minute",
    creditsPerUnit: 1.0,
    displayUnit: "meeting minute",
    displayName: "Meeting agent",
  },
  voice_synthesis: {
    unit: "kchar",
    creditsPerUnit: 0.5,
    displayUnit: "1k characters",
    displayName: "Voice",
  },
  bulk_ingest: {
    unit: "kdoc",
    creditsPerUnit: 10.0,
    displayUnit: "1k documents",
    displayName: "Bulk ingest",
  },
  forecast_target: {
    unit: "month",
    creditsPerUnit: 50.0,
    displayUnit: "target/month",
    displayName: "Forecast targets",
  },
  model_retrain: {
    unit: "run",
    creditsPerUnit: 200.0,
    displayUnit: "retrain run",
    displayName: "Model retraining",
  },
  api_request: {
    unit: "krequest",
    creditsPerUnit: 2.0,
    displayUnit: "1k requests",
    displayName: "API access",
  },
} as const satisfies Record<string, PriceEntry>;

export type MeteredFeature = keyof typeof PRICE_BOOK;

export const METERED_FEATURES = Object.keys(PRICE_BOOK) as MeteredFeature[];

export function isMeteredFeature(value: string): value is MeteredFeature {
  return Object.hasOwn(PRICE_BOOK, value);
}

/**
 * Our real cost per native unit, in micro-USD (1e-6 USD).
 *
 * INTERNAL ONLY. Nothing here may appear in an API response, an invoice, or a
 * rendered page — it is our margin, and it is the input to Section 7's report.
 *
 * BigInt rather than float: these are summed over millions of ledger rows, and
 * float addition at that volume drifts in exactly the digits the margin alarm
 * is watching.
 *
 * STARTING VALUES. After 60 days of real ledger data run the margin report and
 * revise from measurement. Do not guess a second time.
 */
export const COST_MODEL: Record<MeteredFeature, { costMicrosPerUnit: bigint }> = {
  meeting_agent: { costMicrosPerUnit: BigInt(9_000) }, // bot infra + STT, per minute
  voice_synthesis: { costMicrosPerUnit: BigInt(2_400) }, // per 1k characters
  bulk_ingest: { costMicrosPerUnit: BigInt(40_000) }, // embeddings, per 1k documents
  forecast_target: { costMicrosPerUnit: BigInt(120_000) }, // per target-month
  model_retrain: { costMicrosPerUnit: BigInt(800_000) }, // GPU hours, per run
  api_request: { costMicrosPerUnit: BigInt(6_000) }, // per 1k requests
};

/**
 * What the UNMETERED features cost us, per event, for margin analysis only.
 *
 * The core loop — chat, search, viewing forecasts and the Brain — is included
 * in the subscription and is NEVER charged. It is not free to serve, though, so
 * the LLM wrapper still writes a zero-credit ledger row carrying its real cost.
 * Leaving those events out entirely would make every tenant look more
 * profitable than they are, which defeats the point of the report.
 */
export const UNMETERED_FEATURES = [
  "chat",
  "search",
  "forecast_view",
  "brain_view",
  "connector_sync",
] as const;

export type UnmeteredFeature = (typeof UNMETERED_FEATURES)[number];

/** Credits charged for `quantity` native units of `feature`. */
export function creditsFor(feature: MeteredFeature, quantity: number): number {
  return quantity * PRICE_BOOK[feature].creditsPerUnit;
}

/**
 * Our cost in micro-USD for `quantity` native units.
 *
 * Fractional quantities are scaled before the BigInt multiply rather than
 * rounded to a whole unit: a 12-second voice clip is 0.012 kchar, and rounding
 * that to zero would report a cost of nothing for work that cost something.
 */
export function costMicrosFor(feature: MeteredFeature, quantity: number): bigint {
  const perUnit = COST_MODEL[feature].costMicrosPerUnit;
  const scaled = BigInt(Math.round(quantity * 1_000_000));
  return (scaled * perUnit) / BigInt(1_000_000);
}

/** Human label for a feature, falling back to the raw key for unknown ones. */
export function featureLabel(feature: string): string {
  return isMeteredFeature(feature) ? PRICE_BOOK[feature].displayName : feature;
}

/**
 * "412 credits · 412 meeting minutes" — the second half of a bar's label.
 *
 * Quantities are shown to the precision the unit deserves: whole minutes and
 * documents, two decimals for the fractional `k` units where "0 credits · 0 1k
 * characters" would otherwise be the label on a real charge.
 */
export function quantityLabel(feature: string, quantity: number): string {
  if (!isMeteredFeature(feature)) return String(quantity);
  const { unit, displayUnit } = PRICE_BOOK[feature];
  const whole = unit === "minute" || unit === "run" || unit === "month";
  const shown = whole
    ? Math.round(quantity).toLocaleString()
    : quantity.toFixed(2);
  return `${shown} ${displayUnit}${whole && Math.round(quantity) !== 1 ? "s" : ""}`;
}

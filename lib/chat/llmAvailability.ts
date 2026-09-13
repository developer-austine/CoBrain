/**
 * LLM availability — a tiny circuit breaker around Anthropic.
 *
 * The app is designed to degrade, never fail, when synthesis isn't available:
 * chat falls back to grounded extractive answers, intent falls back to
 * heuristics, and brain writes fall back to recording the user's own words.
 *
 * Two distinct situations need that fallback, and only the first is obvious:
 *   1. no ANTHROPIC_API_KEY at all
 *   2. a key that is present but REJECTED — exhausted credits, revoked key,
 *      rate limit. Checking `process.env.ANTHROPIC_API_KEY` says nothing about
 *      this; only a failed call reveals it.
 *
 * Without a breaker, case 2 makes every single request pay a doomed API
 * round-trip before degrading. So once a call fails we remember it and skip
 * straight to the fallback for a cooldown whose length matches the cause: an
 * exhausted balance won't fix itself in seconds, a blip might.
 *
 * Process-local by design — no coordination needed, and each instance
 * re-probes independently once its cooldown lapses.
 */

export type LlmFailureKind = "billing" | "auth" | "rate_limit" | "transient";

/** An exhausted balance or dead key needs a human, so back off hard. */
const COOLDOWN_MS: Record<LlmFailureKind, number> = {
  billing: 10 * 60_000,
  auth: 10 * 60_000,
  rate_limit: 60_000,
  transient: 15_000,
};

let disabledUntil = 0;
let lastReason: string | null = null;

/** Is a key configured at all? */
export function isLlmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Should we attempt an LLM call right now? */
export function isLlmAvailable(now: number = Date.now()): boolean {
  if (!isLlmConfigured()) return false;
  return now >= disabledUntil;
}

/** Why we're degraded (for user-facing copy), or null when healthy. */
export function llmUnavailableReason(): string | null {
  if (!isLlmConfigured()) return "no API key configured";
  return disabledUntil > Date.now() ? lastReason : null;
}

/** Classify a failure so the cooldown fits the cause. */
export function classifyLlmError(err: unknown): { kind: LlmFailureKind; reason: string } {
  const status = (err as { status?: number })?.status;
  const message = err instanceof Error ? err.message : String(err ?? "");

  if (/credit balance is too low|insufficient.*credit|billing/i.test(message)) {
    return { kind: "billing", reason: "Anthropic credit balance exhausted" };
  }
  if (status === 401 || status === 403) {
    return { kind: "auth", reason: "Anthropic API key rejected" };
  }
  if (status === 429) {
    return { kind: "rate_limit", reason: "Anthropic rate limit reached" };
  }
  // 400 with no billing hint is usually a bad request — still not worth
  // retrying immediately.
  return { kind: "transient", reason: "Anthropic temporarily unavailable" };
}

/** Record a failed call and open the breaker for the appropriate cooldown. */
export function noteLlmFailure(err: unknown, now: number = Date.now()): LlmFailureKind {
  const { kind, reason } = classifyLlmError(err);
  disabledUntil = now + COOLDOWN_MS[kind];
  lastReason = reason;
  console.warn(
    `[llm] disabled for ${COOLDOWN_MS[kind] / 1000}s — ${reason}. Falling back to non-AI mode.`
  );
  return kind;
}

/** A call succeeded — close the breaker. */
export function noteLlmSuccess(): void {
  disabledUntil = 0;
  lastReason = null;
}

/** Test seam. */
export function resetLlmAvailability(): void {
  disabledUntil = 0;
  lastReason = null;
}

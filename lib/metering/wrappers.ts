import "server-only";
import { IDEMPOTENCY_KEYS, meter, meterUnmetered, type MeterResult } from "./meter";

/**
 * THE METERING BOUNDARY (LAW 2).
 *
 * One function per external cost source. Business logic calls these; nothing
 * outside this file calls meter(). The acceptance check is a grep: `meter(`
 * must not appear in a route handler, a server action, or a component.
 *
 * Why a boundary at all: metering written inline is metering that gets missed.
 * A new code path into the same cost source is added by someone who did not
 * know the old path billed, and the shortfall is invisible until the provider
 * invoice arrives. One function per source means a new path has exactly one
 * correct thing to call, and reviewers can see when it did not.
 *
 * ── STATUS ────────────────────────────────────────────────────────────────
 * Three of these have no caller in this repository yet, because the subsystems
 * they meter do not exist: there is no meeting agent, no TTS client, and no
 * retraining lifecycle here. They are written now, against the spec's exact
 * idempotency recipes, so that when those subsystems land the metering call is
 * a one-line import rather than a design decision made under deadline by
 * whoever happens to be building the feature.
 *   meterMeetingMinute   — awaits lib/meetings/session.ts
 *   meterVoiceSynthesis  — awaits lib/voice/tts.ts
 *   meterModelRetrain    — awaits the m_learning retrain lifecycle
 *   meterApiRequests     — awaits an external-facing API gateway
 * Wired today: meterBulkIngest, meterForecastTarget, meterLlmCall.
 */

/**
 * One elapsed minute of a meeting agent session.
 *
 * Called once per minute of wall clock rather than once at the end. A session
 * that crashes at minute 40 of 60 has genuinely cost us 40 minutes of bot
 * infrastructure, and billing per-minute means the ledger already knows that
 * without any crash-recovery logic. The minute index makes each of those calls
 * independently idempotent, so a resumed session re-billing minutes 1–40 is a
 * no-op.
 */
export function meterMeetingMinute(args: {
  tenantId: string;
  actorUserId?: string | null;
  meetingId: string;
  minuteIndex: number;
  metadata?: Record<string, unknown>;
}): Promise<MeterResult> {
  return meter({
    tenantId: args.tenantId,
    actorUserId: args.actorUserId,
    feature: "meeting_agent",
    quantity: 1,
    idempotencyKey: IDEMPOTENCY_KEYS.meetingMinute(args.meetingId, args.minuteIndex),
    metadata: { meetingId: args.meetingId, minuteIndex: args.minuteIndex, ...args.metadata },
  });
}

/**
 * One synthesised utterance, priced per thousand characters.
 *
 * The utterance id is the unit of retry — a failed synthesis that is retried
 * produces the same audio for the same id, and must not be charged twice.
 */
export function meterVoiceSynthesis(args: {
  tenantId: string;
  actorUserId?: string | null;
  utteranceId: string;
  characterCount: number;
  voice?: string;
  provider?: string;
}): Promise<MeterResult> {
  return meter({
    tenantId: args.tenantId,
    actorUserId: args.actorUserId,
    feature: "voice_synthesis",
    quantity: args.characterCount / 1000,
    idempotencyKey: IDEMPOTENCY_KEYS.voiceSynthesis(args.utteranceId),
    metadata: {
      utteranceId: args.utteranceId,
      characterCount: args.characterCount,
      voice: args.voice,
      provider: args.provider,
    },
  });
}

/**
 * One batch of the ingest pipeline, priced per thousand documents.
 *
 * Aggregated per batch, not per document: a 40,000-document backfill would
 * otherwise write 40,000 ledger rows to record one charge, and the receipts
 * table would be unreadable for the exact customer most likely to query it.
 *
 * Only volume ABOVE the plan's included allowance reaches here — a normal
 * connector sync is unmetered (Section 0), so the caller passes the billable
 * document count, not the total it processed.
 */
export function meterBulkIngest(args: {
  tenantId: string;
  actorUserId?: string | null;
  batchId: string;
  billableDocuments: number;
  source?: string;
}): Promise<MeterResult> {
  return meter({
    tenantId: args.tenantId,
    actorUserId: args.actorUserId,
    feature: "bulk_ingest",
    quantity: args.billableDocuments / 1000,
    idempotencyKey: IDEMPOTENCY_KEYS.bulkIngest(args.batchId),
    metadata: {
      batchId: args.batchId,
      documents: args.billableDocuments,
      source: args.source,
    },
  });
}

/**
 * One active forecast target, for one calendar month.
 *
 * Charged by the monthly job rather than when a target is created, so a target
 * enabled on the 28th costs the same as one enabled on the 1st. The alternative
 * — pro-rating — invites customers to churn targets at month boundaries to game
 * the bill, which is effort spent on our billing rather than on their work.
 */
export function meterForecastTarget(args: {
  tenantId: string;
  targetId: string;
  /** `YYYY-MM`. */
  period: string;
}): Promise<MeterResult> {
  return meter({
    tenantId: args.tenantId,
    actorUserId: null, // scheduled work; no person triggered it
    feature: "forecast_target",
    quantity: 1,
    idempotencyKey: IDEMPOTENCY_KEYS.forecastTarget(args.targetId, args.period),
    metadata: { targetId: args.targetId, period: args.period },
  });
}

/** One on-demand retraining run. Charged at start; RULE 4-1 lets it finish. */
export function meterModelRetrain(args: {
  tenantId: string;
  actorUserId?: string | null;
  runId: string;
  target?: string;
}): Promise<MeterResult> {
  return meter({
    tenantId: args.tenantId,
    actorUserId: args.actorUserId,
    feature: "model_retrain",
    quantity: 1,
    idempotencyKey: IDEMPOTENCY_KEYS.modelRetrain(args.runId),
    metadata: { runId: args.runId, target: args.target },
  });
}

/**
 * A bucket of external API requests, priced per thousand.
 *
 * Hourly buckets rather than one row per request: a customer hitting the API at
 * 50 rps would write four million ledger rows a day, and the ledger exists to
 * be summed and read, not to mirror an access log.
 */
export function meterApiRequests(args: {
  tenantId: string;
  hourStamp: string; // YYYY-MM-DD-HH
  bucketIndex: number;
  requestCount: number;
}): Promise<MeterResult> {
  return meter({
    tenantId: args.tenantId,
    actorUserId: null,
    feature: "api_request",
    quantity: args.requestCount / 1000,
    idempotencyKey: IDEMPOTENCY_KEYS.apiRequests(
      args.tenantId,
      args.hourStamp,
      args.bucketIndex
    ),
    metadata: { requests: args.requestCount, hourStamp: args.hourStamp },
  });
}

/**
 * An LLM call on the core loop — chat, search, prompt routing.
 *
 * CHARGES ZERO CREDITS, ALWAYS. This exists so the margin report knows what the
 * included features cost us; it is not a billing path and must never become
 * one. Provider token counts go into metadata for cost analysis and are never
 * read back into anything a customer sees.
 *
 * The cost estimate is the caller's, because only the caller knows which model
 * ran and how large the context was. Passing 0n is acceptable and honest when
 * the provider gave us no usage figures.
 */
export function meterLlmCall(args: {
  tenantId: string;
  actorUserId?: string | null;
  requestId: string;
  costMicros: bigint;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  surface?: "chat" | "search" | "prompt";
}): Promise<MeterResult> {
  return meterUnmetered({
    tenantId: args.tenantId,
    actorUserId: args.actorUserId,
    feature: args.surface === "search" ? "search" : "chat",
    costMicros: args.costMicros,
    idempotencyKey: `llm:${args.requestId}`,
    metadata: {
      model: args.model,
      // Internal cost inputs. Never surfaced — see the terminology rule.
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      surface: args.surface,
    },
  });
}

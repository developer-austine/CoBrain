/**
 * Interactive intelligence layer — shared contracts.
 *
 * The frontend NEVER sends "@brain" as parseable text. Mentions are structured
 * tokens picked from the dropdown; the prompt box submits prose + references.
 * (Blueprint §3.2 — the single most important frontend decision.)
 */

export type ReferenceType = "page" | "model" | "entity";

/** A structured @-mention token. */
export type PromptReference = {
  type: ReferenceType;
  id: string;
  label: string;
  /** Character offset in the submitted text (informational). */
  pos?: number;
};

/** Exact submission contract the prompt box sends to POST /api/prompt. */
export type PromptSubmission = {
  text: string;
  references: PromptReference[];
  inputMethod?: "typed" | "voice";
  conversationId?: string | null;
};

/** The parser's separation of a submission (blueprint §3.4). */
export type ParsedPrompt = {
  /** The prose — what the user wants done. */
  prose: string;
  /** Page refs — where to write (e.g. ["brain"]). */
  writeTargets: string[];
  /** Selected model id, if a @model was mentioned. */
  model: string | null;
  /** Entity refs — context scoping. */
  contextRefs: PromptReference[];
};

export type Intent = "QUERY" | "CONFIG" | "WRITE";

export type ClassifiedPrompt = {
  intent: Intent;
  confidence: number; // 0–1
  /** Set when confidence is too low — ask instead of guessing (§4.3). */
  clarifyingQuestion?: string;
};

/** BrainBlock content types (blueprint §6.1). */
export const BRAIN_BLOCK_TYPES = [
  "meeting_summary",
  "forecast",
  "learned_fact",
  "pattern",
  "decision",
  "brief",
  "note",
] as const;
export type BrainBlockType = (typeof BRAIN_BLOCK_TYPES)[number];

/** Domain events that can fire standing AgentConfig rules (§5.3). */
export const DOMAIN_EVENTS = [
  "meeting_attended",
  "tft_forecast_completed",
  "document_processed",
  "daily_digest_due",
] as const;
export type DomainEvent = (typeof DOMAIN_EVENTS)[number];

/** Structured block the AI produces before persistence (§6.1 step 2). */
export type BrainBlockDraft = {
  type: BrainBlockType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sourceRefs?: unknown[];
  confidence: number;
  createdBy: "ai" | "human";
};

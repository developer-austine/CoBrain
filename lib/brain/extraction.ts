import prisma from "@/lib/prisma";
import {
  isLlmAvailable,
  isLlmConfigured,
  llmUnavailableReason,
  noteLlmFailure,
  noteLlmSuccess,
} from "@/lib/chat/llmAvailability";
import { writeBrainBlock } from "@/lib/interactive/pageMutation";
import { BRAIN_BLOCK_TYPES, type BrainBlockType } from "@/lib/interactive/types";

/**
 * Knowledge extraction — the brain reads every source it is given.
 *
 * Uploading a document used to make it *searchable*: text out, embeddings in,
 * and the brain learned nothing until somebody typed a prompt asking it to.
 * That put the burden of noticing on the user, which is exactly backwards — you
 * cannot ask about a decision you do not know was made.
 *
 * So ingestion now ends here. Every processed source is read end to end, the
 * durable knowledge in it is extracted, reconciled against what the brain
 * already believes, and written as review-queue blocks.
 *
 * Three rules the rest of this file exists to keep:
 *
 *  1. **The whole document, always.** Windows grow to cover the input rather
 *     than the input being truncated to fit the window. A decision on the last
 *     page is the one most worth having.
 *  2. **Nothing lands unreviewed.** Nobody asked for these writes, so they are
 *     queued for review regardless of confidence — unlike a prompt-driven write,
 *     where the user's request is itself the authority.
 *  3. **Re-reading is not re-writing.** A candidate that matches something the
 *     brain already knows either supersedes it (when the facts changed) or is
 *     dropped (when they did not). Uploading v2 of a document should not leave
 *     two contradictory blocks side by side.
 */

/** Claude reads at most this many windows; window size grows to compensate. */
const MAX_WINDOWS = 10;
const TARGET_WINDOW_CHARS = 12_000;
const WINDOW_OVERLAP_CHARS = 600;

/** Below this there is no document to speak of — a filename, a stray line. */
const MIN_EXTRACTABLE_CHARS = 200;

/** Cap per document so one 400-page PDF cannot flood the review queue. */
const MAX_BLOCKS_PER_SOURCE = 12;

/** Titles at or above this token overlap are treated as the same subject. */
const SAME_SUBJECT_THRESHOLD = 0.6;

/** Bodies at or above this overlap are treated as unchanged (no new version). */
const UNCHANGED_BODY_THRESHOLD = 0.85;

const MODEL = "claude-opus-5";

export type ExtractionCandidate = {
  type: BrainBlockType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  confidence: number;
};

export type ExtractionOutcome = {
  status: "DONE" | "FAILED" | "SKIPPED";
  created: number;
  updated: number;
  skipped: number;
  reason?: string;
};

export type ExtractionSource = {
  /** SourceFile id (or another ingested row) — recorded as provenance. */
  id: string;
  kind: "upload" | "notion" | "github" | "email";
  title: string;
  text: string;
  /**
   * Object-storage keys for diagrams pulled out of the document, in reading
   * order. Carried onto every block written from this source: a spec's
   * architecture diagram is part of what the document said, and a block that
   * cites the prose but drops the picture has cited half of it.
   */
  images?: { key: string; page: number }[];
};

// ─── Reading the whole document ──────────────────────────────────────────────

/**
 * Split a document into overlapping windows that together cover all of it.
 *
 * The window grows rather than the document being cut: a fixed window plus a
 * hard window count silently drops the tail of anything long, and the tail is
 * where conclusions live. Overlap keeps a fact that straddles a boundary from
 * being halved into nonsense in both windows.
 */
export function chunkDocument(text: string): string[] {
  const clean = text.trim();
  if (clean.length < MIN_EXTRACTABLE_CHARS) return [];
  if (clean.length <= TARGET_WINDOW_CHARS) return [clean];

  const size = Math.max(
    TARGET_WINDOW_CHARS,
    Math.ceil(clean.length / MAX_WINDOWS) + WINDOW_OVERLAP_CHARS
  );

  const windows: string[] = [];
  let start = 0;
  while (start < clean.length) {
    windows.push(clean.slice(start, start + size));
    const next = start + size - WINDOW_OVERLAP_CHARS;
    // Guard against a pathological size/overlap pair looping forever.
    if (next <= start) break;
    start = next;
  }
  return windows;
}

// ─── Similarity (no embeddings — this runs before anything is indexed) ───────

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is",
  "are", "was", "were", "be", "by", "at", "from", "that", "this", "it", "as",
]);

/** Content tokens only — so "The Q3 Budget" and "Q3 budget" are one subject. */
export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  );
}

function sharedCount(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared;
}

/**
 * Jaccard overlap, 0–1 — symmetric, so extra material on either side counts
 * against the score. That is what makes it the right test for *bodies*: a
 * three-line block is not "the same as" the two-page block that contains it.
 */
export function similarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  const shared = sharedCount(ta, tb);
  return shared / (ta.size + tb.size - shared);
}

/**
 * Do two titles name the same subject?
 *
 * Containment, not Jaccard. Titles for one subject vary wildly in length —
 * "Stay on Qdrant rather than migrate to pgvector" and "The Qdrant vs pgvector
 * decision" are the same decision, but Jaccard scores them 0.29 because it
 * punishes the longer title for having more words. Overlapping windows produce
 * exactly these paraphrase pairs, so scoring them as different subjects is how
 * the same fact gets written to the brain twice.
 *
 * The single-token guard is the price of that: without it a title of one word
 * would swallow every longer title containing it, so those fall back to the
 * symmetric test.
 */
export function sameSubject(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  const smaller = Math.min(ta.size, tb.size);
  if (smaller < 2) return similarity(a, b);

  return sharedCount(ta, tb) / smaller;
}

// ─── Merging what the windows found ─────────────────────────────────────────

/**
 * Collapse candidates that several windows found independently.
 *
 * Overlapping windows mean the same fact is often reported twice, and a long
 * document repeats its own conclusions. Keep the most confident statement of
 * each subject rather than filing three versions of one thing.
 */
export function mergeCandidates(all: ExtractionCandidate[]): ExtractionCandidate[] {
  const kept: ExtractionCandidate[] = [];

  for (const candidate of [...all].sort((a, b) => b.confidence - a.confidence)) {
    const duplicate = kept.find(
      (k) => k.type === candidate.type && sameSubject(k.title, candidate.title) >= SAME_SUBJECT_THRESHOLD
    );
    // Sorted by confidence, so the incumbent is always the better-supported one.
    if (!duplicate) kept.push(candidate);
  }

  return kept.slice(0, MAX_BLOCKS_PER_SOURCE);
}

// ─── Reconciling against what the brain already believes ────────────────────

export type ExistingBlock = { id: string; type: string; title: string; body: string };

export type Reconciled =
  | { action: "create"; candidate: ExtractionCandidate }
  | { action: "update"; candidate: ExtractionCandidate; supersedes: string }
  | { action: "skip"; candidate: ExtractionCandidate; reason: string };

/**
 * Decide what each candidate means relative to the current brain.
 *
 * This is the "check for key changes" step, and it is the difference between a
 * brain that learns and a brain that accumulates. Same subject and same
 * substance is a re-read — drop it. Same subject, different substance is news —
 * queue it as a new version pointing at the row it replaces, so approving it
 * supersedes the old one instead of leaving both on the page.
 */
export function reconcile(
  candidates: ExtractionCandidate[],
  existing: ExistingBlock[]
): Reconciled[] {
  return candidates.map((candidate) => {
    const match = existing.find(
      (e) => e.type === candidate.type && sameSubject(e.title, candidate.title) >= SAME_SUBJECT_THRESHOLD
    );

    if (!match) return { action: "create", candidate } as const;

    if (similarity(match.body, candidate.body) >= UNCHANGED_BODY_THRESHOLD) {
      return { action: "skip", candidate, reason: "already known" } as const;
    }

    return { action: "update", candidate, supersedes: match.id } as const;
  });
}

// ─── Asking Claude what the document actually says ──────────────────────────

const SYSTEM_PROMPT =
  "You are CoBrain's knowledge extractor. You are given one section of a " +
  "document from a company's own files. Extract the DURABLE KNOWLEDGE it " +
  "contains — the things this company would want to still know in six months.\n\n" +
  `Return a JSON array. Each element: { "type": one of ${BRAIN_BLOCK_TYPES.map((t) => `"${t}"`).join(" | ")}, ` +
  `"title": string (<= 80 chars, specific — name the subject, never "Notes" or "Summary"), ` +
  `"body": string (GitHub-flavoured Markdown), ` +
  `"data": object (the same facts, structured), ` +
  `"confidence": number 0-1 }\n\n` +
  "What counts as durable knowledge:\n" +
  "- decisions that were made, who made them, and why → type `decision`\n" +
  "- facts about the company, its people, its customers, who owns what → `learned_fact`\n" +
  "- recurring behaviour, trends, or anomalies the document describes → `pattern`\n" +
  "- what happened in a meeting, and what was agreed → `meeting_summary`\n\n" +
  "What does NOT count — return nothing for these:\n" +
  "- boilerplate, headers, footers, page numbers, legal disclaimers\n" +
  "- restatements of the document's own structure ('this section covers…')\n" +
  "- anything you are inferring rather than reading. If the section says nothing " +
  "durable, return []. An empty array is a correct and common answer.\n\n" +
  "Body formatting — the Brain page renders Markdown:\n" +
  "- Open with one sentence stating the knowledge.\n" +
  "- Use a Markdown TABLE for anything enumerable (owners, dates, decisions).\n" +
  "- **Bold** people's names on first mention.\n" +
  "- Record WHO, WHEN, and WHY when the text says so; write 'Not stated' rather " +
  "than inventing a value. Never invent a name, number, or date.\n" +
  "- Set confidence below 0.6 when the section only partly supports the claim.\n\n" +
  "Return ONLY the JSON array — no prose, no code fence.";

/** Tolerate a code fence or stray prose around the array. */
export function parseCandidateJson(raw: string): ExtractionCandidate[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : raw).trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((row): ExtractionCandidate[] => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    const body = typeof r.body === "string" ? r.body.trim() : "";
    if (!title || !body) return [];

    const confidence =
      typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1
        ? r.confidence
        : 0.6;

    return [
      {
        type: BRAIN_BLOCK_TYPES.includes(r.type as BrainBlockType)
          ? (r.type as BrainBlockType)
          : "learned_fact",
        title: title.slice(0, 120),
        body,
        data: r.data && typeof r.data === "object" ? (r.data as Record<string, unknown>) : undefined,
        confidence,
      },
    ];
  });
}

/**
 * Read one window.
 *
 * Streamed because `max_tokens` is high enough that a non-streaming call risks
 * an HTTP timeout, and because thinking counts against the same budget — a
 * tight cap here truncates the answer mid-array and loses the whole window.
 */
async function readWindow(
  window: string,
  source: ExtractionSource,
  index: number,
  total: number
): Promise<ExtractionCandidate[]> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          `Document: ${source.title} (${source.kind})\n` +
          `Section ${index + 1} of ${total}.\n\n` +
          `---\n${window}\n---`,
      },
    ],
  });

  const message = await stream.finalMessage();

  // A declined section is not a failure of the document — skip it and keep
  // reading the rest rather than losing everything the other windows found.
  if (message.stop_reason === "refusal") {
    console.warn(`[brain/extraction] section ${index + 1} declined for ${source.id}`);
    return [];
  }

  const raw = message.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  return parseCandidateJson(raw);
}

// ─── The pipeline ───────────────────────────────────────────────────────────

/**
 * Read a source end to end and queue what it taught us.
 *
 * Callers pass `userId` explicitly and the caller owns the tenant scope: this
 * writes blocks attributed to a person, so it must never infer whose brain it
 * is writing into.
 */
export async function extractKnowledge(
  userId: string,
  source: ExtractionSource
): Promise<ExtractionOutcome> {
  const windows = chunkDocument(source.text);
  if (windows.length === 0) {
    return { status: "SKIPPED", created: 0, updated: 0, skipped: 0, reason: "too short to hold knowledge" };
  }

  if (!isLlmAvailable()) {
    // Deliberately not falling back to an extractive digest: an unsolicited
    // block that only quotes the file adds nothing a search would not, and the
    // upload is retried by the cron once synthesis is back.
    return {
      status: "FAILED",
      created: 0,
      updated: 0,
      skipped: 0,
      reason: !isLlmConfigured()
        ? "no ANTHROPIC_API_KEY configured"
        : (llmUnavailableReason() ?? "AI synthesis unavailable"),
    };
  }

  let found: ExtractionCandidate[];
  try {
    // Sequential, not parallel: a 10-window document firing ten concurrent
    // requests is the fastest way to get the whole tenant rate-limited.
    found = [];
    for (let i = 0; i < windows.length; i++) {
      found.push(...(await readWindow(windows[i], source, i, windows.length)));
    }
    noteLlmSuccess();
  } catch (err) {
    noteLlmFailure(err);
    console.error(`[brain/extraction] read failed for ${source.id}:`, err);
    return {
      status: "FAILED",
      created: 0,
      updated: 0,
      skipped: 0,
      reason: llmUnavailableReason() ?? "could not read the document",
    };
  }

  const candidates = mergeCandidates(found);
  if (candidates.length === 0) {
    return { status: "DONE", created: 0, updated: 0, skipped: 0, reason: "nothing durable in this document" };
  }

  const existing = await prisma.brainBlock.findMany({
    where: { userId, status: "active" },
    select: { id: true, type: true, title: true, body: true },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });

  const decisions = reconcile(candidates, existing);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const decision of decisions) {
    if (decision.action === "skip") {
      skipped++;
      continue;
    }

    const { candidate } = decision;
    const supersedes = decision.action === "update" ? decision.supersedes : undefined;

    try {
      await writeBrainBlock(
        userId,
        {
          type: candidate.type,
          title: candidate.title,
          body: candidate.body,
          data: {
            ...(candidate.data ?? {}),
            extractedFrom: { kind: source.kind, id: source.id, title: source.title },
            ...(source.images?.length ? { images: source.images } : {}),
            ...(supersedes ? { supersedes } : {}),
          },
          confidence: candidate.confidence,
          createdBy: "ai",
          sourceRefs: [
            {
              kind: "document",
              source: source.kind,
              docId: source.id,
              title: source.title,
              ...(source.images?.length ? { images: source.images } : {}),
            },
          ],
        },
        // RULE 2: nobody asked for this write, so a human sees it first —
        // whatever the model's confidence.
        { status: "queued_for_review" }
      );
      if (supersedes) updated++;
      else created++;
    } catch (err) {
      console.error(`[brain/extraction] write failed for ${source.id}:`, err);
      skipped++;
    }
  }

  return { status: "DONE", created, updated, skipped };
}

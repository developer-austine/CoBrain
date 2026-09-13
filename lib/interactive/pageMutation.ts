import prisma from "@/lib/prisma";
import { redis } from "@/lib/queue/publisher";
import { cleanForDisplay, deriveConversationTitle, truncateWords } from "@/lib/chat/format";
import { buildContext, type ResolvedDocument } from "@/lib/chat/rag";
import { attributePeople, renderRoster } from "@/lib/chat/people";
import {
  isLlmAvailable,
  isLlmConfigured,
  llmUnavailableReason,
  noteLlmFailure,
  noteLlmSuccess,
} from "@/lib/chat/llmAvailability";
import {
  BRAIN_BLOCK_TYPES,
  type BrainBlockDraft,
  type BrainBlockType,
} from "./types";

/**
 * Page Mutation Engine (blueprint §6): turn an intent-to-write into a saved,
 * rendered, reversible change.
 *
 *   draft → validate → confidence gate → persist (append-only) → dual-write
 *
 * The golden rule: every AI write is provenanced and reversible; humans hold
 * final authority. Low-confidence writes land in a review queue instead of
 * the page.
 */

const QUEUE_KEY = "company_brain:ingest";

/** Writes at or above this confidence go straight to the page (§6.1 step 4). */
export const CONFIDENCE_AUTO_WRITE = 0.7;

export type DraftValidation = { ok: true } | { ok: false; error: string };

/** Schema-check a draft before it touches the database (§6.1 step 3). */
export function validateDraft(draft: BrainBlockDraft): DraftValidation {
  if (!BRAIN_BLOCK_TYPES.includes(draft.type)) {
    return { ok: false, error: `Unknown block type "${draft.type}"` };
  }
  if (!draft.title?.trim()) return { ok: false, error: "Block title is required" };
  if (!draft.body?.trim()) return { ok: false, error: "Block body is required" };
  if (
    typeof draft.confidence !== "number" ||
    Number.isNaN(draft.confidence) ||
    draft.confidence < 0 ||
    draft.confidence > 1
  ) {
    return { ok: false, error: "Confidence must be between 0 and 1" };
  }
  if (draft.createdBy !== "ai" && draft.createdBy !== "human") {
    return { ok: false, error: "createdBy must be 'ai' or 'human'" };
  }
  return { ok: true };
}

/** Confidence gate: where does this draft land? */
export function gateStatus(draft: Pick<BrainBlockDraft, "confidence" | "createdBy">): string {
  // Human-dictated content is authoritative by definition (§11 example 2).
  if (draft.createdBy === "human") return "active";
  return draft.confidence >= CONFIDENCE_AUTO_WRITE ? "active" : "queued_for_review";
}

/**
 * Derive a structured draft from a direct WRITE prompt. Deterministic — the
 * user's own words are the content (createdBy: "human", high confidence).
 */
export function draftFromWritePrompt(prose: string): BrainBlockDraft {
  return {
    type: detectBlockType(prose),
    title: deriveConversationTitle(prose),
    body: prose.trim(),
    confidence: 0.95,
    createdBy: "human",
    sourceRefs: [{ kind: "prompt" }],
  };
}

/** Provenance for every document a source-backed draft was built from. */
function sourceRefsFor(docs: ResolvedDocument[]): unknown[] {
  return docs.map((d, i) => ({
    kind: "document",
    index: i + 1,
    source: d.source,
    docId: d.docId,
    title: d.title,
    url: d.url,
  }));
}

/**
 * A grounded, no-LLM digest of the documents the user pointed at.
 *
 * This is what "update @brain from @notion and @files" produces when Claude is
 * unavailable. The alternative — recording the user's instruction verbatim —
 * writes a block that says "update the brain page with the learned
 * information", which is not knowledge and quietly looks like success.
 *
 * Everything here is quoted or copied from the retrieved documents, so the
 * block is factual even though nothing synthesised it.
 */
export function extractiveDraftFromSources(
  instruction: string,
  docs: ResolvedDocument[]
): BrainBlockDraft {
  const sources = [...new Set(docs.map((d) => d.source))].join(", ");
  const reason = !isLlmConfigured()
    ? "no ANTHROPIC_API_KEY configured"
    : (llmUnavailableReason() ?? "AI synthesis unavailable");

  const rows = docs
    .map(
      (d, i) =>
        `| [${i + 1}] | ${d.source} | ${d.title} | ${d.displayAuthor ?? "Not stated"} |`
    )
    .join("\n");

  const excerpts = docs
    .map((d, i) => {
      const text = cleanForDisplay(d.text);
      if (!text) return "";
      return `### [${i + 1}] ${d.title} _(${d.source})_\n${truncateWords(text, 220)}`;
    })
    .filter(Boolean)
    .join("\n\n");

  // Who works on what is the most reusable thing in the sources, and it is a
  // fact the company learned — not a note about some documents. When the
  // documents carry ownership, that roster leads the block and types it as a
  // learned fact, so it is findable as knowledge rather than filed as a generic
  // digest nobody looks at twice.
  const people = attributePeople(docs);
  const roster = people.filter((p) => p.evidence === "ownership");
  const rosterSection = roster.length
    ? `## Who works on what\n\n${renderRoster(people)}\n\n`
    : "";

  const body =
    `Compiled from ${docs.length} document${docs.length === 1 ? "" : "s"} in ${sources}.\n\n` +
    rosterSection +
    `## Sources\n\n| # | Source | Document | Author |\n| --- | --- | --- | --- |\n${rows}\n\n` +
    `## What the sources say\n\n${excerpts}\n\n` +
    `_Direct excerpts — AI synthesis was unavailable (${reason}), so nothing here is ` +
    `inferred or summarised. Re-run this prompt once synthesis is back to get a ` +
    `structured write-up._`;

  return {
    type: roster.length
      ? "learned_fact"
      : detectBlockType(`${instruction} ${docs.map((d) => d.title).join(" ")}`),
    // Name it after what it contains, not after the instruction that produced
    // it — the Brain index is a list of titles, and "update the brain page
    // with…" tells a reader nothing about the knowledge inside.
    title: roster.length
      ? `Team & ownership — ${roster.map((p) => p.name).join(", ")}`
      : `Source digest — ${sources} (${docs.length} document${docs.length === 1 ? "" : "s"})`,
    body,
    data: {
      mode: "extractive",
      reason,
      // Structured so the roster is queryable, not just prose in a body.
      people: roster.map((p) => ({ name: p.name, items: p.items, sources: p.sources })),
      documents: docs.map((d, i) => ({
        index: i + 1,
        source: d.source,
        title: d.title,
        author: d.displayAuthor,
        url: d.url,
      })),
    },
    // Quoted source material is trustworthy enough to land on the page; the
    // body says plainly that it was not synthesised.
    confidence: 0.75,
    createdBy: "ai",
    sourceRefs: sourceRefsFor(docs),
  };
}

/** How a source-backed draft was actually produced — callers report this. */
export type DraftMode = "synthesized" | "extractive";

export type SourceDraft = {
  draft: BrainBlockDraft;
  mode: DraftMode;
  /** Set when synthesis was skipped or failed. */
  degradedReason?: string;
};

/**
 * Derive a draft by READING the user's sources first (blueprint §6.1 step 1–2).
 *
 * "Edit the @brain page with who was given a task from @notion and why" is not
 * a dictation — it is an instruction to go and learn something, then record it.
 * So we retrieve the cited documents, ask Claude to extract the structured
 * knowledge (who / what / when / why), and persist that as a formatted block
 * whose sourceRefs point back at the exact documents it came from.
 *
 * When Claude is unavailable we fall back to a grounded extractive digest of
 * the SAME documents and say so — both in the block body and in `mode`, so the
 * caller can tell the user the write was degraded instead of claiming success.
 *
 * Callers must not pass an empty `docs`: with nothing read there is nothing to
 * record, and that case is the caller's to report.
 */
export async function draftFromSources(
  instruction: string,
  docs: ResolvedDocument[]
): Promise<SourceDraft> {
  // No LLM available (missing key, exhausted credits, rate-limited) — quote the
  // sources rather than pretending to have understood them.
  if (docs.length === 0 || !isLlmAvailable()) {
    return {
      draft: extractiveDraftFromSources(instruction, docs),
      mode: "extractive",
      degradedReason: !isLlmConfigured()
        ? "no ANTHROPIC_API_KEY configured"
        : (llmUnavailableReason() ?? "AI synthesis unavailable"),
    };
  }

  const context = buildContext(docs);

  const system =
    "You are CoBrain's knowledge writer. You are given complete documents from " +
    "the user's sources and an instruction describing what to record on the " +
    "Brain page. Extract the knowledge and return it as a single JSON object.\n\n" +
    `Schema: { "type": one of ${BRAIN_BLOCK_TYPES.map((t) => `"${t}"`).join(" | ")}, ` +
    `"title": string (<= 80 chars, specific — not "Notes"), ` +
    `"body": string (GitHub-flavoured Markdown), ` +
    `"data": object (structured facts), ` +
    `"confidence": number 0-1 }\n\n` +
    "Body formatting rules — the Brain page renders Markdown:\n" +
    "- Open with a one-sentence summary.\n" +
    "- Use `## ` sub-headings only when there are genuinely distinct sections.\n" +
    "- For anything enumerable (tasks, owners, decisions) use a Markdown TABLE " +
    "with clear columns, e.g. | Task | Owner | Why | Source |.\n" +
    "- **Bold** people's names on first mention.\n" +
    "- Record who decided/was assigned, WHEN, and WHY whenever the documents say so. " +
    "Write 'Not stated' rather than inventing a value.\n" +
    "- Cite the document number(s) like [1] next to each row or fact.\n" +
    "- Keep it tight. No preamble, no sign-off.\n\n" +
    "Put the enumerable facts in `data` too (e.g. " +
    `{"assignments":[{"task":"...","owner":"...","why":"...","when":"...","doc":1}]}).\n` +
    "Type it as `learned_fact` when it records who works here or who owns what — " +
    "that is durable knowledge about the company, not a `note`. Title it after the " +
    "knowledge (e.g. 'Team & ownership — <names>'), never after the instruction.\n" +
    "Set confidence below 0.7 if the documents only partially support the instruction.\n" +
    "Return ONLY the JSON object — no prose, no code fence.";

  let raw: string;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    const res = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2000,
      system,
      messages: [
        {
          role: "user",
          content:
            `Documents (${docs.length}):\n\n${context}\n\n` +
            `Instruction: ${instruction}`,
        },
      ],
    });
    noteLlmSuccess();

    raw = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  } catch (err) {
    // A rejected key or exhausted balance must not lose the user's write —
    // quote the documents instead, and stop retrying for a cooldown.
    noteLlmFailure(err);
    return {
      draft: extractiveDraftFromSources(instruction, docs),
      mode: "extractive",
      degradedReason: llmUnavailableReason() ?? "AI synthesis unavailable",
    };
  }

  const parsed = parseDraftJson(raw);
  if (!parsed) {
    console.error("[pageMutation] could not parse draft JSON, falling back");
    return {
      draft: extractiveDraftFromSources(instruction, docs),
      mode: "extractive",
      degradedReason: "the model returned an unparseable draft",
    };
  }

  const draft: BrainBlockDraft = {
    type: BRAIN_BLOCK_TYPES.includes(parsed.type as BrainBlockType)
      ? (parsed.type as BrainBlockType)
      : detectBlockType(instruction),
    title: (parsed.title || deriveConversationTitle(instruction)).slice(0, 120),
    body: parsed.body || instruction.trim(),
    data: parsed.data,
    confidence:
      typeof parsed.confidence === "number" &&
      parsed.confidence >= 0 &&
      parsed.confidence <= 1
        ? parsed.confidence
        : 0.75,
    // Provenance: every fact traces back to a real document.
    createdBy: "ai",
    sourceRefs: sourceRefsFor(docs),
  };

  return { draft, mode: "synthesized" };
}

type RawDraft = {
  type?: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  confidence?: number;
};

/** Tolerate a stray code fence or surrounding prose around the JSON object. */
export function parseDraftJson(raw: string): RawDraft | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(candidate.slice(start, end + 1));
    return obj && typeof obj === "object" ? (obj as RawDraft) : null;
  } catch {
    return null;
  }
}

/** Keyword-based block typing for direct writes. */
export function detectBlockType(prose: string): BrainBlockType {
  const p = prose.toLowerCase();
  if (/\b(decided|decision|agreed|final(ised|ized)?|approved)\b/.test(p)) return "decision";
  if (/\b(meeting|standup|sync|call)\b/.test(p)) return "meeting_summary";
  if (/\b(forecast|predict|projection|trajectory)\b/.test(p)) return "forecast";
  // Who works here, and who owns what, is durable knowledge about the company —
  // a learned fact, not a note. Filing it as a note is what makes the Brain
  // read as a pile of generic entries instead of things it has learned.
  if (
    /\b(devs?|developers?|engineers?|team|teammates?|members?|staff|colleagues?|roster|assignees?|owners?|owns|owned by|assigned to|works? on|responsible for)\b/.test(
      p
    )
  ) {
    return "learned_fact";
  }
  if (/\b(always|fact|policy|our (hq|office|fiscal)|is located)\b/.test(p)) return "learned_fact";
  if (/\b(trend|pattern|anomaly|spike|drop)\b/.test(p)) return "pattern";
  return "note";
}

/**
 * Persist a validated draft and dual-write it into the vector store via the
 * existing ingest pipeline (Redis → normalize → chunk → embed → Qdrant with
 * source="brain"). Returns the stored block.
 */
export async function writeBrainBlock(
  userId: string,
  draft: BrainBlockDraft,
  /**
   * Force the landing status, bypassing the confidence gate.
   *
   * The gate encodes "how sure is the model", which is the right question for a
   * write the user asked for. It is the wrong question for a write nobody asked
   * for: an auto-extracted block can be highly confident and still be something
   * the user would never have chosen to record. Those pass
   * `queued_for_review` and let a human decide.
   */
  options?: { status?: string }
) {
  const validation = validateDraft(draft);
  if (!validation.ok) throw new Error(validation.error);

  const status = options?.status ?? gateStatus(draft);

  const block = await prisma.brainBlock.create({
    data: {
      userId,
      type: draft.type,
      title: draft.title.trim(),
      body: draft.body.trim(),
      data: (draft.data as object) ?? undefined,
      sourceRefs: (draft.sourceRefs as object[]) ?? undefined,
      confidence: draft.confidence,
      createdBy: draft.createdBy,
      status,
    },
  });

  // Dual-write only blocks that are live on the page — review-queue content
  // must not become citable knowledge until a human approves it.
  if (status === "active") {
    await embedBrainBlock(userId, block.id, block.type, block.title, block.body);
  }

  return block;
}

/** Push a block through the ingest pipeline so it lands in Qdrant (source="brain"). */
export async function embedBrainBlock(
  userId: string,
  blockId: string,
  type: string,
  title: string,
  body: string
): Promise<void> {
  const payload = {
    raw_document_id: blockId,
    source: "brain",
    external_id: blockId,
    author: "ai",
    subject: title,
    content: `${title}\n\n${body}`,
    timestamp: new Date().toISOString(),
    metadata: { block_type: type },
    connector_id: "",
    namespace: `${userId}:brain`,
  };
  try {
    await redis.lpush(QUEUE_KEY, JSON.stringify(payload));
  } catch (err) {
    // Fail-soft: the block is saved and rendered; embedding can be replayed.
    console.error(`[pageMutation] dual-write enqueue failed for ${blockId}:`, err);
  }
}

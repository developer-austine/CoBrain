import prisma from "@/lib/prisma";
import { cleanForDisplay, truncateWords } from "@/lib/chat/format";
import type { Citation } from "@/lib/chat/types";
import { detectSourceIntent, SOURCE_KEYS, type SourceKey } from "@/lib/chat/sourceIntent";
import { bestExcerpt, rankDocuments } from "@/lib/chat/ranking";
import {
  codeDocuments,
  isCodeQuestion,
  renderCodeAnswer,
  toCodeCitation,
} from "@/lib/chat/codeAnswer";
import {
  attributePeople,
  isPeopleQuestion,
  isRosterQuestion,
  namesFromDocument,
  renderRoster,
} from "@/lib/chat/people";
import {
  isLlmAvailable,
  isLlmConfigured,
  llmUnavailableReason,
  noteLlmFailure,
  noteLlmSuccess,
} from "@/lib/chat/llmAvailability";
import {
  groupChunksByDocument,
  type RetrievedChunk,
  type RetrievedDocument,
} from "@/lib/chat/documents";

/**
 * The RAG core, shared by /api/chat (legacy) and /api/prompt (interactive
 * layer): retrieve from Qdrant via the Python search-api, regroup chunks into
 * whole documents, synthesize an answer grounded across ALL of them, and cite
 * every document used.
 *
 * `send` emits one SSE frame; callers own the Response/stream plumbing.
 */

export type SendFn = (obj: unknown) => void;

/**
 * When the query is scoped to specific sources we sweep wide — the point is to
 * read *every* relevant document in that source, not just the closest chunks.
 * Unscoped queries stay narrower to keep latency and token cost sane.
 */
const CHUNK_LIMIT_SCOPED = 60;
const CHUNK_LIMIT_BROAD = 20;

/** Per-source chunk budget for an unscoped question (see retrieveChunks). */
const CHUNKS_PER_SOURCE = 15;

/** How many whole documents to put in front of the model / cite back. */
const MAX_DOCS_IN_CONTEXT = 12;
const MAX_CITATIONS = 12;

/**
 * Most documents any one source may contribute to an unscoped answer. Twelve
 * slots across the sources that actually hold company knowledge beats twelve
 * slots of whichever source syncs the most.
 */
const MAX_DOCS_PER_SOURCE = 5;

/**
 * Tighter cap for email on questions that never mentioned email. The inbox is
 * two orders of magnitude larger than every other source combined and mostly
 * newsletters, so an equal share means an answer made of marketing.
 */
const MAX_EMAIL_DOCS = 2;

/**
 * Wider budgets when the question is about people. The per-source cap has to
 * rise too: it binds before `maxDocs`, so raising the total alone changes
 * nothing — the extra slots would go unfilled while colleagues stayed missing.
 */
const MAX_DOCS_PEOPLE_QUESTION = 24;
const MAX_DOCS_PER_SOURCE_PEOPLE = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stream a string as word-sized token events (used for canned/extractive text). */
export async function emitWords(s: string, send: SendFn): Promise<void> {
  for (const tok of s.split(/(\s+)/)) {
    if (tok) send({ type: "token", text: tok });
    await sleep(10);
  }
}

/**
 * Retrieve the most relevant chunks for a user's query.
 *
 * `sources` comes from explicit @-mentions when present; otherwise we infer it
 * from keywords in the prose. Either way, scoping the search stops high-volume
 * sources (email) from drowning out the source the user actually asked about.
 */
export async function retrieveChunks(
  userId: string,
  query: string,
  opts: { sources?: SourceKey[]; limit?: number } = {}
): Promise<RetrievedChunk[]> {
  const pythonUrl = process.env.PYTHON_BACKEND_URL || "http://localhost:8000";
  const scoped = opts.sources?.length ? opts.sources : detectSourceIntent(query);
  const isScoped = scoped.length > 0;
  const limit =
    opts.limit ?? (isScoped ? CHUNK_LIMIT_SCOPED : CHUNK_LIMIT_BROAD);

  // Unscoped questions ("who are the devs?") name no source, so a single
  // ranked search returns whatever source has the most documents — in
  // practice, email, every time. Ask for each source's own best chunks
  // instead and let rankDocuments decide the mix.
  const body = isScoped
    ? { query, namespace: `${userId}:*`, limit, sources: scoped }
    : {
        query,
        namespace: `${userId}:*`,
        limit,
        sources: [...SOURCE_KEYS],
        per_source_limit: CHUNKS_PER_SOURCE,
      };

  try {
    const r = await fetch(`${pythonUrl}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data?.results) ? data.results : [];
  } catch (err) {
    console.error("[rag] search backend error:", err);
    return [];
  }
}

/** A document plus its resolved provenance (title / author / link). */
export type ResolvedDocument = RetrievedDocument & {
  title: string;
  url: string | null;
  displayAuthor: string | null;
};

/**
 * Retrieve → regroup into documents → resolve each document's provenance.
 * This is the shared read path: chat answers AND brain writes both use it, so
 * a written block is grounded in exactly what the answer would have cited.
 */
export async function retrieveDocuments(
  userId: string,
  query: string,
  opts: { sources?: SourceKey[]; maxDocs?: number; perSourceCap?: number } = {}
): Promise<ResolvedDocument[]> {
  const chunks = await retrieveChunks(userId, query, { sources: opts.sources });

  // An explicitly scoped request ("@notion") may fill every slot with that
  // source — that is what the user asked for. An unscoped one is capped so no
  // single source crowds the rest out.
  const detected = detectSourceIntent(query);
  const isScoped = Boolean(opts.sources?.length || detected.length > 0);
  const emailAsked = Boolean(opts.sources?.includes("gmail") || detected.includes("gmail"));

  const docs = rankDocuments(query, groupChunksByDocument(chunks), {
    maxDocs: opts.maxDocs ?? MAX_DOCS_IN_CONTEXT,
    perSourceCap: isScoped ? undefined : (opts.perSourceCap ?? MAX_DOCS_PER_SOURCE),
    // A mailbox is mostly newsletters and receipts. It stays searchable — a
    // genuinely relevant email still ranks in — but a question that never
    // mentioned email should not come back half-answered by marketing.
    sourceCaps: isScoped || emailAsked ? undefined : { gmail: MAX_EMAIL_DOCS },
  });

  const resolved = await Promise.all(
    docs.map(async (d): Promise<ResolvedDocument | null> => {
      const meta = await resolveDocumentMeta(d.source, d.docId);
      if (!meta) return null;
      return { ...d, title: meta.title, url: meta.url, displayAuthor: meta.author };
    })
  );

  return resolved.filter((d): d is ResolvedDocument => d !== null);
}

/** Citations for a resolved document set — one per document, across sources. */
export function citationsFor(docs: ResolvedDocument[]): Citation[] {
  return docs.slice(0, MAX_CITATIONS).map((d) => ({
    source: d.source,
    title: d.title,
    author: d.displayAuthor,
    url: d.url,
    snippet: truncateWords(cleanForDisplay(d.text), 160),
  }));
}

/**
 * Answer a query end-to-end over an SSE `send`: retrieval → grounded answer
 * (Claude with extractive fallback) → citations. Returns the final answer
 * text so callers can persist it.
 */
export async function streamRagAnswer(opts: {
  userId: string;
  query: string;
  send: SendFn;
  /** "extractive" forces the no-LLM path (@extractive model mention). */
  model?: string | null;
  /** Explicit source scope from @-mentions; falls back to keyword detection. */
  sources?: SourceKey[];
}): Promise<{ answer: string; citations: Citation[] }> {
  const { userId, query, send } = opts;

  // "Who works here?" is answered by breadth, not depth — one task page per
  // person is enough, but missing a person because their page ranked 13th is a
  // wrong answer, not an incomplete one.
  // Only a roster question needs the wider sweep. An attribution question
  // ("who edited X?") wants the best match, and widening it just buries the
  // answer under everybody else's tasks.
  const wantsPeople = isPeopleQuestion(query) && isRosterQuestion(query);
  const docs = await retrieveDocuments(userId, query, {
    sources: opts.sources,
    maxDocs: wantsPeople ? MAX_DOCS_PEOPLE_QUESTION : undefined,
    perSourceCap: wantsPeople ? MAX_DOCS_PER_SOURCE_PEOPLE : undefined,
  });
  const citations = citationsFor(docs);

  let answer = "";
  const record: SendFn = (obj) => {
    if ((obj as { type?: string }).type === "token") {
      answer += (obj as { text?: string }).text ?? "";
    }
    send(obj);
  };

  if (docs.length === 0) {
    const scope = opts.sources?.length ? ` in ${opts.sources.join(", ")}` : "";
    await emitWords(
      `I couldn't find anything about that${scope} in your connected sources yet. ` +
        "Make sure the source is synced and its documents have finished processing.",
      record
    );
    send({ type: "citations", citations: [] });
    return { answer, citations: [] };
  }

  const context = buildContext(docs);

  const wantsExtractive = opts.model === "extractive";
  if (!wantsExtractive && isLlmAvailable()) {
    try {
      await streamClaude(query, context, docs, record);
      noteLlmSuccess();
    } catch (err) {
      // Claude unavailable (no credits, rate limit, outage) — degrade to
      // grounded extractive answers instead of failing the request, and stop
      // re-attempting for a cooldown so every later message isn't slowed by a
      // doomed round-trip.
      noteLlmFailure(err);
      await streamExtractive(query, docs, record);
    }
  } else {
    await streamExtractive(query, docs, record);
  }

  send({ type: "citations", citations });
  return { answer, citations };
}

/**
 * Render documents as a numbered, delimited context block. Numbering matters:
 * the model is told to cite [1], [2]... and those indices line up with the
 * citation list the UI renders.
 */
export function buildContext(docs: ResolvedDocument[]): string {
  return docs
    .map((d, i) => {
      const who = d.displayAuthor ? ` | author: ${d.displayAuthor}` : "";
      return (
        `[${i + 1}] source: ${d.source} | title: ${d.title}${who}\n` +
        `${cleanForDisplay(d.text)}`
      );
    })
    .join("\n\n---\n\n");
}

/** Generative answer via Claude, streamed token-by-token. */
async function streamClaude(
  query: string,
  context: string,
  docs: ResolvedDocument[],
  send: SendFn
) {
  const docCount = docs.length;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  const system =
    "You are CoBrain, a company knowledge assistant. Answer using ONLY the " +
    "provided context, which contains COMPLETE documents retrieved from the " +
    "user's connected sources (Notion, Gmail, GitHub, uploaded files, the Brain).\n\n" +
    "Critical rules:\n" +
    "1. ANSWER THE QUESTION THAT WAS ASKED, and only that. If the user asks who " +
    "someone is, lead with the names — do not summarise the documents they came " +
    "from. If the user asks what was decided, give the decision. Extra context " +
    "goes after the answer, never before it.\n" +
    "2. Read EVERY numbered document before answering. The answer is often spread " +
    "across several documents — do not stop at the first match.\n" +
    "3. ATTRIBUTE PEOPLE. Notion documents carry ownership as property lines " +
    "(`Assigned To:`, `Owner:`, `Created by:`) and every document header names its " +
    "author. Whenever you report a task, a decision or a standard, name the person " +
    "responsible and where that attribution came from. Never invent one — if no " +
    "document names a person, say 'Not stated'.\n" +
    "4. When the question is enumerable ('who', 'which tasks', 'what was decided'), " +
    "list every distinct item across ALL documents — one row per item, with its " +
    "owner and status.\n" +
    "5. Cite the document number(s) inline like [1] or [2][3] for each fact.\n" +
    "6. Documents from email are frequently newsletters and marketing. Do not treat " +
    "them as company knowledge unless the question is about email.\n" +
    "7. If different documents disagree or overlap, say so explicitly.\n" +
    "8. If the context genuinely does not contain the answer, say so plainly rather " +
    "than guessing. Never invent names, dates or owners.\n" +
    "Be concise and direct — structure over prose.";

  // Hand the model the ownership map we already parsed deterministically, so
  // attribution is a given fact rather than something it has to infer from
  // property lines scattered through the context.
  const people = attributePeople(docs);
  const roster = people.length
    ? `\nPeople named in these documents (parsed from ownership fields — treat as ` +
      `authoritative):\n` +
      people.map((p) => `- ${p.name}: ${p.items.join("; ") || "no items"}`).join("\n") +
      `\n`
    : "";

  const llmStream = client.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 2000,
    system,
    messages: [
      {
        role: "user",
        content:
          `Here are ${docCount} complete document(s) retrieved from the user's sources:\n\n` +
          `${context}\n${roster}\n` +
          `Question: ${query}\n\n` +
          `Answer exactly what was asked, name the people responsible, and cite [n].`,
      },
    ],
  });

  for await (const event of llmStream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      send({ type: "token", text: event.delta.text });
    }
  }
}

/**
 * No-LLM fallback: answer from the retrieved documents, grounded + cited.
 *
 * This used to dump the first six passages regardless of what was asked, which
 * is a search result, not an answer. It now reads the question: an explicitly
 * people-shaped question ("who are the devs?") is answered from the ownership
 * fields our extractors emit, which is exact and needs no model. Everything
 * else still gets passages — but with the roster appended, because "who is
 * involved" is useful context for almost any company question.
 */
async function streamExtractive(
  query: string,
  docs: ResolvedDocument[],
  send: SendFn
) {
  // A code question wants the file, not a description of the file. Answer it
  // with the source itself before falling through to passage quoting.
  const codeDocs = codeDocuments(docs);
  if (isCodeQuestion(query) && codeDocs.length > 0) {
    await emitWords(
      renderCodeAnswer(codeDocs.slice(0, 3).map(toCodeCitation)) + "\n\n",
      send
    );
    await emitWords(codeFooter(), send);
    return;
  }

  const people = attributePeople(docs);
  const peopleAsked = isPeopleQuestion(query) && people.length > 0;
  const rosterAsked = peopleAsked && isRosterQuestion(query);

  // Documents are rank-ordered, so the best match is the answer to an
  // attribution question — not a roll-call of everyone in the result set.
  const credited = docs
    .map((d) => ({
      doc: d,
      names: [
        ...new Set(
          namesFromDocument(d)
            .filter((n) => n.evidence === "ownership")
            .map((n) => n.name)
        ),
      ],
    }))
    .filter((x) => x.names.length > 0);

  // --- "Who edited X?" — one line, the name and where it is stated. ---
  if (peopleAsked && !rosterAsked && credited.length > 0) {
    const top = credited[0];
    await emitWords(`**${top.names.join(", ")}** — credited on ${top.doc.title}.
`, send);

    if (credited.length > 1) {
      const others = credited
        .slice(1, 3)
        .map((c) => `${c.names.join(", ")} (${c.doc.title})`)
        .join(", ");
      await emitWords(`
Also credited nearby: ${others}.
`, send);
    }
    await emitWords(synthesisNote(), send);
    return;
  }

  // --- "Who are the devs?" — the roster, and nothing else. ---
  if (peopleAsked) {
    await emitWords(`${renderRoster(people)}
`, send);
    await emitWords(synthesisNote(), send);
    return;
  }

  // --- Everything else — the passages that answer it, quietly attributed. ---
  //
  // No "here's what I found across N documents" preamble and no [n] markers:
  // the source cards under the message already list and number every document,
  // so repeating them in the body is duplication the reader has to skim past.
  let shown = 0;
  for (const d of docs) {
    if (shown >= 3) break;
    const text = cleanForDisplay(d.text);
    if (text.length < 40) continue;

    const owners = [
      ...new Set(
        namesFromDocument(d)
          .filter((n) => n.evidence === "ownership")
          .map((n) => n.name)
      ),
    ];
    const by = owners.length
      ? ` — ${owners.join(", ")}`
      : d.displayAuthor
        ? ` — ${d.displayAuthor}`
        : "";

    // Quote the part that answers the question, not the opening paragraph.
    const passage = bestExcerpt(query, text, 420);
    await emitWords(
      `**${d.title}**${by}

${truncateWords(passage, 460)}

`,
      send
    );
    shown++;
  }

  if (shown === 0) {
    await emitWords(
      "The matching documents are mostly links and metadata — open the sources below to read them directly.\n",
      send
    );
  }

  await emitWords(synthesisNote(), send);
}

/**
 * One quiet line explaining why the answer was assembled rather than written.
 *
 * Kept to a single sentence: the reason matters — "unavailable" with no cause
 * is the kind of message that generates a support ticket — but it is a footnote
 * to the answer, not part of it.
 */
function synthesisNote(): string {
  const reason = llmUnavailableReason();
  if (!isLlmConfigured()) {
    return "\n_Quoted directly from your sources — add an ANTHROPIC_API_KEY to enable written answers._";
  }
  return reason
    ? `\n_Quoted directly from your sources — AI synthesis is paused (${reason})._`
    : "\n_Quoted directly from your sources — AI synthesis is temporarily unavailable._";
}

/**
 * Footer for a code answer.
 *
 * Deliberately different from the extractive footer: the code IS the answer,
 * quoted verbatim from the repository, so there is nothing degraded about it
 * and apologising for missing synthesis would be misleading.
 */
function codeFooter(): string {
  return "_Source shown verbatim from your indexed repository._";
}

/**
 * Resolve a document id back to its source-of-truth record: title, author and
 * a link the user can open. Returns null when the record is gone (e.g. the
 * connector was disconnected but the vectors linger).
 */
export async function resolveDocumentMeta(
  source: string,
  docId: string
): Promise<{ title: string; author: string | null; url: string | null } | null> {
  try {
    switch (source) {
      case "gmail": {
        const e = await prisma.email.findUnique({ where: { id: docId } });
        if (!e) return null;
        return {
          title: e.subject || "(no subject)",
          author: e.from || null,
          url: e.gmailMessageId
            ? `https://mail.google.com/mail/u/0/#all/${e.gmailMessageId}`
            : null,
        };
      }
      case "notion": {
        const p = await prisma.notionPage.findUnique({ where: { id: docId } });
        if (!p) return null;
        return {
          title: p.title || "(untitled page)",
          author: p.createdByName || null,
          url: p.url || null,
        };
      }
      case "github": {
        const g = await prisma.gitHubItem.findUnique({ where: { id: docId } });
        if (!g) return null;
        return { title: g.title || "(untitled)", author: g.author || null, url: g.url || null };
      }
      case "custom": {
        const d = await prisma.customDocument.findUnique({ where: { id: docId } });
        if (!d) return null;
        return {
          title: d.externalId ? `Document ${d.externalId}` : "Custom document",
          author: null,
          url: null,
        };
      }
      case "brain": {
        const b = await prisma.brainBlock.findUnique({ where: { id: docId } });
        if (!b) return null;
        return {
          title: b.title,
          author: b.createdBy === "ai" ? "CoBrain AI" : "You",
          url: `/brain?block=${b.id}`,
        };
      }
      case "upload": {
        const f = await prisma.sourceFile.findUnique({ where: { id: docId } });
        if (!f) return null;
        return {
          title: f.fileName,
          author: null,
          url: `/api/sources/${f.id}/download`,
        };
      }
      default:
        return null;
    }
  } catch (err) {
    console.error(`[rag] document lookup failed (${source}:${docId}):`, err);
    return null;
  }
}

/**
 * Legacy helper kept for /api/chat: resolve raw chunks straight to citations.
 * New callers should prefer retrieveDocuments + citationsFor.
 */
export async function buildCitations(results: RetrievedChunk[]): Promise<Citation[]> {
  const docs = groupChunksByDocument(results).slice(0, MAX_CITATIONS);
  const cites: Citation[] = [];

  for (const d of docs) {
    const meta = await resolveDocumentMeta(d.source, d.docId);
    if (!meta) continue;
    cites.push({
      source: d.source,
      title: meta.title,
      author: meta.author,
      url: meta.url,
      snippet: truncateWords(cleanForDisplay(d.text), 160),
    });
  }
  return cites;
}

/**
 * Chunk → document regrouping.
 *
 * Qdrant returns individual chunks ranked by similarity. Answering a question
 * like "who was assigned a task across my Notion pages?" from a flat top-k of
 * chunks gives a single narrow answer, because several chunks of one chatty
 * document crowd out the other documents entirely.
 *
 * So we regroup: collapse chunks back into the documents they came from,
 * reassemble each document's text in chunk order, and rank documents by their
 * best-matching chunk. The synthesis step then sees N distinct documents and
 * can enumerate across all of them.
 *
 * Pure module — no I/O, unit-tested in isolation.
 */

export type RetrievedChunk = {
  text: string;
  source: string;
  author?: string;
  timestamp?: string;
  chunk_index?: number;
  total_chunks?: number;
  parent_doc_id: string;
  content_hash?: string;
  score?: number;

  /**
   * Content-kind metadata from the connector ("code", "commit", "discussion",
   * "issue", "pr"). A code chunk needs its file path and language to be shown
   * as a file rather than quoted as anonymous text.
   */
  kind?: string | null;
  path?: string | null;
  language?: string | null;
  start_line?: number | null;
  repository?: string | null;
  url?: string | null;
};

export type RetrievedDocument = {
  docId: string;
  source: string;
  author: string;
  timestamp: string;
  /** Chunks that matched, in document order. */
  chunks: RetrievedChunk[];
  /** Highest similarity score among this document's chunks. */
  bestScore: number;
  /** Matched chunks reassembled in document order. */
  text: string;

  /** Content kind, when the connector supplied one ("code", "commit", …). */
  kind?: string | null;
  /** Repository-relative file path, for code documents. */
  path?: string | null;
  /** Fence label for syntax highlighting, for code documents. */
  language?: string | null;
  repository?: string | null;
  /** Line where the best-matching chunk starts. */
  startLine?: number | null;
};

/**
 * Collapse ranked chunks into ranked documents.
 * Documents are ordered by their best chunk score (descending).
 */
export function groupChunksByDocument(chunks: RetrievedChunk[]): RetrievedDocument[] {
  const byDoc = new Map<string, RetrievedChunk[]>();

  for (const c of chunks) {
    const id = c?.parent_doc_id;
    if (!id) continue;
    const bucket = byDoc.get(id);
    if (bucket) bucket.push(c);
    else byDoc.set(id, [c]);
  }

  const docs: RetrievedDocument[] = [];

  for (const [docId, group] of byDoc) {
    // Document order, not relevance order — the text should read naturally.
    const ordered = [...group].sort(
      (a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0)
    );

    // Identical chunk text can arrive twice (re-ingested doc, same content).
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const c of ordered) {
      const t = (c.text ?? "").trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      parts.push(t);
    }

    const best = group.reduce((m, c) => Math.max(m, c.score ?? 0), 0);
    const head = ordered[0];

    docs.push({
      docId,
      source: (head.source || "").toLowerCase(),
      author: head.author ?? "",
      timestamp: head.timestamp ?? "",
      chunks: ordered,
      bestScore: best,
      text: parts.join("\n\n"),
      // Kind metadata is a property of the document, not of one chunk — every
      // chunk of a file carries the same path and language.
      kind: head.kind ?? null,
      path: head.path ?? null,
      language: head.language ?? null,
      repository: head.repository ?? null,
      // The best-matching chunk's line, so a citation points at the part of the
      // file that answered the question rather than at line 1.
      startLine:
        group.reduce<RetrievedChunk | null>(
          (bestChunk, c) =>
            (c.score ?? 0) > (bestChunk?.score ?? -1) ? c : bestChunk,
          null
        )?.start_line ?? null,
    });
  }

  return docs.sort((a, b) => b.bestScore - a.bestScore);
}

/** Distinct sources present in a document set, ordered by best score. */
export function sourcesPresent(docs: RetrievedDocument[]): string[] {
  return [...new Set(docs.map((d) => d.source).filter(Boolean))];
}

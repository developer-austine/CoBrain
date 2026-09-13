import type { RetrievedDocument } from "./documents";

/**
 * Cross-source document ranking.
 *
 * Vector similarity alone answers the wrong question here. Two things break it:
 *
 *   1. VOLUME. Similarity search is a popularity contest that volume wins. An
 *      inbox with 68,000 chunks will out-populate 17 Notion pages at every
 *      score threshold, so "who are the devs?" returns newsletters. Capping how
 *      many documents any one source may contribute fixes this structurally —
 *      no threshold tuning that breaks on the next sync.
 *
 *   2. TITLES. A 384-dimension MiniLM embedding does not reliably rank a page
 *      literally titled "Coding Best Practices & Standards" above a marketing
 *      email about the "best coding model in the world". Exact term overlap —
 *      especially in the title — is strong evidence a human would call obvious,
 *      so it gets an explicit boost rather than being left to the embedding.
 *
 * Pure module — no I/O, unit-tested in isolation.
 */

/** Words too common to carry retrieval signal. */
const STOP_WORDS = new Set([
  "a", "about", "all", "an", "and", "any", "are", "as", "at", "be", "been", "but",
  "by", "can", "did", "do", "does", "for", "from", "get", "give", "had", "has",
  "have", "how", "i", "in", "is", "it", "its", "just", "list", "made", "make",
  "me", "my", "of", "on", "or", "our", "out", "show", "so", "tell", "that",
  "the", "their", "them", "there", "these", "they", "this", "to", "up", "us",
  "was", "we", "were", "what", "when", "where", "which", "who", "whom", "why",
  "will", "with", "would", "you", "your",
]);

/** Content-bearing terms in a query, lowercased and de-duplicated. */
export function queryTerms(query: string): string[] {
  const raw = (query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  return [...new Set(raw)];
}

/**
 * The document's own heading, or "" when it does not have one.
 *
 * Returning "" matters as much as returning a title. Our extractors emit an
 * explicit `# Title` line, but an email chunk begins wherever the chunker cut
 * the body — mid-sentence, usually. Treating that first line as a heading hands
 * newsletter prose the same weight as a real page title, which is precisely how
 * "coding best practices" used to rank two marketing emails above the page
 * called "Coding Best Practices & Standards".
 *
 * A line qualifies if it is marked as a heading, or if it reads like one: short
 * and not a sentence.
 */
export function documentHeading(text: string): string {
  const firstLine = (text || "").split("\n").find((l) => l.trim()) ?? "";
  const trimmed = firstLine.trim();

  if (/^#+\s/.test(trimmed)) return trimmed.replace(/^#+\s*/, "").trim();

  const looksLikeATitle = trimmed.length > 0 && trimmed.length <= 80 && !/\.\s/.test(trimmed);
  return looksLikeATitle ? trimmed : "";
}

/**
 * Levenshtein distance, abandoned as soon as it exceeds `max`.
 *
 * Bounded because we only care about near-misses: a user typing "practises"
 * should still find a page titled "Practices", but "coding" must never match
 * "coping". The early exit also keeps this cheap enough to run per term per
 * document.
 */
export function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  if (a === b) return true;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const d = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      curr.push(d);
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return false; // every path already too expensive
    prev = curr;
  }
  return prev[b.length] <= max;
}

/** Does `term` appear among `tokens`, allowing a typo on longer words? */
function matchesToken(term: string, tokens: string[]): boolean {
  if (tokens.includes(term)) return true;
  // Only forgive spelling on words long enough that an edit is unlikely to
  // collide with a genuinely different word.
  if (term.length < 6) return false;
  return tokens.some((t) => t.length >= 6 && editDistanceWithin(term, t, 1));
}

/**
 * Lexical bonus added to a document's vector score.
 *
 * The heading is weighted heavily and the body barely at all, because they are
 * different kinds of evidence: a page *titled* "Coding Best Practices" is what
 * someone asking about coding best practices wants, whereas a newsletter that
 * merely says "coding" and "best" somewhere in its body is a coincidence. Left
 * to cosine similarity alone the newsletter wins, because it is longer and
 * chattier.
 *
 * Still bounded — a full title match adds +0.5, enough to overturn a plausible
 * score gap but not enough to promote a document the embedding found
 * irrelevant.
 */
export function lexicalBoost(query: string, doc: { text: string }): number {
  const terms = queryTerms(query);
  if (terms.length === 0) return 0;

  const headingTokens = documentHeading(doc.text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const body = (doc.text || "").toLowerCase();

  let headingHits = 0;
  let bodyHits = 0;
  for (const term of terms) {
    if (matchesToken(term, headingTokens)) headingHits++;
    else if (body.includes(term)) bodyHits++;
  }

  const headingRatio = headingHits / terms.length;
  const bodyRatio = bodyHits / terms.length;
  return headingRatio * 0.5 + bodyRatio * 0.1;
}

/**
 * The passage of a document that actually addresses the question.
 *
 * Quoting a document's opening is only right when the answer happens to be at
 * the top. Ask "who edited the coding standards?" and the answer is the sign-off
 * on the last line — a fixed prefix shows the introduction and cuts off before
 * reaching it. This scores each line by query-term overlap and returns the
 * densest window, always keeping the heading for context.
 */
export function bestExcerpt(query: string, text: string, maxChars: number): string {
  const clean = (text || "").trim();
  if (clean.length <= maxChars) return clean;

  const terms = queryTerms(query);
  const lines = clean.split("\n").filter((l) => l.trim());
  if (terms.length === 0 || lines.length <= 1) return clean.slice(0, maxChars);

  const heading = /^#+\s/.test(lines[0]) ? lines[0].replace(/^#+\s*/, "").trim() : "";
  const body = heading ? lines.slice(1) : lines;

  const hits = body.map((line) => {
    const l = line.toLowerCase();
    return terms.reduce((n, t) => n + (l.includes(t) ? 1 : 0), 0);
  });

  // Widest window that fits the budget, chosen by total term hits.
  let bestStart = 0;
  let bestScore = -1;
  for (let start = 0; start < body.length; start++) {
    let chars = 0;
    let score = 0;
    for (let i = start; i < body.length; i++) {
      const next = chars + body[i].length + 1;
      if (next > maxChars && i > start) break;
      chars = next;
      score += hits[i];
    }
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }

  const picked: string[] = [];
  let chars = 0;
  for (let i = bestStart; i < body.length; i++) {
    const next = chars + body[i].length + 1;
    if (next > maxChars && picked.length > 0) break;
    picked.push(body[i]);
    chars = next;
  }

  const ellipsis = bestStart > 0 ? "… " : "";
  const passage = `${ellipsis}${picked.join(" ")}`;
  return heading ? `${heading} — ${passage}` : passage;
}

export type RankedDocument = RetrievedDocument & {
  /** bestScore + lexicalBoost — what the ordering actually used. */
  rankScore: number;
};

export type RankOptions = {
  /** Max documents returned overall. */
  maxDocs: number;
  /**
   * Max documents any single source may contribute. Only applied when the
   * caller did NOT scope the search — an explicit "@notion" request should be
   * allowed to fill the whole result set with Notion.
   */
  perSourceCap?: number;
  /**
   * Per-source overrides of `perSourceCap`. Used to keep high-volume, low-signal
   * sources (a newsletter-heavy inbox) present but minority.
   */
  sourceCaps?: Record<string, number>;
};

/**
 * Re-rank grouped documents: lexical boost, drop duplicates, then interleave
 * so no single source monopolises the result set.
 */
export function rankDocuments(
  query: string,
  docs: RetrievedDocument[],
  opts: RankOptions
): RankedDocument[] {
  const scored: RankedDocument[] = docs.map((d) => ({
    ...d,
    rankScore: d.bestScore + lexicalBoost(query, d),
  }));

  scored.sort((a, b) => b.rankScore - a.rankScore);

  // The same newsletter delivered twice is two documents with identical text.
  // Keeping both wastes a slot and makes the answer look padded.
  const seenText = new Set<string>();
  const deduped = scored.filter((d) => {
    const key = d.text.trim().slice(0, 400);
    if (!key) return false;
    if (seenText.has(key)) return false;
    seenText.add(key);
    return true;
  });

  if (!opts.perSourceCap) return deduped.slice(0, opts.maxDocs);

  // Round-robin by source: take each source's best, then its second-best, and
  // so on. A source with one great document still places it near the top, and
  // a source with thousands cannot bury everyone else.
  const bySource = new Map<string, RankedDocument[]>();
  for (const d of deduped) {
    const bucket = bySource.get(d.source);
    if (bucket) bucket.push(d);
    else bySource.set(d.source, [d]);
  }

  const capFor = (source: string) => opts.sourceCaps?.[source] ?? opts.perSourceCap ?? 0;

  const picked: RankedDocument[] = [];
  const maxRounds = Math.max(
    opts.perSourceCap,
    ...Object.values(opts.sourceCaps ?? {}),
  );
  for (let round = 0; round < maxRounds; round++) {
    for (const [source, bucket] of bySource) {
      if (round >= capFor(source)) continue;
      const next = bucket[round];
      if (next) picked.push(next);
    }
  }

  return picked.sort((a, b) => b.rankScore - a.rankScore).slice(0, opts.maxDocs);
}

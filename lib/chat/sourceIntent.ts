/**
 * Source-intent detection for retrieval.
 *
 * The vector store mixes every connector together, so a naive similarity
 * search is dominated by whichever source has the most documents (usually
 * email). When a user names a source in their question — "what tasks were
 * assigned in notion?" — they want results FROM that source, not emails that
 * merely mention it. This module maps a query to the set of sources it refers
 * to; retrieval then restricts the search to those sources.
 *
 * Rule of thumb (per product intent): email/gmail is only searched when the
 * user explicitly asks for it. Naming any other source excludes email unless
 * email is named too.
 *
 * Pure module — unit-tested in isolation, no I/O.
 */

/** Canonical source keys, matching the `source` payload field in Qdrant. */
export const SOURCE_KEYS = [
  "gmail",
  "notion",
  "github",
  "slack",
  "drive",
  "upload",
  "brain",
  "custom",
] as const;

export type SourceKey = (typeof SOURCE_KEYS)[number];

/** Type guard: is this arbitrary id one of our canonical sources? */
export function isSourceKey(id: string): id is SourceKey {
  return (SOURCE_KEYS as readonly string[]).includes(id);
}

/**
 * Keyword → source map. Single words are matched on word boundaries;
 * multi-word phrases are matched as substrings. Keep entries lowercase.
 */
const SOURCE_KEYWORDS: Record<SourceKey, string[]> = {
  gmail: ["email", "emails", "e-mail", "e-mails", "gmail", "mail", "mails", "inbox"],
  notion: ["notion", "page", "pages", "wiki"],
  github: [
    "github",
    "git",
    "code",
    "codes",
    "repo",
    "repos",
    "repository",
    "repositories",
    "pr",
    "prs",
    "pull request",
    "pull requests",
    "issue",
    "issues",
    "commit",
    "commits",
  ],
  slack: ["slack", "channel", "channels"],
  drive: ["drive", "google drive", "gdrive", "google docs", "spreadsheet", "spreadsheets", "sheet", "sheets"],
  upload: [
    "upload",
    "uploads",
    "uploaded",
    "file",
    "files",
    "document",
    "documents",
    "attachment",
    "attachments",
    "pdf",
    "pdfs",
  ],
  brain: ["brain", "memory", "memories", "knowledge base"],
  custom: ["webhook", "webhooks"],
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True if `keyword` appears in `haystack` (word-boundary for single words). */
function keywordMatches(haystack: string, keyword: string): boolean {
  if (keyword.includes(" ") || keyword.includes("-")) {
    // Phrases / hyphenated terms: plain substring is good enough and avoids
    // brittle boundary rules around punctuation.
    return haystack.includes(keyword);
  }
  return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i").test(haystack);
}

/**
 * Detect which sources a query is asking about. Returns canonical source keys
 * in a stable order, or an empty array when the query names no source (caller
 * should then search everything).
 */
export function detectSourceIntent(query: string): SourceKey[] {
  const q = query.toLowerCase();
  const found: SourceKey[] = [];

  for (const source of Object.keys(SOURCE_KEYWORDS) as SourceKey[]) {
    const keywords = SOURCE_KEYWORDS[source];
    if (keywords.some((kw) => keywordMatches(q, kw))) {
      found.push(source);
    }
  }

  return found;
}

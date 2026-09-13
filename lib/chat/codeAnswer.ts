import type { RetrievedDocument } from "./documents";

/**
 * Answering "where in the code is X?".
 *
 * A code question has a different shape of answer from every other question in
 * the product. The user does not want a paraphrase of the code — they want the
 * file path and the code itself, laid out the way an editor lays it out. So the
 * answer leads with the path, renders the matched region in a fenced block
 * tagged with its language, and links to the exact line on GitHub.
 *
 * Pure module — no I/O, unit-tested in isolation.
 */

/**
 * Signals that the user is asking about the codebase rather than about
 * documents that happen to discuss it.
 *
 * "Where do we load the RAG pipeline?" is a code question. "What did we decide
 * about the RAG pipeline?" is not — that one wants the Notion decision page.
 * The distinguishing signal is a locational or implementation verb, not the
 * mere presence of a technical noun.
 */
const CODE_INTENT =
  /\b(where|which file|what file|show me the (code|file|function|class)|implementation|implemented|defined|declared|source code|code ?base|in the (repo|repository|code)|function|method|class|module|import|export)\b/i;

const CODE_NOUNS =
  /\b(code|file|function|method|class|module|component|endpoint|route|handler|config|schema|test|script|api|pipeline|repo|repository)\b/i;

/** Is this a question about the codebase itself? */
export function isCodeQuestion(query: string): boolean {
  const q = query || "";
  // Both a locational/implementation signal AND a code-ish noun. Either alone
  // is too loose: "where is the office" and "what is our deployment policy"
  // would both match a single-signal test.
  return CODE_INTENT.test(q) && CODE_NOUNS.test(q);
}

export type CodeCitation = {
  path: string;
  language: string;
  repository: string | null;
  startLine: number | null;
  url: string | null;
  code: string;
};

/** Documents that are actually source files, best match first. */
export function codeDocuments(docs: RetrievedDocument[]): RetrievedDocument[] {
  return docs.filter((d) => d.kind === "code" && Boolean(d.path));
}

/**
 * Strip the header our indexer prepends before embedding.
 *
 * `embeddableText` adds a `# path` + metadata preamble so the path is
 * searchable. That preamble is an artefact of retrieval — showing it back to
 * the user as if it were part of their source file would be wrong.
 */
export function stripIndexHeader(text: string): string {
  const lines = (text || "").split("\n");
  if (!lines[0]?.startsWith("# ")) return text;

  let i = 1;
  if (lines[i]?.startsWith("repository:")) i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  return lines.slice(i).join("\n");
}

/** Turn a retrieved code document into something renderable. */
export function toCodeCitation(doc: RetrievedDocument): CodeCitation {
  const path = doc.path ?? "unknown";
  const line = doc.startLine ?? null;
  const repo = doc.repository ?? null;

  return {
    path,
    language: doc.language ?? "text",
    repository: repo,
    startLine: line,
    url: repo
      ? `https://github.com/${repo}/blob/HEAD/${path}${line ? `#L${line}` : ""}`
      : null,
    code: stripIndexHeader(doc.text).trimEnd(),
  };
}

/**
 * Render code answers as Markdown.
 *
 * The fence carries the language so the chat renderer can highlight it, and the
 * path is stated above the fence rather than inside it — a path inside the
 * block would be copied along with the code.
 */
export function renderCodeAnswer(citations: CodeCitation[]): string {
  if (citations.length === 0) return "";

  const blocks = citations.map((c) => {
    const where = c.startLine ? `${c.path}:${c.startLine}` : c.path;
    const link = c.url ? ` — [open on GitHub](${c.url})` : "";
    return `**\`${where}\`**${link}\n\n\`\`\`${c.language}\n${c.code}\n\`\`\``;
  });

  const lead =
    citations.length === 1
      ? `Found it in \`${citations[0].path}\`:`
      : `Found it across ${citations.length} files:`;

  return `${lead}\n\n${blocks.join("\n\n")}`;
}

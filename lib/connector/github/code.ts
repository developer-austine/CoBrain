/**
 * Turning a repository into searchable knowledge.
 *
 * Code is not prose, and chunking it like prose is what makes "where do we load
 * the RAG pipeline?" fail. A fixed-size character split cuts through the middle
 * of a function, so the chunk that matches the question contains a signature
 * with no body, or a body with no name. LangChain's language-aware splitter
 * separates on real boundaries first — `class `, `function `, `def `, `func ` —
 * and only falls back to character position when a single unit is genuinely too
 * large. That is the whole reason LangChain is in this path.
 *
 * Pure module apart from the splitter itself: unit-tested in isolation.
 */

import type { SupportedTextSplitterLanguage } from "@langchain/textsplitters";

/** Extension → the language the splitter should reason about. */
const LANGUAGE_BY_EXTENSION: Record<string, SupportedTextSplitterLanguage> = {
  // TypeScript has no dedicated profile; the JS separators (`function `,
  // `class `, `const `) are the same tokens, so it splits correctly.
  ts: "js",
  tsx: "js",
  js: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  py: "python",
  go: "go",
  java: "java",
  rb: "ruby",
  rs: "rust",
  php: "php",
  scala: "scala",
  swift: "swift",
  sol: "sol",
  proto: "proto",
  c: "cpp",
  h: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  md: "markdown",
  mdx: "markdown",
  rst: "rst",
  html: "html",
  tex: "latex",
};

/**
 * Text files worth indexing that have no language profile. They still carry
 * answers ("what's in the compose file?"), they just split as plain text.
 */
const PLAIN_TEXT_EXTENSIONS = new Set([
  "txt", "json", "yaml", "yml", "toml", "ini", "cfg", "conf", "env",
  "sql", "sh", "bash", "zsh", "ps1", "dockerfile", "gradle", "properties",
  "css", "scss", "less", "graphql", "gql", "prisma", "vue", "svelte",
]);

/**
 * Paths that cost tokens and return nothing. Lockfiles and vendored trees are
 * the big ones: `pnpm-lock.yaml` alone can outweigh the entire source tree, and
 * no one has ever asked a question whose answer is in it.
 */
const EXCLUDED_PATH = new RegExp(
  [
    "(^|/)node_modules/",
    "(^|/)\\.git/",
    "(^|/)\\.next/",
    "(^|/)dist/",
    "(^|/)build/",
    "(^|/)out/",
    "(^|/)coverage/",
    "(^|/)vendor/",
    "(^|/)__pycache__/",
    "(^|/)\\.venv/",
    "(^|/)venv/",
    "(^|/)target/",
    "(^|/)generated/",
    "(^|/)migrations?/",
    "\\.min\\.(js|css)$",
    "\\.(lock|lockb)$",
    "(^|/)(package-lock\\.json|pnpm-lock\\.yaml|yarn\\.lock|poetry\\.lock|Cargo\\.lock|Gemfile\\.lock|composer\\.lock)$",
    "\\.(png|jpe?g|gif|svg|ico|webp|bmp|pdf|zip|gz|tar|jar|war|so|dylib|dll|exe|bin|wasm|woff2?|ttf|eot|mp[34]|mov|avi)$",
    "\\.(snap|map)$",
  ].join("|"),
  "i"
);

/** A blob bigger than this is generated, minified or a data dump. */
export const MAX_INDEXABLE_BYTES = 200_000;

/** Basename → language for files that carry no extension at all. */
const LANGUAGE_BY_FILENAME: Record<string, SupportedTextSplitterLanguage | "text"> = {
  dockerfile: "text",
  makefile: "text",
  procfile: "text",
  readme: "markdown",
};

function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * The language to split this file as, or null when it should not be indexed.
 * "text" means indexable with no language profile.
 */
export function languageFor(path: string): SupportedTextSplitterLanguage | "text" | null {
  if (EXCLUDED_PATH.test(path)) return null;

  const ext = extensionOf(path);
  if (ext && LANGUAGE_BY_EXTENSION[ext]) return LANGUAGE_BY_EXTENSION[ext];
  if (ext && PLAIN_TEXT_EXTENSIONS.has(ext)) return "text";

  if (!ext) {
    const base = (path.split("/").pop() ?? "").toLowerCase();
    if (LANGUAGE_BY_FILENAME[base]) return LANGUAGE_BY_FILENAME[base];
  }
  return null;
}

/** Should this tree entry be fetched and indexed at all? */
export function shouldIndex(entry: { path: string; size: number }): boolean {
  if (entry.size > MAX_INDEXABLE_BYTES) return false;
  if (entry.size === 0) return false;
  return languageFor(entry.path) !== null;
}

/** The fence label the chat UI uses for syntax highlighting. */
export function fenceLanguageFor(path: string): string {
  const ext = extensionOf(path);
  const direct: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
    rs: "rust", go: "go", java: "java", php: "php", cs: "csharp",
    kt: "kotlin", swift: "swift", scala: "scala", sh: "bash",
    bash: "bash", zsh: "bash", ps1: "powershell", sql: "sql",
    yml: "yaml", yaml: "yaml", json: "json", toml: "toml",
    css: "css", scss: "scss", html: "html", md: "markdown",
    prisma: "prisma", graphql: "graphql", gql: "graphql",
    vue: "vue", svelte: "svelte", c: "c", h: "c", cpp: "cpp", hpp: "cpp",
  };
  return direct[ext] ?? "text";
}

export type CodeChunk = {
  path: string;
  language: string;
  /** 1-based index of this chunk within the file. */
  index: number;
  total: number;
  text: string;
  /** 1-based line where this chunk starts, so citations can deep-link. */
  startLine: number;
};

/**
 * Split one file into retrievable chunks.
 *
 * Each chunk is prefixed with its path and line range. Without that header a
 * retrieved chunk is an anonymous fragment of code — the model can quote it but
 * cannot tell the user which file to open, which is the entire point of the
 * question "where in the repo is X".
 */
export async function chunkFile(
  path: string,
  content: string,
  opts: { chunkSize?: number; chunkOverlap?: number } = {}
): Promise<CodeChunk[]> {
  const language = languageFor(path);
  if (!language) return [];

  const { RecursiveCharacterTextSplitter } = await import("@langchain/textsplitters");
  const chunkSize = Math.max(opts.chunkSize ?? 1200, 50);
  // The splitter throws when overlap >= size. A caller choosing a small chunk
  // size is legitimate, so scale the overlap down to fit rather than letting a
  // valid-looking config blow up mid-sync.
  const chunkOverlap = Math.min(opts.chunkOverlap ?? 150, Math.floor(chunkSize / 4));

  const splitter =
    language === "text"
      ? new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap })
      : RecursiveCharacterTextSplitter.fromLanguage(language, { chunkSize, chunkOverlap });

  const pieces = await splitter.splitText(content);
  const fence = fenceLanguageFor(path);

  // Line numbers are recovered by locating each piece in the original file.
  // Splitters may trim whitespace, so search from the previous match forward
  // and fall back to the running line count when a piece cannot be located.
  let cursor = 0;
  let line = 1;

  return pieces.map((text, i) => {
    const at = content.indexOf(text.slice(0, 80), cursor);
    if (at >= 0) {
      line += countNewlines(content.slice(cursor, at));
      cursor = at;
    }
    const startLine = line;
    line += countNewlines(text);
    cursor += text.length;

    return {
      path,
      language: fence,
      index: i + 1,
      total: pieces.length,
      text,
      startLine,
    };
  });
}

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * The text actually embedded for a chunk.
 *
 * The path goes into the embedded text on purpose: a question like "where do we
 * load the RAG pipeline" contains words that appear in the *path*
 * (`lib/chat/rag.ts`) more reliably than in the code body, and an embedding of
 * the body alone cannot match them.
 */
export function embeddableText(repo: string, chunk: CodeChunk): string {
  const range = `L${chunk.startLine}`;
  return (
    `# ${chunk.path}\n` +
    `repository: ${repo} | language: ${chunk.language} | ${range} | ` +
    `part ${chunk.index}/${chunk.total}\n\n` +
    chunk.text
  );
}

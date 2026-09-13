/**
 * Markdown block parser for assistant messages.
 *
 * The chat previously rendered raw text with only `**bold**` handled, so every
 * table arrived as a wall of `| Person | Items |` pipes, every heading kept its
 * `##`, and every list kept its leading dash. The answer content was right and
 * it read like a debug dump.
 *
 * This is deliberately a small parser rather than a full CommonMark
 * implementation: assistant output uses a narrow, predictable subset, and a
 * parser we own keeps @-mention chips and the VS Code code block working
 * without fighting a general-purpose renderer's escaping.
 *
 * Pure module — no JSX, no I/O, unit-tested in isolation.
 */

export type MdBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "quote"; text: string }
  | { type: "rule" }
  | { type: "code"; code: string; language: string; path: string | null; startLine: number | null; url: string | null };

const HEADING = /^(#{1,3})\s+(.*)$/;
const RULE = /^\s*(?:---+|\*\*\*+|___+)\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_DIVIDER = /^\s*\|?[\s:-]*[-]{2,}[\s:|-]*\|?\s*$/;

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((c) => c.trim());
}

/** Pull the fenced blocks out first so their contents are never parsed as markdown. */
function extractFences(text: string): { segments: string[]; fences: Map<number, MdBlock> } {
  const fences = new Map<number, MdBlock>();
  const segments: string[] = [];

  const pattern =
    /(?:\*\*`([^`]+)`\*\*(?:[^\n]*?\[open on GitHub\]\(([^)]+)\))?[^\n]*\n+)?```([\w+-]*)\n([\s\S]*?)```/g;

  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    segments.push(text.slice(last, at));

    const header = m[1] ?? null;
    let path: string | null = header;
    let startLine: number | null = null;
    if (header) {
      const withLine = header.match(/^(.*):(\d+)$/);
      if (withLine) {
        path = withLine[1];
        startLine = Number(withLine[2]);
      }
    }

    fences.set(segments.length, {
      type: "code",
      code: m[4] ?? "",
      language: m[3] || "text",
      path,
      startLine,
      url: m[2] ?? null,
    });
    segments.push(""); // placeholder slot the fence occupies
    last = at + m[0].length;
  }
  segments.push(text.slice(last));

  return { segments, fences };
}

/** Parse one fence-free segment into blocks. */
function parseSegment(text: string): MdBlock[] {
  const lines = text.split("\n");
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const joined = paragraph.join("\n").trim();
    if (joined) blocks.push({ type: "paragraph", text: joined });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const rule = RULE.test(line);
    if (rule) {
      flushParagraph();
      blocks.push({ type: "rule" });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      continue;
    }

    // A table needs a header row followed by a divider; without the divider
    // the pipes are just punctuation in a sentence.
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      flushParagraph();
      const headers = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      i--; // the outer loop advances again
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    const bullet = line.match(BULLET);
    const numbered = line.match(NUMBERED);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const items: string[] = [(bullet ?? numbered)![1].trim()];

      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        const nextMatch = ordered ? next.match(NUMBERED) : next.match(BULLET);
        if (!nextMatch) break;
        items.push(nextMatch[1].trim());
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const quote = line.match(QUOTE);
    if (quote) {
      flushParagraph();
      const parts = [quote[1]];
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1])) {
        parts.push(lines[i + 1].match(QUOTE)![1]);
        i++;
      }
      blocks.push({ type: "quote", text: parts.join("\n").trim() });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

/** Parse an assistant message into renderable blocks. */
export function parseMarkdown(text: string): MdBlock[] {
  const { segments, fences } = extractFences(text || "");
  const blocks: MdBlock[] = [];

  segments.forEach((seg, i) => {
    const fence = fences.get(i);
    if (fence) {
      blocks.push(fence);
      return;
    }
    blocks.push(...parseSegment(seg));
  });

  return blocks;
}

export type MdInline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string }
  | { type: "mention"; text: string };

/**
 * Inline markdown, in precedence order.
 *
 * Inline code is matched before emphasis so backticked content containing
 * asterisks or underscores stays literal — `**kwargs` in a Python snippet is
 * not bold text.
 */
const INLINE = new RegExp(
  [
    "(`[^`]+`)", // code
    "(\\[[^\\]]+\\]\\([^)]+\\))", // link
    "(\\*\\*[^*]+\\*\\*)", // bold
    "(__[^_]+__)", // bold (underscore)
    "(\\*[^*\\n]+\\*)", // italic
    "(_[^_\\n]+_)", // italic (underscore)
    "((?<=^|\\s)@[a-zA-Z][\\w-]*)", // mention
  ].join("|"),
  "g"
);

/** Split a line of markdown into inline spans. */
export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let last = 0;

  for (const m of (text || "").matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: "text", text: text.slice(last, at) });

    const token = m[0];
    if (token.startsWith("`")) {
      out.push({ type: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) out.push({ type: "link", text: link[1], href: link[2] });
      else out.push({ type: "text", text: token });
    } else if (token.startsWith("**") || token.startsWith("__")) {
      out.push({ type: "bold", text: token.slice(2, -2) });
    } else if (token.startsWith("@")) {
      out.push({ type: "mention", text: token });
    } else {
      out.push({ type: "italic", text: token.slice(1, -1) });
    }

    last = at + token.length;
  }

  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

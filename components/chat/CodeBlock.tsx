"use client";

import React, { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Check, Copy } from "lucide-react";

/**
 * A code block rendered the way an editor renders code.
 *
 * When someone asks "where in the repo do I load the RAG pipeline?", the answer
 * is source code, and source code read as chat prose is close to unreadable —
 * no indentation cues, no token colour, no way to tell a keyword from a string.
 * This uses VS Code's own Dark+ theme so a returned file looks like the file
 * looks in the editor the user is about to open.
 *
 * Always dark, in both app themes: an editor surface is its own context, and a
 * light-mode code block in a dark answer (or the reverse) reads as a rendering
 * bug rather than a deliberate choice.
 */

/** Filename → the Prism grammar name, for languages whose labels differ. */
const GRAMMAR_ALIASES: Record<string, string> = {
  tsx: "tsx",
  jsx: "jsx",
  typescript: "typescript",
  javascript: "javascript",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  prisma: "typescript", // no Prism grammar; the syntax is close enough to read
  vue: "markup",
  svelte: "markup",
  text: "text",
};

export type CodeBlockProps = {
  code: string;
  language?: string;
  /** Repository-relative path, shown as the block's title bar. */
  path?: string | null;
  /** First line number, so displayed numbers match the real file. */
  startLine?: number | null;
  /** Link to the file on GitHub. */
  url?: string | null;
};

export function CodeBlock({ code, language, path, startLine, url }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const grammar = GRAMMAR_ALIASES[language ?? "text"] ?? language ?? "text";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked by permissions; the code is still selectable.
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] text-[13px] shadow-sm">
      {/* Title bar — mirrors an editor tab, so the path is attached to the code
          rather than floating above it in the prose. */}
      <div className="flex items-center justify-between gap-2 border-b border-[#3c3c3c] bg-[#252526] px-3 py-1.5">
        <span className="truncate font-mono text-[12px] text-[#cccccc]">
          {path ?? language ?? "code"}
          {startLine ? <span className="text-[#858585]">:{startLine}</span> : null}
        </span>

        <div className="flex shrink-0 items-center gap-1">
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded px-1.5 py-0.5 text-[11px] text-[#9cdcfe] hover:bg-[#2d2d2d] hover:underline"
            >
              GitHub
            </a>
          ) : null}
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? "Copied" : "Copy code"}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#cccccc] hover:bg-[#2d2d2d]"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {/* The code itself scrolls inside its own box; a long line must never
          make the whole chat scroll sideways. */}
      <div className="overflow-x-auto">
        <SyntaxHighlighter
          language={grammar}
          style={vscDarkPlus}
          showLineNumbers
          startingLineNumber={startLine ?? 1}
          wrapLongLines={false}
          customStyle={{
            margin: 0,
            padding: "0.75rem 0",
            background: "transparent",
            fontSize: "13px",
            lineHeight: "1.55",
          }}
          lineNumberStyle={{
            minWidth: "2.75em",
            paddingRight: "1em",
            color: "#858585",
            userSelect: "none",
          }}
          codeTagProps={{
            style: {
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
            },
          }}
        >
          {code.replace(/\n$/, "")}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

"use client";

import React from "react";
import { shortUrlLabel } from "@/lib/chat/format";
import { CodeBlock } from "./CodeBlock";
import { parseInline, parseMarkdown, type MdBlock, type MdInline } from "@/lib/chat/markdown";

/** Shared style for an @-mention chip — a soft light-blue pill, not plain text. */
export const MENTION_CHIP_CLASS =
  "inline-flex items-baseline rounded-md bg-sky-100 dark:bg-sky-400/15 px-1.5 py-px text-sky-700 dark:text-sky-300 font-medium";

const LINK_CLASS =
  "text-[#3a7d2c] dark:text-[#6dba54] underline underline-offset-2 decoration-[#3a7d2c]/40 hover:decoration-[#3a7d2c] font-medium";

/** Bare URLs in plain text, so unlinked links are still clickable. */
const BARE_URL = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function PlainText({ text, keyPrefix }: { text: string; keyPrefix: string }) {
  return (
    <>
      {text.split(BARE_URL).map((seg, i) =>
        /^https?:\/\//.test(seg) ? (
          <a
            key={`${keyPrefix}-u${i}`}
            href={seg}
            target="_blank"
            rel="noopener noreferrer"
            className={`${LINK_CLASS} break-all`}
          >
            {shortUrlLabel(seg)}
          </a>
        ) : (
          <React.Fragment key={`${keyPrefix}-t${i}`}>{seg}</React.Fragment>
        )
      )}
    </>
  );
}

/** Render inline markdown spans. */
function Inline({ text, keyPrefix }: { text: string; keyPrefix: string }) {
  const spans: MdInline[] = parseInline(text);

  return (
    <>
      {spans.map((s, i) => {
        const key = `${keyPrefix}-${i}`;
        switch (s.type) {
          case "bold":
            return (
              <strong key={key} className="font-semibold text-stone-900 dark:text-white">
                <PlainText text={s.text} keyPrefix={key} />
              </strong>
            );
          case "italic":
            return (
              <em key={key} className="italic">
                <PlainText text={s.text} keyPrefix={key} />
              </em>
            );
          case "code":
            return (
              <code
                key={key}
                className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[0.85em] text-stone-800 dark:bg-white/10 dark:text-white/90"
              >
                {s.text}
              </code>
            );
          case "link":
            return (
              <a
                key={key}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                {s.text}
              </a>
            );
          case "mention":
            return (
              <span key={key} className={MENTION_CHIP_CLASS}>
                {s.text}
              </span>
            );
          default:
            return <PlainText key={key} text={s.text} keyPrefix={key} />;
        }
      })}
    </>
  );
}

function Block({ block, keyPrefix }: { block: MdBlock; keyPrefix: string }) {
  switch (block.type) {
    case "heading": {
      // Assistant headings are section labels inside a chat bubble, not page
      // titles — sized to organise the answer, not to shout over it.
      const size =
        block.level === 1
          ? "text-[15px] mt-4 first:mt-0"
          : block.level === 2
            ? "text-[14px] mt-4 first:mt-0"
            : "text-[13px] mt-3 first:mt-0";
      return (
        <p className={`${size} mb-1.5 font-semibold text-stone-900 dark:text-white`}>
          <Inline text={block.text} keyPrefix={keyPrefix} />
        </p>
      );
    }

    case "paragraph":
      return (
        <p className="mb-2 last:mb-0 whitespace-pre-wrap">
          <Inline text={block.text} keyPrefix={keyPrefix} />
        </p>
      );

    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          className={`mb-2 ml-4 flex flex-col gap-1 last:mb-0 ${
            block.ordered ? "list-decimal" : "list-disc"
          }`}
        >
          {block.items.map((item, i) => (
            <li key={`${keyPrefix}-li${i}`} className="pl-0.5 marker:text-stone-400">
              <Inline text={item} keyPrefix={`${keyPrefix}-li${i}`} />
            </li>
          ))}
        </Tag>
      );
    }

    case "table":
      // Scrolls inside its own box — a wide table must never make the whole
      // conversation scroll sideways.
      return (
        <div className="mb-3 overflow-x-auto rounded-lg border border-stone-200 dark:border-white/10">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-stone-50 dark:bg-white/[0.04]">
                {block.headers.map((h, i) => (
                  <th
                    key={`${keyPrefix}-th${i}`}
                    className="border-b border-stone-200 px-3 py-2 text-left font-semibold text-stone-700 dark:border-white/10 dark:text-white/80"
                  >
                    <Inline text={h} keyPrefix={`${keyPrefix}-th${i}`} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr
                  key={`${keyPrefix}-tr${r}`}
                  className="border-b border-stone-100 last:border-b-0 dark:border-white/5"
                >
                  {row.map((cell, c) => (
                    <td
                      key={`${keyPrefix}-td${r}-${c}`}
                      className="px-3 py-2 align-top text-stone-600 dark:text-white/70"
                    >
                      <Inline text={cell} keyPrefix={`${keyPrefix}-td${r}-${c}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "quote":
      return (
        <blockquote className="mb-2 border-l-2 border-stone-200 pl-3 text-stone-500 dark:border-white/15 dark:text-white/50">
          <Inline text={block.text} keyPrefix={keyPrefix} />
        </blockquote>
      );

    case "rule":
      return <hr className="my-3 border-stone-200 dark:border-white/10" />;

    case "code":
      return (
        <CodeBlock
          code={block.code}
          language={block.language}
          path={block.path}
          startLine={block.startLine}
          url={block.url}
        />
      );

    default:
      return null;
  }
}

/**
 * Assistant/user message text rendered as markdown.
 *
 * Shared by the live chat and the chat-logs viewer so rendering never drifts.
 * The component owns its own block spacing, so callers must NOT wrap it in
 * `whitespace-pre-wrap` — that collapses the layout back into a raw dump.
 */
export function MessageBody({ text }: { text: string }) {
  const blocks = parseMarkdown(text);

  return (
    <div className="text-[13.5px] leading-relaxed">
      {blocks.map((block, i) => (
        <Block key={`b${i}`} block={block} keyPrefix={`b${i}`} />
      ))}
    </div>
  );
}

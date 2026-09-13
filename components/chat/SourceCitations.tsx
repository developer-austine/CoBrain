"use client";

import { ExternalLink } from "lucide-react";
import type { Citation } from "@/lib/chat/types";

export const SOURCE_LABELS: Record<string, string> = {
  gmail: "Gmail",
  notion: "Notion",
  github: "GitHub",
  custom: "Custom",
  slack: "Slack",
  drive: "Drive",
  brain: "Brain",
  upload: "File",
};

/** Citation carrying its 1-based index, which matches the [n] markers in the answer. */
type NumberedCitation = Citation & { index: number };

/**
 * Clickable source cards under an assistant answer, grouped by source.
 *
 * Answers are synthesized across whole documents from several sources, and the
 * model cites them inline as [1], [2]… — so each card carries its number,
 * letting the reader trace any claim straight back to the document it came from.
 */
export function SourceCitations({ citations }: { citations?: Citation[] }) {
  if (!citations || citations.length === 0) return null;

  // Number first (order == the order the model was shown them), then group.
  const numbered: NumberedCitation[] = citations.map((c, i) => ({ ...c, index: i + 1 }));

  const groups = new Map<string, NumberedCitation[]>();
  for (const c of numbered) {
    const key = c.source || "other";
    const bucket = groups.get(key);
    if (bucket) bucket.push(c);
    else groups.set(key, [c]);
  }

  const sourceCount = groups.size;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400 dark:text-white/30">
        Sources · {citations.length} document{citations.length === 1 ? "" : "s"}
        {sourceCount > 1 && ` across ${sourceCount} sources`}
      </p>

      {[...groups.entries()].map(([source, items]) => (
        <div key={source} className="flex flex-col gap-1.5">
          {sourceCount > 1 && (
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#3a7d2c]/70">
              {SOURCE_LABELS[source] || source}
            </p>
          )}

          {items.map((c) => {
            const label = SOURCE_LABELS[c.source] || c.source;
            const inner = (
              <div className="flex items-start gap-2 rounded-lg border border-stone-200 dark:border-white/[0.07] bg-stone-50 dark:bg-white/[0.03] px-3 py-2 transition-colors group-hover:border-[#3a7d2c]/30 group-hover:bg-[#3a7d2c]/5">
                <span
                  className="mt-0.5 shrink-0 rounded bg-[#3a7d2c]/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[#3a7d2c]"
                  title={`Cited as [${c.index}] in the answer`}
                >
                  {c.index}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-stone-700 dark:text-white/75">
                    {c.title}
                  </span>
                  <span className="block truncate text-[11px] text-stone-400 dark:text-white/35">
                    {sourceCount === 1 ? label : ""}
                    {sourceCount === 1 && c.author ? " · " : ""}
                    {c.author ?? ""}
                  </span>
                </span>
                {c.url && (
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-300 group-hover:text-[#3a7d2c] dark:text-white/20" />
                )}
              </div>
            );

            return c.url ? (
              <a
                key={c.index}
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group block"
                title={c.snippet}
              >
                {inner}
              </a>
            ) : (
              <div key={c.index} className="group" title={c.snippet}>
                {inner}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

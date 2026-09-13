import { detectSourceIntent, isSourceKey, type SourceKey } from "@/lib/chat/sourceIntent";
import type { Intent, ParsedPrompt } from "./types";

/**
 * Resolve which sources a prompt should search.
 *
 * Precedence (most explicit wins):
 *   1. Entity mentions  — "@notion", "@github", "@files". The user pointed at a
 *      source with a structured token; that is unambiguous, so honour it alone.
 *   2. Page mentions on a QUERY — "@brain what do we know about X" scopes the
 *      search to the Brain. On a WRITE, page mentions are the *destination*
 *      ("edit the @brain page ..."), never the search scope — otherwise
 *      "edit @brain with tasks from @notion" would read from the Brain.
 *   3. Keyword fallback — plain prose like "what tasks are in notion?".
 *
 * An empty result means "search everything" (no source filter).
 *
 * Pure module — no I/O, unit-tested in isolation.
 */
export function resolveSearchSources(
  parsed: ParsedPrompt,
  intent: Intent = "QUERY"
): SourceKey[] {
  // 1. Explicit entity mentions.
  const fromEntities = dedupe(
    parsed.contextRefs.map((r) => r.id).filter(isSourceKey)
  );
  if (fromEntities.length > 0) return fromEntities;

  // 2. Page mentions — only meaningful as a search scope when reading.
  if (intent === "QUERY") {
    const fromPages = dedupe(parsed.writeTargets.filter(isSourceKey));
    if (fromPages.length > 0) return fromPages;
  }

  // 3. Keyword fallback on the prose.
  return detectSourceIntent(parsed.prose);
}

function dedupe(keys: SourceKey[]): SourceKey[] {
  return [...new Set(keys)];
}

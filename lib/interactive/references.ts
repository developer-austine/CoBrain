import type { ParsedPrompt, PromptReference, PromptSubmission, ReferenceType } from "./types";

/**
 * The @-mention catalog: everything the dropdown can offer, grouped by
 * category (blueprint §3.1). Ids are stable; labels are display-only.
 */
export type CatalogEntry = {
  type: ReferenceType;
  id: string;
  label: string;
  description: string;
};

export const REFERENCE_CATALOG: CatalogEntry[] = [
  // Pages — write targets or context
  { type: "page", id: "brain", label: "@brain", description: "The AI's derived knowledge — write target" },
  { type: "page", id: "sources", label: "@sources", description: "Connected + uploaded sources" },
  { type: "page", id: "forecasts", label: "@forecasts", description: "TFT forecast outputs" },
  { type: "page", id: "analytics", label: "@analytics", description: "Patterns & insights" },
  // Models — synthesis model selectors
  { type: "model", id: "claude", label: "@claude", description: "Claude — deep reasoning (default)" },
  { type: "model", id: "extractive", label: "@extractive", description: "No-LLM grounded quotes" },
  { type: "model", id: "tft-forecast", label: "@tft-forecast", description: "Temporal Fusion Transformer" },
  // Entities — context scoping. Ids that match a canonical SourceKey scope the
  // vector search to that source (see resolveSearchSources).
  { type: "entity", id: "notion", label: "@notion", description: "Scope to Notion pages" },
  { type: "entity", id: "gmail", label: "@gmail", description: "Scope to Gmail documents" },
  { type: "entity", id: "github", label: "@github", description: "Scope to GitHub issues, PRs & commits" },
  { type: "entity", id: "slack", label: "@slack", description: "Scope to Slack messages" },
  { type: "entity", id: "drive", label: "@drive", description: "Scope to Google Drive documents" },
  { type: "entity", id: "upload", label: "@files", description: "Scope to your uploaded documents" },
  { type: "entity", id: "meeting-agent", label: "@meeting-agent", description: "The meeting representative agent" },
  { type: "entity", id: "voice-agent", label: "@voice-agent", description: "The speech input agent" },
];

/** Filter the catalog for the dropdown as the user types after "@". */
export function searchCatalog(query: string, limit = 8): CatalogEntry[] {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  const pool = q
    ? REFERENCE_CATALOG.filter(
        (e) => e.id.includes(q) || e.label.toLowerCase().includes(q)
      )
    : REFERENCE_CATALOG;
  return pool.slice(0, limit);
}

/**
 * Separate a submission into intent-prose, write targets, model selection and
 * context scope (§3.4). References are trusted as structured data — the text
 * is never regex-parsed for mentions.
 */
export function parseSubmission(submission: PromptSubmission): ParsedPrompt {
  const refs = dedupeReferences(submission.references ?? []);

  const writeTargets = refs.filter((r) => r.type === "page").map((r) => r.id);
  const model = refs.find((r) => r.type === "model")?.id ?? null;
  const contextRefs = refs.filter((r) => r.type === "entity");

  // Prose = the text with mention labels blanked, so downstream classifiers
  // and configurators see the user's actual instruction words.
  let prose = submission.text ?? "";
  for (const r of refs) {
    prose = prose.split(r.label).join(" ");
  }
  prose = prose.replace(/\s+/g, " ").trim();

  return { prose, writeTargets, model, contextRefs };
}

function dedupeReferences(refs: PromptReference[]): PromptReference[] {
  const seen = new Set<string>();
  const out: PromptReference[] = [];
  for (const r of refs) {
    const key = `${r.type}:${r.id}`;
    if (!r?.id || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

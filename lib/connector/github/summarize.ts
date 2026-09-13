import "server-only";
import prisma from "@/lib/prisma";
import {
  isLlmAvailable,
  isLlmConfigured,
  llmUnavailableReason,
  noteLlmFailure,
  noteLlmSuccess,
} from "@/lib/chat/llmAvailability";
import { writeBrainBlock } from "@/lib/interactive/pageMutation";
import type { BrainBlockDraft } from "@/lib/interactive/types";

/**
 * AI summary of repository activity.
 *
 * A quarter of commits does not fit in one prompt, so this is a map-reduce:
 * summarise batches of commits, then summarise the summaries. LangChain's
 * prompt/model/parser pipeline handles the batching plumbing; the reduce step
 * is a second pass over the intermediate results.
 *
 * The result is written to the Brain as a provenanced block, so "what shipped
 * last month" becomes answerable knowledge rather than a one-off chat reply
 * that disappears.
 */

/** Commits per map call. Sized so a batch of messages fits comfortably in context. */
const BATCH_SIZE = 40;

/** Model for both passes. Kept in one place so switching model is a single edit. */
const SUMMARY_MODEL = "claude-opus-4-8";

export type CommitForSummary = {
  sha: string;
  title: string;
  author: string | null;
  authoredAt: Date | null;
  additions: number | null;
  deletions: number | null;
};

export type SummaryResult =
  | { ok: true; block: { id: string; title: string; status: string }; commits: number }
  | { ok: false; reason: string; commits: number };

function renderCommit(c: CommitForSummary): string {
  const when = c.authoredAt ? c.authoredAt.toISOString().slice(0, 10) : "unknown date";
  const churn =
    c.additions !== null && c.deletions !== null ? ` (+${c.additions}/-${c.deletions})` : "";
  return `- ${when} — ${c.author ?? "unknown"} — ${c.title}${churn}`;
}

const MAP_SYSTEM =
  "You are summarising a batch of git commits from one repository. " +
  "Group them by theme (feature, fix, refactor, infrastructure, docs). " +
  "For each theme give one line: what changed and which people did it. " +
  "Name people exactly as given. Never invent a commit, a name or a date. " +
  "Output plain bullet lines, no preamble.";

const REDUCE_SYSTEM =
  "You are writing the engineering activity summary for a company knowledge base. " +
  "You are given partial summaries of commit batches from one repository, oldest " +
  "batch first. Merge them into one coherent summary.\n\n" +
  "Structure:\n" +
  "1. One sentence stating the overall direction of the work.\n" +
  "2. `## Themes` — a Markdown table: | Theme | What changed | Who |\n" +
  "3. `## Who did what` — a Markdown table: | Person | Focus |\n\n" +
  "Rules: name people exactly as given; write 'Not stated' rather than guessing; " +
  "never invent work that is not in the input. Be concise — no preamble, no sign-off.";

/**
 * Summarise commits into a Brain block.
 *
 * Fails soft in a specific way: when synthesis is unavailable this returns a
 * reason instead of writing a placeholder block. A Brain entry that says
 * "summary unavailable" is worse than no entry — it occupies the page and looks
 * like knowledge.
 */
export async function summariseCommits(
  userId: string,
  repository: string,
  commits: CommitForSummary[]
): Promise<SummaryResult> {
  if (commits.length === 0) {
    return { ok: false, reason: "No commits to summarise.", commits: 0 };
  }
  if (!isLlmAvailable()) {
    const why = !isLlmConfigured()
      ? "no ANTHROPIC_API_KEY configured"
      : (llmUnavailableReason() ?? "AI synthesis unavailable");
    return { ok: false, reason: `Commit summary needs AI synthesis — ${why}.`, commits: commits.length };
  }

  // Oldest first so the narrative reads forward in time.
  const ordered = [...commits].sort(
    (a, b) => (a.authoredAt?.getTime() ?? 0) - (b.authoredAt?.getTime() ?? 0)
  );

  try {
    const { ChatAnthropic } = await import("@langchain/anthropic");
    const { ChatPromptTemplate } = await import("@langchain/core/prompts");
    const { StringOutputParser } = await import("@langchain/core/output_parsers");

    const model = new ChatAnthropic({ model: SUMMARY_MODEL, maxTokens: 1500 });
    const parser = new StringOutputParser();

    // --- map: one summary per batch ---
    const mapChain = ChatPromptTemplate.fromMessages([
      ["system", MAP_SYSTEM],
      ["human", "Repository: {repository}\n\nCommits:\n{commits}"],
    ])
      .pipe(model)
      .pipe(parser);

    const batches: CommitForSummary[][] = [];
    for (let i = 0; i < ordered.length; i += BATCH_SIZE) {
      batches.push(ordered.slice(i, i + BATCH_SIZE));
    }

    const partials = await mapChain.batch(
      batches.map((b) => ({
        repository,
        commits: b.map(renderCommit).join("\n"),
      }))
    );

    // --- reduce: one summary over the partials ---
    const reduceChain = ChatPromptTemplate.fromMessages([
      ["system", REDUCE_SYSTEM],
      [
        "human",
        "Repository: {repository}\nCommits summarised: {count}\nPeriod: {period}\n\n" +
          "Partial summaries:\n{partials}",
      ],
    ])
      .pipe(model)
      .pipe(parser);

    const first = ordered[0]?.authoredAt?.toISOString().slice(0, 10) ?? "unknown";
    const last = ordered.at(-1)?.authoredAt?.toISOString().slice(0, 10) ?? "unknown";

    const summary = await reduceChain.invoke({
      repository,
      count: String(ordered.length),
      period: `${first} to ${last}`,
      partials: partials.map((p, i) => `### Batch ${i + 1}\n${p}`).join("\n\n"),
    });

    noteLlmSuccess();

    const authors = [
      ...new Set(ordered.map((c) => c.author).filter((a): a is string => Boolean(a))),
    ];

    const draft: BrainBlockDraft = {
      // Who shipped what is durable knowledge about the company, not a note.
      type: "learned_fact",
      title: `Engineering activity — ${repository} (${first} to ${last})`,
      body:
        `${summary}\n\n---\n\n` +
        `_Summarised from ${ordered.length} commit${ordered.length === 1 ? "" : "s"} ` +
        `in ${repository}, ${first} to ${last}._`,
      data: {
        repository,
        commit_count: ordered.length,
        period: { from: first, to: last },
        authors,
      },
      confidence: 0.8,
      createdBy: "ai",
      sourceRefs: ordered.slice(0, 50).map((c) => ({
        kind: "commit",
        sha: c.sha,
        author: c.author,
        title: c.title,
        url: `https://github.com/${repository}/commit/${c.sha}`,
      })),
    };

    const block = await writeBrainBlock(userId, draft);
    return {
      ok: true,
      block: { id: block.id, title: block.title, status: block.status },
      commits: ordered.length,
    };
  } catch (err) {
    noteLlmFailure(err);
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Commit summary failed.",
      commits: commits.length,
    };
  }
}

/** Load a connection's commits for summarising, newest first, bounded. */
export async function loadCommitsForSummary(
  connectionId: string,
  limit = 200
): Promise<CommitForSummary[]> {
  const rows = await prisma.gitHubItem.findMany({
    where: { githubConnectionId: connectionId, type: "commit" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      sha: true,
      title: true,
      author: true,
      createdAt: true,
      additions: true,
      deletions: true,
    },
  });

  return rows.map((r) => ({
    sha: r.sha ?? "",
    title: r.title ?? "(no message)",
    author: r.author,
    authoredAt: r.createdAt,
    additions: r.additions,
    deletions: r.deletions,
  }));
}

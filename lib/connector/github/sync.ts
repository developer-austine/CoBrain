import "server-only";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/queue/publisher";
import {
  getCommitStats,
  getFileContent,
  listCommits,
  listDiscussions,
  listTree,
  type CommitSummary,
  type DiscussionThread,
} from "./client";
import { chunkFile, embeddableText, shouldIndex } from "./code";

/**
 * GitHub sync services.
 *
 * Each kind of GitHub content is its own function so a repo with Discussions
 * disabled, or a code index that hits the rate limit, degrades to a partial
 * sync instead of failing the whole run.
 *
 * Every one of them ENQUEUES. The previous route stored rows and stopped there,
 * which is why the vector store held zero GitHub chunks while the database
 * looked fully synced — the connector appeared to work and answered nothing.
 */

const QUEUE_KEY = "company_brain:ingest";

/** Per-commit stat calls cost one request each; only spend them on recent work. */
const COMMIT_STAT_BUDGET = 40;

/** Files fetched per code index run. A fetch is one request, so this is the rate-limit lever. */
const CODE_FILE_BUDGET = 400;

export type SyncOutcome = {
  kind: "issues" | "commits" | "discussions" | "code";
  synced: number;
  skipped: number;
  note?: string;
};

type Connection = {
  id: string;
  userId: string;
  accessToken: string;
  repository: string;
  defaultBranch: string | null;
  lastCommitSha: string | null;
};

/** Push one document into the same pipeline every other connector feeds. */
async function enqueue(payload: {
  rawDocumentId: string;
  userId: string;
  connectionId: string;
  externalId: string;
  author: string;
  subject: string;
  content: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await redis.lpush(
    QUEUE_KEY,
    JSON.stringify({
      raw_document_id: payload.rawDocumentId,
      source: "github",
      external_id: payload.externalId,
      author: payload.author,
      subject: payload.subject,
      content: payload.content,
      timestamp: payload.timestamp,
      metadata: payload.metadata,
      connector_id: payload.connectionId,
      namespace: `${payload.userId}:github`, // RBAC boundary
    })
  );
}

/**
 * Commits, attributed to the team member who wrote them.
 *
 * Incremental via `lastCommitSha`: a first run reads history, later runs read
 * only what landed since. Line stats are fetched for the newest commits only —
 * they are one request each, and a full backfill would exhaust the hourly quota
 * on a repo of any size.
 */
export async function syncCommits(connection: Connection): Promise<SyncOutcome> {
  const branch = connection.defaultBranch ?? undefined;
  const commits = await listCommits(connection.accessToken, connection.repository, {
    branch,
    sinceSha: connection.lastCommitSha,
  });

  let synced = 0;
  let skipped = 0;

  for (const [i, c] of commits.entries()) {
    try {
      const stats =
        i < COMMIT_STAT_BUDGET
          ? await getCommitStats(connection.accessToken, connection.repository, c.sha)
          : null;

      const stored = await upsertCommit(connection.id, c, stats);
      await enqueue({
        rawDocumentId: stored.id,
        userId: connection.userId,
        connectionId: connection.id,
        externalId: c.sha,
        author: c.author ?? "",
        subject: commitSubject(c.message),
        content: commitDocument(connection.repository, c, stats),
        timestamp: c.authoredAt ?? new Date().toISOString(),
        metadata: {
          kind: "commit",
          repository: connection.repository,
          sha: c.sha,
          url: c.url,
          ...(stats ?? {}),
        },
      });
      synced++;
    } catch (err) {
      console.error(`[github/sync] commit ${c.sha} failed:`, err);
      skipped++;
    }
  }

  // Advance the cursor only after the run, so a mid-run failure re-reads rather
  // than silently skipping the commits it never reached.
  if (commits.length > 0) {
    await prisma.gitHubConnection.update({
      where: { id: connection.id },
      data: { lastCommitSha: commits[0].sha, commitsSyncedAt: new Date() },
    });
  }

  return { kind: "commits", synced, skipped };
}

function commitSubject(message: string): string {
  return (message.split("\n")[0] ?? "").trim().slice(0, 200) || "(no message)";
}

/** The searchable form of a commit: who, when, what, and how big. */
function commitDocument(
  repo: string,
  c: CommitSummary,
  stats: { additions: number; deletions: number; changedFiles: number } | null
): string {
  const lines = [
    `# ${commitSubject(c.message)}`,
    "",
    "## Details",
    `Repository: ${repo}`,
    `Author: ${c.author ?? "Not stated"}`,
    `Date: ${c.authoredAt ?? "Not stated"}`,
    `Commit: ${c.sha.slice(0, 10)}`,
  ];
  if (stats) {
    lines.push(
      `Changed files: ${stats.changedFiles}`,
      `Lines added: ${stats.additions}`,
      `Lines removed: ${stats.deletions}`
    );
  }

  const body = c.message.split("\n").slice(1).join("\n").trim();
  if (body) lines.push("", "## Message", body);
  return lines.join("\n");
}

async function upsertCommit(
  connectionId: string,
  c: CommitSummary,
  stats: { additions: number; deletions: number; changedFiles: number } | null
) {
  return prisma.gitHubItem.upsert({
    where: {
      githubConnectionId_githubItemId_type: {
        githubConnectionId: connectionId,
        githubItemId: c.sha,
        type: "commit",
      },
    },
    create: {
      githubConnectionId: connectionId,
      githubItemId: c.sha,
      type: "commit",
      title: commitSubject(c.message),
      body: c.message,
      author: c.author,
      url: c.url,
      sha: c.sha,
      labels: [],
      additions: stats?.additions ?? null,
      deletions: stats?.deletions ?? null,
      changedFiles: stats?.changedFiles ?? null,
      createdAt: c.authoredAt ? new Date(c.authoredAt) : null,
      status: "PENDING",
    },
    update: {
      title: commitSubject(c.message),
      body: c.message,
      author: c.author,
      additions: stats?.additions ?? undefined,
      deletions: stats?.deletions ?? undefined,
      changedFiles: stats?.changedFiles ?? undefined,
      status: "PENDING",
    },
  });
}

/**
 * Discussion threads, flattened with their comment tree.
 *
 * The whole thread becomes one document rather than one per comment: a
 * discussion's meaning lives in the exchange, and a lone reply retrieved
 * without its question is unanswerable.
 */
export async function syncDiscussions(connection: Connection): Promise<SyncOutcome> {
  let threads: DiscussionThread[];
  try {
    threads = await listDiscussions(connection.accessToken, connection.repository);
  } catch (err) {
    // Discussions disabled or scope missing — a normal state, not a failure.
    return {
      kind: "discussions",
      synced: 0,
      skipped: 0,
      note: err instanceof Error ? err.message : "discussions unavailable",
    };
  }

  let synced = 0;
  let skipped = 0;

  for (const d of threads) {
    try {
      const content = discussionDocument(connection.repository, d);
      const stored = await prisma.gitHubItem.upsert({
        where: {
          githubConnectionId_githubItemId_type: {
            githubConnectionId: connection.id,
            githubItemId: d.id,
            type: "discussion",
          },
        },
        create: {
          githubConnectionId: connection.id,
          githubItemId: d.id,
          type: "discussion",
          title: d.title,
          body: content,
          author: d.author,
          url: d.url,
          labels: d.category ? [d.category] : [],
          createdAt: d.createdAt ? new Date(d.createdAt) : null,
          updatedAt: d.updatedAt ? new Date(d.updatedAt) : null,
          status: "PENDING",
        },
        update: {
          title: d.title,
          body: content,
          labels: d.category ? [d.category] : [],
          updatedAt: d.updatedAt ? new Date(d.updatedAt) : null,
          status: "PENDING",
        },
      });

      await enqueue({
        rawDocumentId: stored.id,
        userId: connection.userId,
        connectionId: connection.id,
        externalId: d.id,
        author: d.author ?? "",
        subject: d.title,
        content,
        timestamp: d.updatedAt ?? d.createdAt ?? new Date().toISOString(),
        metadata: {
          kind: "discussion",
          repository: connection.repository,
          category: d.category,
          url: d.url,
          number: d.number,
        },
      });
      synced++;
    } catch (err) {
      console.error(`[github/sync] discussion ${d.id} failed:`, err);
      skipped++;
    }
  }

  return { kind: "discussions", synced, skipped };
}

function discussionDocument(repo: string, d: DiscussionThread): string {
  const lines = [
    `# ${d.title}`,
    "",
    "## Details",
    `Repository: ${repo}`,
    `Category: ${d.category ?? "Not stated"}`,
    `Author: ${d.author ?? "Not stated"}`,
    `Date: ${d.createdAt ?? "Not stated"}`,
    "",
    d.body.trim(),
  ];

  if (d.comments.length) {
    lines.push("", `## Discussion (${d.comments.length} replies)`);
    for (const c of d.comments) {
      if (!c.body.trim()) continue;
      lines.push("", `**${c.author ?? "Unknown"}**: ${c.body.trim()}`);
    }
  }
  return lines.join("\n");
}

/**
 * Index the repository's source code.
 *
 * One database row per FILE, but one queue message per CHUNK — a 600-line file
 * holds several unrelated answers, and embedding it whole would return the
 * entire file for a question about one function in it.
 */
export async function syncCode(connection: Connection): Promise<SyncOutcome> {
  const branch = connection.defaultBranch ?? "main";
  const { entries, sha, truncated } = await listTree(
    connection.accessToken,
    connection.repository,
    branch
  );

  const indexable = entries.filter(shouldIndex).slice(0, CODE_FILE_BUDGET);
  let synced = 0;
  let skipped = 0;

  for (const entry of indexable) {
    try {
      const content = await getFileContent(
        connection.accessToken,
        connection.repository,
        entry.path,
        branch
      );
      if (!content) {
        skipped++;
        continue;
      }

      const chunks = await chunkFile(entry.path, content);
      if (chunks.length === 0) {
        skipped++;
        continue;
      }

      const stored = await prisma.gitHubItem.upsert({
        where: {
          githubConnectionId_githubItemId_type: {
            githubConnectionId: connection.id,
            githubItemId: entry.path,
            type: "code",
          },
        },
        create: {
          githubConnectionId: connection.id,
          githubItemId: entry.path,
          type: "code",
          title: entry.path,
          body: content,
          path: entry.path,
          language: chunks[0].language,
          sizeBytes: entry.size,
          sha: entry.sha,
          url: `https://github.com/${connection.repository}/blob/${branch}/${entry.path}`,
          labels: [],
          status: "PENDING",
        },
        update: {
          body: content,
          language: chunks[0].language,
          sizeBytes: entry.size,
          sha: entry.sha,
          status: "PENDING",
        },
      });

      for (const chunk of chunks) {
        await enqueue({
          rawDocumentId: stored.id,
          userId: connection.userId,
          connectionId: connection.id,
          // Chunks of one file must not collide on external_id, or the
          // deduplicator treats the file as a single repeated document.
          externalId: `${entry.path}#${chunk.index}`,
          author: "",
          subject: entry.path,
          content: embeddableText(connection.repository, chunk),
          timestamp: new Date().toISOString(),
          metadata: {
            kind: "code",
            repository: connection.repository,
            path: entry.path,
            language: chunk.language,
            start_line: chunk.startLine,
            chunk: chunk.index,
            chunks: chunk.total,
            branch,
            url: `https://github.com/${connection.repository}/blob/${branch}/${entry.path}#L${chunk.startLine}`,
          },
        });
      }
      synced++;
    } catch (err) {
      console.error(`[github/sync] code ${entry.path} failed:`, err);
      skipped++;
    }
  }

  await prisma.gitHubConnection.update({
    where: { id: connection.id },
    data: { codeSyncedAt: new Date(), codeTreeSha: sha },
  });

  const note = truncated
    ? "GitHub truncated the file tree — the repository is too large to index in full."
    : entries.filter(shouldIndex).length > CODE_FILE_BUDGET
      ? `Indexed the first ${CODE_FILE_BUDGET} files of ${entries.filter(shouldIndex).length}.`
      : undefined;

  return { kind: "code", synced, skipped, note };
}

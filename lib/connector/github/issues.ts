import "server-only";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/queue/publisher";
import type { SyncOutcome } from "./sync";

/**
 * Issues and pull requests.
 *
 * Carried over from the original sync route with one substantive change: every
 * item is now pushed into the ingest queue. The route version wrote rows and
 * stopped, so issues existed in Postgres and nowhere in the vector store — the
 * connector reported success and the Brain could not answer a single question
 * about them.
 */

const GITHUB_API = "https://api.github.com";
const QUEUE_KEY = "company_brain:ingest";

type Connection = {
  id: string;
  userId: string;
  accessToken: string;
  repository: string;
};

type RawItem = Record<string, unknown>;

function githubHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fetchPaged(
  accessToken: string,
  path: string,
  maxPages = 5
): Promise<RawItem[]> {
  const items: RawItem[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${GITHUB_API}${path}&per_page=100&page=${page}`, {
      headers: githubHeaders(accessToken),
    });
    if (!res.ok) {
      throw new Error(`GitHub ${path} failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as RawItem[];
    if (!Array.isArray(data) || data.length === 0) break;
    items.push(...data);
    if (data.length < 100) break;
    if (res.headers.get("x-ratelimit-remaining") === "0") break;
  }

  return items;
}

/** The searchable form of an issue or PR: what it is, who owns it, what state it is in. */
function itemDocument(repo: string, kind: "issue" | "pr", item: RawItem, state: string): string {
  const user = item.user as Record<string, unknown> | undefined;
  const assignees = ((item.assignees as Record<string, unknown>[]) ?? [])
    .map((a) => String(a.login))
    .filter(Boolean);
  const labels = ((item.labels as Record<string, unknown>[]) ?? [])
    .map((l) => String(l.name))
    .filter(Boolean);

  const lines = [
    `# ${String(item.title ?? "(untitled)")}`,
    "",
    "## Details",
    `Repository: ${repo}`,
    `Type: ${kind === "pr" ? "Pull request" : "Issue"}`,
    `Number: #${String(item.number ?? "")}`,
    `State: ${state}`,
    // Written as an ownership property so the attribution parser reads it the
    // same way it reads a Notion "Assigned To" field.
    `Author: ${String(user?.login ?? "Not stated")}`,
    `Assigned To: ${assignees.length ? assignees.join(", ") : "Not stated"}`,
    `Labels: ${labels.length ? labels.join(", ") : "None"}`,
    `Date: ${String(item.created_at ?? "Not stated")}`,
  ];

  const body = String(item.body ?? "").trim();
  if (body) lines.push("", "## Description", body);
  return lines.join("\n");
}

async function enqueue(
  connection: Connection,
  rawDocumentId: string,
  externalId: string,
  author: string,
  subject: string,
  content: string,
  timestamp: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await redis.lpush(
    QUEUE_KEY,
    JSON.stringify({
      raw_document_id: rawDocumentId,
      source: "github",
      external_id: externalId,
      author,
      subject,
      content,
      timestamp,
      metadata,
      connector_id: connection.id,
      namespace: `${connection.userId}:github`,
    })
  );
}

/** Sync issues and pull requests, then queue both for embedding. */
export async function syncIssuesAndPrs(connection: Connection): Promise<SyncOutcome> {
  let synced = 0;
  let skipped = 0;

  const store = async (kind: "issue" | "pr", item: RawItem, state: string) => {
    const user = item.user as Record<string, unknown> | undefined;
    const labels = ((item.labels as Record<string, unknown>[]) ?? [])
      .map((l) => String(l.name))
      .filter(Boolean);
    const content = itemDocument(connection.repository, kind, item, state);

    const stored = await prisma.gitHubItem.upsert({
      where: {
        githubConnectionId_githubItemId_type: {
          githubConnectionId: connection.id,
          githubItemId: String(item.id),
          type: kind,
        },
      },
      create: {
        githubConnectionId: connection.id,
        githubItemId: String(item.id),
        type: kind,
        title: (item.title as string) ?? null,
        body: content,
        state,
        author: (user?.login as string) ?? null,
        url: (item.html_url as string) ?? null,
        labels,
        createdAt: item.created_at ? new Date(String(item.created_at)) : null,
        updatedAt: item.updated_at ? new Date(String(item.updated_at)) : null,
        status: "PENDING",
      },
      update: {
        title: (item.title as string) ?? null,
        body: content,
        state,
        labels,
        updatedAt: item.updated_at ? new Date(String(item.updated_at)) : null,
        status: "PENDING",
      },
    });

    await enqueue(
      connection,
      stored.id,
      String(item.id),
      String(user?.login ?? ""),
      String(item.title ?? ""),
      content,
      String(item.updated_at ?? item.created_at ?? new Date().toISOString()),
      {
        kind,
        repository: connection.repository,
        number: item.number,
        state,
        url: item.html_url,
        labels,
      }
    );
  };

  const issues = await fetchPaged(
    connection.accessToken,
    `/repos/${connection.repository}/issues?state=all`
  );
  for (const item of issues) {
    // The issues endpoint returns PRs too; they are fetched separately below
    // so their merged state is accurate.
    if (item.pull_request) continue;
    try {
      await store("issue", item, String(item.state ?? "open"));
      synced++;
    } catch (err) {
      console.error("[github/issues] issue failed:", err);
      skipped++;
    }
  }

  const prs = await fetchPaged(
    connection.accessToken,
    `/repos/${connection.repository}/pulls?state=all`
  );
  for (const pr of prs) {
    try {
      await store("pr", pr, pr.merged_at ? "merged" : String(pr.state ?? "open"));
      synced++;
    } catch (err) {
      console.error("[github/issues] pr failed:", err);
      skipped++;
    }
  }

  return { kind: "issues", synced, skipped };
}

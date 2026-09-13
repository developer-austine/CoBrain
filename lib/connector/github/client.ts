import "server-only";

/**
 * Thin GitHub API client.
 *
 * Everything the connector needs from GitHub goes through here so rate-limit
 * handling, pagination and error shape are decided once. GitHub's REST API
 * covers repos, commits and contents; Discussions exist only in GraphQL, so
 * both transports live side by side.
 */

const REST = "https://api.github.com";
const GRAPHQL = "https://api.github.com/graphql";

export type RepoSummary = {
  id: string;
  fullName: string;
  description: string | null;
  defaultBranch: string;
  private: boolean;
  language: string | null;
  updatedAt: string | null;
  pushedAt: string | null;
};

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** GitHub's own hint, e.g. a rate-limit reset time. */
    readonly detail?: string
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * One REST call with the failure modes that actually happen spelled out.
 *
 * A 403 with a zero remaining-quota header is a rate limit, not a permission
 * problem, and the two need completely different responses from the caller —
 * one is "wait", the other is "reconnect". GitHub returns the same status for
 * both, so the distinction has to be made here.
 */
async function rest<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${REST}${path}`, { headers: headers(token) });

  if (!res.ok) {
    const body = await res.text();
    const remaining = res.headers.get("x-ratelimit-remaining");

    if (res.status === 403 && remaining === "0") {
      const reset = res.headers.get("x-ratelimit-reset");
      const when = reset ? new Date(Number(reset) * 1000).toISOString() : "shortly";
      throw new GitHubApiError(`GitHub rate limit exhausted; resets ${when}`, 403, body);
    }
    if (res.status === 401) {
      throw new GitHubApiError("GitHub token rejected — reconnect the account", 401, body);
    }
    throw new GitHubApiError(`GitHub ${path} failed: ${res.status}`, res.status, body);
  }

  return (await res.json()) as T;
}

/** Walk a paginated REST collection, stopping at `maxPages` so a huge repo cannot hang a sync. */
async function restPaged<T>(
  token: string,
  path: string,
  { maxPages = 10, perPage = 100 }: { maxPages?: number; perPage?: number } = {}
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const batch = await rest<T[]>(token, `${path}${sep}per_page=${perPage}&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < perPage) break;
  }
  return out;
}

/** Repositories the token can see, most recently pushed first. */
export async function listRepositories(token: string): Promise<RepoSummary[]> {
  const raw = await restPaged<Record<string, unknown>>(
    token,
    "/user/repos?sort=pushed&affiliation=owner,collaborator,organization_member",
    { maxPages: 5 }
  );

  return raw.map((r) => ({
    id: String(r.id),
    fullName: String(r.full_name),
    description: (r.description as string) ?? null,
    defaultBranch: (r.default_branch as string) ?? "main",
    private: Boolean(r.private),
    language: (r.language as string) ?? null,
    updatedAt: (r.updated_at as string) ?? null,
    pushedAt: (r.pushed_at as string) ?? null,
  }));
}

export async function getRepository(token: string, fullName: string): Promise<RepoSummary> {
  const r = await rest<Record<string, unknown>>(token, `/repos/${fullName}`);
  return {
    id: String(r.id),
    fullName: String(r.full_name),
    description: (r.description as string) ?? null,
    defaultBranch: (r.default_branch as string) ?? "main",
    private: Boolean(r.private),
    language: (r.language as string) ?? null,
    updatedAt: (r.updated_at as string) ?? null,
    pushedAt: (r.pushed_at as string) ?? null,
  };
}

export type CommitSummary = {
  sha: string;
  message: string;
  author: string | null;
  authorEmail: string | null;
  authoredAt: string | null;
  url: string;
};

/**
 * Commits on a branch, newest first.
 *
 * `sinceSha` makes this incremental: GitHub has no "commits after sha" filter,
 * so we page until we meet the last sha we stored and stop. That keeps a daily
 * sync to one page instead of re-reading the whole history.
 */
export async function listCommits(
  token: string,
  repo: string,
  opts: { branch?: string; sinceSha?: string | null; maxPages?: number } = {}
): Promise<CommitSummary[]> {
  const branch = opts.branch ? `?sha=${encodeURIComponent(opts.branch)}` : "";
  const out: CommitSummary[] = [];

  for (let page = 1; page <= (opts.maxPages ?? 5); page++) {
    const sep = branch ? "&" : "?";
    const batch = await rest<Record<string, unknown>[]>(
      token,
      `/repos/${repo}/commits${branch}${sep}per_page=100&page=${page}`
    );
    if (!batch.length) break;

    let hitCursor = false;
    for (const c of batch) {
      const sha = String(c.sha);
      if (opts.sinceSha && sha === opts.sinceSha) {
        hitCursor = true;
        break;
      }
      const commit = c.commit as Record<string, unknown> | undefined;
      const gitAuthor = commit?.author as Record<string, unknown> | undefined;
      const ghAuthor = c.author as Record<string, unknown> | null | undefined;

      out.push({
        sha,
        message: String(commit?.message ?? ""),
        // Prefer the GitHub login (stable, matches the rest of the product);
        // fall back to the git author name for commits with no linked account.
        author: (ghAuthor?.login as string) ?? (gitAuthor?.name as string) ?? null,
        authorEmail: (gitAuthor?.email as string) ?? null,
        authoredAt: (gitAuthor?.date as string) ?? null,
        url: String(c.html_url ?? ""),
      });
    }

    if (hitCursor || batch.length < 100) break;
  }

  return out;
}

/** Per-commit line stats. Costs one request each, so callers must budget it. */
export async function getCommitStats(
  token: string,
  repo: string,
  sha: string
): Promise<{ additions: number; deletions: number; changedFiles: number }> {
  const c = await rest<Record<string, unknown>>(token, `/repos/${repo}/commits/${sha}`);
  const stats = (c.stats as Record<string, number>) ?? {};
  const files = (c.files as unknown[]) ?? [];
  return {
    additions: stats.additions ?? 0,
    deletions: stats.deletions ?? 0,
    changedFiles: files.length,
  };
}

export type DiscussionThread = {
  id: string;
  number: number;
  title: string;
  body: string;
  author: string | null;
  category: string | null;
  url: string;
  createdAt: string | null;
  updatedAt: string | null;
  comments: { author: string | null; body: string; createdAt: string | null }[];
};

const DISCUSSIONS_QUERY = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    discussions(first: 25, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id number title body url createdAt updatedAt
        author { login }
        category { name }
        comments(first: 50) {
          nodes {
            body createdAt
            author { login }
            replies(first: 20) { nodes { body createdAt author { login } } }
          }
        }
      }
    }
  }
}`;

type GqlAuthor = { login?: string } | null;
type GqlComment = {
  body?: string;
  createdAt?: string;
  author?: GqlAuthor;
  replies?: { nodes?: GqlComment[] };
};
type GqlDiscussion = {
  id?: string;
  number?: number;
  title?: string;
  body?: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  author?: GqlAuthor;
  category?: { name?: string } | null;
  comments?: { nodes?: GqlComment[] };
};
type GqlDiscussionsPage = {
  data?: {
    repository?: {
      discussions?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        nodes?: GqlDiscussion[];
      } | null;
    } | null;
  };
};

/**
 * Repository Discussions.
 *
 * Discussions have no REST endpoint — GraphQL is the only transport. A repo
 * with the tab disabled returns a `null` repository field rather than a 404,
 * so an empty list here means "nothing to read", not "call failed".
 */
export async function listDiscussions(
  token: string,
  repo: string,
  maxPages = 4
): Promise<DiscussionThread[]> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new GitHubApiError(`Malformed repository "${repo}"`, 400);

  const out: DiscussionThread[] = [];
  let after: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const res = await fetch(GRAPHQL, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        query: DISCUSSIONS_QUERY,
        variables: { owner, name, after },
      }),
    });

    if (!res.ok) {
      throw new GitHubApiError(`GitHub discussions failed: ${res.status}`, res.status, await res.text());
    }

    const json = (await res.json()) as GqlDiscussionsPage;
    // Discussions disabled, or the token lacks the scope — both are "nothing
    // to sync" rather than a failure that should abort the whole run.
    const discussions = json?.data?.repository?.discussions;
    if (!discussions) break;

    for (const d of discussions.nodes ?? []) {
      const comments: DiscussionThread["comments"] = [];
      for (const c of (d.comments?.nodes ?? []) as GqlComment[]) {
        comments.push({
          author: c.author?.login ?? null,
          body: c.body ?? "",
          createdAt: c.createdAt ?? null,
        });
        for (const r of c.replies?.nodes ?? []) {
          comments.push({
            author: r.author?.login ?? null,
            body: r.body ?? "",
            createdAt: r.createdAt ?? null,
          });
        }
      }

      out.push({
        id: String(d.id),
        number: Number(d.number),
        title: String(d.title ?? ""),
        body: String(d.body ?? ""),
        author: d.author?.login ?? null,
        category: d.category?.name ?? null,
        url: String(d.url ?? ""),
        createdAt: d.createdAt ?? null,
        updatedAt: d.updatedAt ?? null,
        comments,
      });
    }

    if (!discussions.pageInfo?.hasNextPage) break;
    after = discussions.pageInfo.endCursor ?? null;
  }

  return out;
}

export type TreeEntry = { path: string; sha: string; size: number };

/**
 * Every blob in the repo at `branch`, in one request.
 *
 * `?recursive=1` avoids walking the tree directory by directory. GitHub
 * truncates the response for very large repos and says so — surfaced to the
 * caller so a partial index is never mistaken for a complete one.
 */
export async function listTree(
  token: string,
  repo: string,
  branch: string
): Promise<{ entries: TreeEntry[]; sha: string; truncated: boolean }> {
  const tree = await rest<Record<string, unknown>>(
    token,
    `/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  );

  const entries = ((tree.tree as Record<string, unknown>[]) ?? [])
    .filter((e) => e.type === "blob")
    .map((e) => ({
      path: String(e.path),
      sha: String(e.sha),
      size: Number(e.size ?? 0),
    }));

  return {
    entries,
    sha: String(tree.sha ?? ""),
    truncated: Boolean(tree.truncated),
  };
}

/** A single file's decoded text. Returns null for binaries and oversized blobs. */
export async function getFileContent(
  token: string,
  repo: string,
  path: string,
  branch: string
): Promise<string | null> {
  const file = await rest<Record<string, unknown>>(
    token,
    `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`
  );

  if (file.encoding !== "base64" || typeof file.content !== "string") return null;

  const buf = Buffer.from(file.content, "base64");
  // A NUL byte in the first block is the standard heuristic for "not text".
  if (buf.subarray(0, 8000).includes(0)) return null;
  return buf.toString("utf-8");
}

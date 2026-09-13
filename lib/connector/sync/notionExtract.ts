import "server-only";

/**
 * Notion → plain text extraction.
 *
 * A Notion page carries meaning in FOUR places, and reading only one of them
 * is why the Brain used to see almost nothing:
 *
 *   1. the title                — `properties[<title prop>]`
 *   2. database properties      — Assignee, Status, Due date, Priority…
 *                                 A database row (a "task") usually has NO
 *                                 blocks at all, so a block-only reader stored
 *                                 an empty document and skipped the page.
 *   3. the block tree           — paragraphs, headings, to-dos, tables…
 *   4. comments                 — where the actual back-and-forth between
 *                                 members happens. Notion calls these
 *                                 discussions; they are not blocks.
 *
 * Everything here returns plain text destined for the same ingest pipeline as
 * every other source, so the output is markdown-ish but never HTML.
 */

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

/** Notion allows ~3 req/s; stay under it. */
export const RATE_LIMIT_MS = 350;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function headers(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

/* ------------------------------------------------------------------ people */

/** Resolves a Notion user id to a display name. */
export type UserResolver = (id: string | null | undefined) => Promise<string | null>;

/**
 * Names make the knowledge usable — "who was assigned this" is unanswerable
 * when every person is a UUID. `/v1/users/{id}` needs the integration's "read
 * user information" capability, so a miss must be survivable: we cache the
 * failure and fall through to whatever inline name Notion gave us.
 */
export function createUserResolver(accessToken: string): UserResolver {
  const cache = new Map<string, string | null>();

  return async (id) => {
    if (!id) return null;
    if (cache.has(id)) return cache.get(id) ?? null;

    let name: string | null = null;
    try {
      const res = await fetch(`${NOTION_API}/users/${id}`, { headers: headers(accessToken) });
      if (res.ok) {
        const user = await res.json();
        name = user?.name || user?.person?.email || user?.bot?.owner?.user?.name || null;
      }
    } catch (err) {
      console.error(`[notion] user lookup failed for ${id}:`, err);
    }
    cache.set(id, name);
    return name;
  };
}

/** Prefer the name Notion already inlined; only pay for a lookup when absent. */
async function personName(person: any, resolveUser: UserResolver): Promise<string> {
  const inline = person?.name || person?.person?.email;
  if (inline) return String(inline);
  const resolved = await resolveUser(person?.id);
  return resolved ?? "(unknown member)";
}

/* --------------------------------------------------------------- rich text */

function richText(items: any[] | undefined): string {
  return (items ?? []).map((rt: any) => rt?.plain_text ?? "").join("");
}

/* -------------------------------------------------------------- properties */

/** Human-readable value for one Notion property, or "" when there's nothing to say. */
async function renderPropertyValue(prop: any, resolveUser: UserResolver): Promise<string> {
  if (!prop) return "";

  switch (prop.type) {
    case "title":
    case "rich_text":
      return richText(prop[prop.type]).trim();

    case "number":
      return prop.number === null || prop.number === undefined ? "" : String(prop.number);

    case "select":
      return prop.select?.name ?? "";

    case "status":
      return prop.status?.name ?? "";

    case "multi_select":
      return (prop.multi_select ?? []).map((s: any) => s?.name).filter(Boolean).join(", ");

    case "date": {
      const start = prop.date?.start;
      if (!start) return "";
      return prop.date?.end ? `${start} → ${prop.date.end}` : String(start);
    }

    case "people": {
      const names = await Promise.all(
        (prop.people ?? []).map((p: any) => personName(p, resolveUser))
      );
      return names.filter(Boolean).join(", ");
    }

    case "checkbox":
      return prop.checkbox ? "Yes" : "No";

    case "url":
      return prop.url ?? "";
    case "email":
      return prop.email ?? "";
    case "phone_number":
      return prop.phone_number ?? "";

    case "files":
      return (prop.files ?? []).map((f: any) => f?.name).filter(Boolean).join(", ");

    case "formula": {
      const f = prop.formula ?? {};
      if (f.type === "string") return f.string ?? "";
      if (f.type === "number") return f.number === null ? "" : String(f.number);
      if (f.type === "boolean") return f.boolean ? "Yes" : "No";
      if (f.type === "date") return f.date?.start ?? "";
      return "";
    }

    case "rollup": {
      const r = prop.rollup ?? {};
      if (r.type === "number") return r.number === null ? "" : String(r.number);
      if (r.type === "date") return r.date?.start ?? "";
      if (r.type === "array") {
        const parts = await Promise.all(
          (r.array ?? []).map((item: any) => renderPropertyValue(item, resolveUser))
        );
        return parts.filter(Boolean).join(", ");
      }
      return "";
    }

    case "unique_id":
      return prop.unique_id?.number === undefined
        ? ""
        : `${prop.unique_id.prefix ? `${prop.unique_id.prefix}-` : ""}${prop.unique_id.number}`;

    case "created_time":
      return prop.created_time ?? "";
    case "last_edited_time":
      return prop.last_edited_time ?? "";

    case "created_by":
      return prop.created_by ? await personName(prop.created_by, resolveUser) : "";
    case "last_edited_by":
      return prop.last_edited_by ? await personName(prop.last_edited_by, resolveUser) : "";

    // relation ids are opaque without another round-trip; the count still says
    // "this is linked to something", which beats silence.
    case "relation":
      return (prop.relation ?? []).length ? `${prop.relation.length} linked item(s)` : "";

    default:
      return "";
  }
}

/**
 * Render every non-title property as `Name: value` lines.
 *
 * This is the part that answers "who was given which task, and when" — it is
 * pure metadata in Notion's model, and invisible to a block-tree walk.
 */
export async function renderProperties(
  page: any,
  resolveUser: UserResolver
): Promise<string> {
  const props = page?.properties ?? {};
  const lines: string[] = [];

  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (prop?.type === "title") continue; // rendered separately as the heading
    const value = await renderPropertyValue(prop, resolveUser);
    if (value) lines.push(`${key}: ${value}`);
  }

  return lines.join("\n");
}

export function extractTitle(page: any): string {
  const props = page?.properties ?? {};
  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (prop?.type === "title" && prop.title?.length) {
      return richText(prop.title).trim();
    }
  }
  return "(untitled)";
}

/* ------------------------------------------------------------------ blocks */

const HEADING_PREFIX: Record<string, string> = {
  heading_1: "# ",
  heading_2: "## ",
  heading_3: "### ",
};

/**
 * Plain text for one block. Returns "" for blocks that carry no readable
 * content (dividers, tables of contents, breadcrumbs) — their children, if
 * any, are still walked by the caller.
 */
export function extractTextFromBlock(block: any): string {
  const type = block?.type as string;
  const content = block?.[type];
  if (!type || !content) return "";

  switch (type) {
    case "paragraph":
    case "toggle":
    case "template":
      return richText(content.rich_text).trim();

    case "heading_1":
    case "heading_2":
    case "heading_3": {
      const text = richText(content.rich_text).trim();
      return text ? `${HEADING_PREFIX[type]}${text}` : "";
    }

    case "bulleted_list_item":
    case "numbered_list_item": {
      const text = richText(content.rich_text).trim();
      return text ? `- ${text}` : "";
    }

    case "to_do": {
      const text = richText(content.rich_text).trim();
      return text ? `- [${content.checked ? "x" : " "}] ${text}` : "";
    }

    case "quote": {
      const text = richText(content.rich_text).trim();
      return text ? `> ${text}` : "";
    }

    case "callout": {
      const text = richText(content.rich_text).trim();
      return text ? `> ${text}` : "";
    }

    case "code": {
      const text = richText(content.rich_text).trim();
      if (!text) return "";
      return `\`\`\`${content.language ?? ""}\n${text}\n\`\`\``;
    }

    case "table_row":
      return (content.cells ?? [])
        .map((cell: any[]) => richText(cell))
        .join(" | ");

    // Sub-pages and inline databases arrive separately in the search results,
    // but naming them here preserves the page's structure.
    case "child_page":
      return content.title ? `[Sub-page] ${content.title}` : "";
    case "child_database":
      return content.title ? `[Database] ${content.title}` : "";

    case "bookmark":
    case "embed":
    case "link_preview": {
      const caption = richText(content.caption).trim();
      return [content.url, caption].filter(Boolean).join(" — ");
    }

    case "image":
    case "video":
    case "file":
    case "pdf":
    case "audio": {
      // No OCR yet, but the caption and file name are often the only place a
      // diagram's meaning is written down.
      const caption = richText(content.caption).trim();
      const name = content.name ?? "";
      const label = [name, caption].filter(Boolean).join(" — ");
      return label ? `[${type}] ${label}` : "";
    }

    case "equation":
      return content.expression ? String(content.expression).trim() : "";

    // Structural only — content lives in their children.
    case "column_list":
    case "column":
    case "synced_block":
    case "table":
      return "";

    default:
      return "";
  }
}

/** Walk a block tree and flatten it to plain text — Notion keeps all body content in blocks. */
export async function extractPageText(
  accessToken: string,
  blockId: string,
  depth = 0
): Promise<string> {
  if (depth > 10) return ""; // pathological nesting guard

  const lines: string[] = [];
  let startCursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const url = `${NOTION_API}/blocks/${blockId}/children?page_size=100${
      startCursor ? `&start_cursor=${startCursor}` : ""
    }`;
    const res = await fetch(url, { headers: headers(accessToken) });
    if (!res.ok) {
      console.error(`[notion] block fetch failed for ${blockId}: ${res.status}`);
      break;
    }

    const data = await res.json();
    hasMore = data.has_more;
    startCursor = data.next_cursor ?? undefined;

    for (const block of data.results ?? []) {
      const text = extractTextFromBlock(block);
      if (text) lines.push(text);
      if (block.has_children) {
        await sleep(RATE_LIMIT_MS);
        const childText = await extractPageText(accessToken, block.id, depth + 1);
        if (childText) lines.push(childText);
      }
    }
    if (hasMore) await sleep(RATE_LIMIT_MS);
  }

  return lines.join("\n");
}

/* ---------------------------------------------------------------- comments */

/**
 * Page-level comments — the "meaningful conversations held by the members".
 *
 * Requires the integration's "read comments" capability. Without it Notion
 * answers 403, which is a configuration fact, not an error: we log once and
 * return "" so the rest of the page still syncs.
 */
export async function fetchPageComments(
  accessToken: string,
  pageId: string,
  resolveUser: UserResolver
): Promise<string> {
  const lines: string[] = [];
  let startCursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const url = `${NOTION_API}/comments?block_id=${pageId}&page_size=100${
      startCursor ? `&start_cursor=${startCursor}` : ""
    }`;

    let data: any;
    try {
      const res = await fetch(url, { headers: headers(accessToken) });
      if (!res.ok) {
        if (res.status === 403) {
          console.warn(
            "[notion] comments unavailable — grant the integration 'Read comments' " +
              "in Notion → Settings → Connections to capture member discussions."
          );
        } else {
          console.error(`[notion] comment fetch failed for ${pageId}: ${res.status}`);
        }
        break;
      }
      data = await res.json();
    } catch (err) {
      console.error(`[notion] comment fetch error for ${pageId}:`, err);
      break;
    }

    hasMore = data.has_more;
    startCursor = data.next_cursor ?? undefined;

    for (const comment of data.results ?? []) {
      const text = richText(comment?.rich_text).trim();
      if (!text) continue;
      const author = await personName(comment?.created_by, resolveUser);
      const when = comment?.created_time ? String(comment.created_time).slice(0, 10) : "";
      lines.push(`${author}${when ? ` (${when})` : ""}: ${text}`);
    }

    if (hasMore) await sleep(RATE_LIMIT_MS);
  }

  return lines.join("\n");
}

/* ---------------------------------------------------------------- assembly */

/**
 * Compose the four sources of meaning into one labelled document.
 *
 * The section headers are not decoration: they survive chunking, so a chunk
 * that happens to contain only the properties still tells the retriever it is
 * looking at task metadata rather than prose.
 */
export function composePageDocument(parts: {
  title: string;
  properties: string;
  body: string;
  comments: string;
}): string {
  const sections: string[] = [];

  if (parts.title && parts.title !== "(untitled)") sections.push(`# ${parts.title}`);
  if (parts.properties.trim()) sections.push(`## Details\n${parts.properties.trim()}`);
  if (parts.body.trim()) sections.push(parts.body.trim());
  if (parts.comments.trim()) sections.push(`## Discussion\n${parts.comments.trim()}`);

  return sections.join("\n\n").trim();
}

/**
 * Is this document worth storing and embedding?
 *
 * A page whose only content is its title tells the Brain nothing, and the
 * Python normaliser rejects anything under 10 characters outright. Anything
 * with real properties, body or comments clears this easily.
 */
export function hasSubstance(document: string, title: string): boolean {
  const withoutTitle = document.replace(`# ${title}`, "").trim();
  return withoutTitle.length >= 10;
}

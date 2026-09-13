/**
 * Pure text/formatting helpers shared by the chat API route and the chat UIs.
 * Keep this module side-effect free — it is unit-tested in isolation.
 */

/**
 * Strip machine noise from email-derived text so only human-readable content
 * remains: full URLs, percent-encoded tracking fragments, query-param chains,
 * and opaque tokens (nothing readable is 40+ chars without a space).
 */
export function cleanForDisplay(raw: string): string {
  return String(raw || "")
    .replace(/https?:\/\/[^\s]+/g, " ")
    .replace(/[^\s]*%[0-9A-Fa-f]{2}[^\s]*/g, " ")
    .replace(/[^\s]*[?&][\w-]+=[^\s]*/g, " ")
    .replace(/[^\s]{40,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Truncate on a word boundary, appending an ellipsis when cut. */
export function truncateWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max) + "…";
}

/** Derive a conversation title from the user's first question. */
export function deriveConversationTitle(firstQuestion: string): string {
  const clean = String(firstQuestion || "").replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return truncateWords(clean, 64);
}

/**
 * Compact relative time for list rows ("just now", "5m", "3h", "2d"),
 * falling back to a locale date beyond a week.
 */
export function formatRelativeTime(iso: string | Date, now: Date = new Date()): string {
  const then = typeof iso === "string" ? new Date(iso) : iso;
  const secs = Math.max(0, (now.getTime() - then.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Short display label for a URL rendered as a link ("linkedin.com/jobs/…"). */
export function shortUrlLabel(url: string, max = 42): string {
  const label = url.replace(/^https?:\/\/(www\.)?/, "");
  return label.length > max ? label.slice(0, max - 3) + "…" : label;
}

/**
 * Collect the unique citations across a conversation's assistant messages
 * (deduped by source+title+url) — used by the logs Details panel.
 */
export function aggregateCitations<
  T extends { citations?: { source: string; title: string; url: string | null }[] | undefined }
>(messages: T[], cap = 8) {
  const seen = new Set<string>();
  const out: NonNullable<T["citations"]> = [] as never;
  for (const m of messages) {
    for (const c of m.citations ?? []) {
      const key = `${c.source}|${c.title}|${c.url ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c as never);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

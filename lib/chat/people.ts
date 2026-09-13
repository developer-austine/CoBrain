import type { RetrievedDocument } from "./documents";

/**
 * Who-does-what extraction.
 *
 * "Who are the devs?" is the most common question asked of a company brain,
 * and it is answerable without a language model: our own extractors emit
 * ownership in a canonical form (`Assigned To: LYNN BITOK` from Notion
 * properties, an author column in a Brain digest, a resolved page creator), so
 * the roster can be read straight off the retrieved documents.
 *
 * That matters for two reasons. It is exact — no model paraphrasing a name
 * into something almost right — and it keeps the product answering questions
 * when synthesis is unavailable. When the model IS available, the same roster
 * goes into its context as structured fact rather than something it has to
 * infer from prose.
 *
 * Pure module — no I/O, unit-tested in isolation.
 */

/** Property names our sources use to express ownership. */
const OWNERSHIP_FIELDS = [
  "assigned to",
  "assignee",
  "assignees",
  "owner",
  "owners",
  "responsible",
  "reviewer",
  "reviewers",
  "lead",
  "people",
  "person",
  // Authorship sign-offs. People sign documents they wrote or decided — the
  // line "Edited by: Developer-Austine" at the foot of a standards page is the
  // only record of who set that standard.
  "created by",
  "edited by",
  "written by",
  "prepared by",
  "updated by",
  "decided by",
  "approved by",
  "author",
];

const OWNERSHIP_LINE = new RegExp(
  `^\\s*(${OWNERSHIP_FIELDS.join("|")})\\s*:\\s*(.+)$`,
  "i"
);

/**
 * Values that are placeholders rather than people. Notion writes "Not stated"
 * through our own renderer, and an unresolved integration user comes back as a
 * bare UUID — neither belongs in a roster of colleagues.
 */
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NON_PEOPLE = new Set([
  "not stated",
  "unknown",
  "unassigned",
  "none",
  "n/a",
  "-",
  "cobrain ai",
  "you",
  "ai",
]);

/**
 * `"CodePen" <support@codepen.io>` — an RFC-5322 mailbox. These are email
 * correspondents (newsletters, vendors, no-reply robots), never colleagues,
 * and letting them into a roster is what turns "who are the devs?" into a list
 * of mailing lists.
 */
const MAILBOX = /<[^>]+@[^>]+>/;

function isPersonName(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 60) return false;
  if (NON_PEOPLE.has(v.toLowerCase())) return false;
  if (UUID_LIKE.test(v)) return false;
  if (MAILBOX.test(v)) return false;
  if (v.includes("@")) return false;
  // Reject sentences: a name is a handful of words, not a clause.
  if (v.split(/\s+/).length > 4) return false;

  // An ownership field does not only ever contain people. Documentation writes
  // "Owner: billing, user management, full control" to mean areas of
  // responsibility, and those phrases sailed through every check above and
  // appeared in the roster as colleagues.
  //
  // Real names are capitalised ("LYNN BITOK", "Miss Kwara") or are handles
  // ("developer-austine"). A lowercase common-noun phrase is neither.
  const hasCapital = /[A-Z]/.test(v);
  const isHandle = !/\s/.test(v) && /[-_.]/.test(v);
  if (!hasCapital && !isHandle) return false;

  // A trailing full stop marks a sentence fragment ("all data."), not a name.
  // A single trailing initial ("Austine O.") is fine.
  if (/[a-z]{2,}\.$/.test(v)) return false;

  return true;
}

function tidyName(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, " ");
}

/**
 * Sources where a document's author is a colleague rather than a correspondent.
 * Gmail is excluded: whoever sent an email is someone you receive mail from,
 * which is not the same as someone you work with.
 */
const AUTHOR_IS_A_COLLEAGUE = new Set(["notion", "github", "slack", "drive", "custom"]);

/** One person and the work attributed to them across the retrieved documents. */
export type PersonAttribution = {
  name: string;
  /** Titles of the documents naming this person, in retrieval order. */
  items: string[];
  /** Sources those documents came from. */
  sources: string[];
  /**
   * How we know about them.
   *
   * "ownership" — something is explicitly assigned to them. This is a person
   * who works here, stated as fact by the source.
   * "author"    — they merely created or sent a document. Weaker, and it picks
   *               up non-humans: a Notion page's creator can resolve to the
   *               workspace or an integration ("Marsoney Labs"), which is a
   *               wrong answer to "who are the devs?".
   */
  evidence: "ownership" | "author";
};

type DocLike = Pick<RetrievedDocument, "text" | "source"> & {
  title?: string;
  displayAuthor?: string | null;
};

/**
 * Read the ownership lines out of one document's text.
 * Multi-person values ("Miss Kwara, LYNN BITOK") split on commas and "and".
 */
export function namesInText(text: string): string[] {
  const found: string[] = [];

  for (const line of (text || "").split("\n")) {
    const match = line.match(OWNERSHIP_LINE);
    if (!match) continue;
    for (const part of match[2].split(/,| and /i)) {
      const name = tidyName(part);
      if (isPersonName(name)) found.push(name);
    }
  }

  return found;
}

/**
 * Every person one document contributes, with how we know about them.
 *
 * Single source of truth for "does this document name anyone?", so the roster
 * and the evidence shown beneath it can never disagree — a newsletter whose
 * sender we deliberately ignore must not then be quoted as proof of a name.
 */
export function namesFromDocument(
  doc: DocLike
): { name: string; evidence: PersonAttribution["evidence"] }[] {
  const out: { name: string; evidence: PersonAttribution["evidence"] }[] = [];

  // An explicit ownership field is a statement that this person is responsible
  // for something — always trustworthy, whatever the source.
  for (const name of namesInText(doc.text)) out.push({ name, evidence: "ownership" });

  // A document's author is weaker evidence, and on email it is usually a
  // stranger: the sender of a newsletter is not a colleague. Only sources that
  // represent internal collaboration contribute authors.
  if (
    doc.displayAuthor &&
    AUTHOR_IS_A_COLLEAGUE.has(doc.source) &&
    isPersonName(tidyName(doc.displayAuthor))
  ) {
    out.push({ name: doc.displayAuthor, evidence: "author" });
  }

  return out;
}

/**
 * Build the roster: every person named across the documents, ordered by how
 * much of the retrieved material they appear in (most-involved first).
 *
 * Names are matched case-insensitively but reported using the first spelling
 * seen, so "LYNN BITOK" and "Lynn Bitok" collapse to one person.
 */
export function attributePeople(docs: DocLike[]): PersonAttribution[] {
  const byKey = new Map<string, PersonAttribution>();

  const record = (
    rawName: string,
    doc: DocLike,
    evidence: PersonAttribution["evidence"]
  ) => {
    const name = tidyName(rawName);
    if (!isPersonName(name)) return;
    const key = name.toLowerCase();

    let entry = byKey.get(key);
    if (!entry) {
      entry = { name, items: [], sources: [], evidence };
      byKey.set(key, entry);
    }
    // Any explicit assignment upgrades a person we had only seen as an author.
    if (evidence === "ownership") entry.evidence = "ownership";

    const title = (doc.title || "").trim();
    if (title && !entry.items.includes(title)) entry.items.push(title);
    if (doc.source && !entry.sources.includes(doc.source)) entry.sources.push(doc.source);
  };

  for (const doc of docs) {
    for (const { name, evidence } of namesFromDocument(doc)) record(name, doc, evidence);
  }

  return [...byKey.values()].sort(
    (a, b) =>
      Number(b.evidence === "ownership") - Number(a.evidence === "ownership") ||
      b.items.length - a.items.length ||
      a.name.localeCompare(b.name)
  );
}

/** Words that describe people generically rather than naming a topic. */
const PEOPLE_VOCABULARY =
  /^(who|whom|whose|devs?|developers?|engineers?|team|teams?|teammates?|members?|staff|colleagues?|people|persons?|everyone|roster|assignees?|owners?|company|companies|org|organisation|organization|working|works|work)$/;

/**
 * Is the user asking who someone is, rather than what happened?
 *
 * Kept narrow on purpose: it only fires on questions that are explicitly about
 * people, because the consequence of a false positive is answering "who?" when
 * the user asked "what?".
 */
export function isPeopleQuestion(query: string): boolean {
  const q = (query || "").toLowerCase();
  if (/\bwho(m|se)?\b/.test(q)) return true;
  return /\b(devs?|developers?|engineers?|team|teammates?|members?|staff|colleagues?|people|everyone|roster|assignees?|owners?)\b/.test(
    q
  );
}

/**
 * Does this people-question ask for the whole roster, or for one attribution?
 *
 * "Who are the devs in the company?" is entirely made of people-words — there
 * is no subject to narrow to, so the answer is everyone. "Who made the edit of
 * coding best practices?" carries a subject ("coding best practices"), and
 * answering it with a roster of the whole company is not a partial answer, it
 * is the wrong question answered loudly.
 *
 * The test is whether anything survives once the people-words are removed.
 */
export function isRosterQuestion(query: string): boolean {
  return subjectTerms(query).length === 0;
}

/** The content words of a question, minus generic people vocabulary. */
export function subjectTerms(query: string): string[] {
  return (query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !PEOPLE_VOCABULARY.test(t) && !GENERIC_TERMS.test(t));
}

/**
 * Question scaffolding that names no subject. Deliberately small: over-trimming
 * here turns an attribution question into a roster question, which is the exact
 * failure this distinction exists to prevent.
 */
const GENERIC_TERMS =
  /^(the|and|for|are|was|were|did|does|has|have|had|what|when|where|why|how|which|about|from|with|this|that|these|those|there|here|into|onto|over|under|made|make|makes|making|said|say|says|tell|show|give|list|find|search|look|looking|page|pages|document|documents|doc|docs|source|sources|our|your|their|its|his|her|can|will|would|should|could|been|being|any|all|some|more|most|much|many|now|then|than|but|not|out|off|per|via|only|just|also|does|doing|done)$/;

/** Longest item title kept in a roster cell before it stops being scannable. */
const MAX_ITEM_CHARS = 48;

/** Items a person shows in the table before the rest are counted instead. */
const MAX_ITEMS_SHOWN = 3;

/**
 * A roster cell should be scannable, not exhaustive.
 *
 * Someone with thirty commits produces a cell containing thirty semicolon-joined
 * commit messages, which pushes the table wide and tells the reader nothing they
 * could not get from the count beside it.
 */
function summariseItems(items: string[]): string {
  if (items.length === 0) return "—";

  const shown = items
    .slice(0, MAX_ITEMS_SHOWN)
    .map((i) => (i.length > MAX_ITEM_CHARS ? `${i.slice(0, MAX_ITEM_CHARS - 1).trimEnd()}…` : i));

  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join("; ")} +${rest} more` : shown.join("; ");
}

/**
 * Markdown roster: names first, then what each person owns.
 *
 * People with work explicitly assigned to them are the answer to "who works
 * here". Anyone known only as a document author is reported separately and
 * hedged, because that set includes workspaces and integrations, not just
 * humans.
 */
export function renderRoster(people: PersonAttribution[]): string {
  if (people.length === 0) return "";

  const owners = people.filter((p) => p.evidence === "ownership");
  const authors = people.filter((p) => p.evidence === "author");
  const headline = owners.length > 0 ? owners : people;

  const names = headline.map((p) => `**${p.name}**`).join(", ");
  const rows = headline
    .map((p) => `| ${p.name} | ${p.items.length} | ${summariseItems(p.items)} |`)
    .join("\n");

  let out = `${names}\n\n| Person | Items | Assigned work |\n| --- | --- | --- |\n${rows}`;

  if (owners.length > 0 && authors.length > 0) {
    out +=
      `\n\nAlso appearing as document authors (may include workspaces or bots, ` +
      `not only people): ${authors.map((p) => p.name).join(", ")}.`;
  }
  return out;
}

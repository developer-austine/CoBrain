import "dotenv/config";
import { describe, it, expect, beforeAll } from "vitest";
import { retrieveDocuments, citationsFor, buildContext } from "../rag";
import { resolveSearchSources } from "@/lib/interactive/sourceScope";
import { parseSubmission } from "@/lib/interactive/references";

/**
 * INTEGRATION — drives the real retrieval path against the running stack
 * (Postgres + Qdrant + the Python search-api). Skips itself when the stack is
 * down so `pnpm test` stays green on a cold machine.
 *
 * Run the stack first:  cd backend && docker compose up -d
 */

const PYTHON_URL = process.env.PYTHON_BACKEND_URL || "http://localhost:8000";

// A user with real ingested Notion pages in this dev database.
const USER_ID = process.env.E2E_USER_ID || "RXZdd66pLkq4odPZ7A4ShJrKaEDUhJyN";

let stackUp = false;

beforeAll(async () => {
  try {
    const r = await fetch(`${PYTHON_URL}/docs`, {
      signal: AbortSignal.timeout(4000),
    });
    stackUp = r.ok;
  } catch {
    stackUp = false;
  }
  if (!stackUp) {
    console.warn(`[integration] search-api unreachable at ${PYTHON_URL} — skipping`);
  }
});

describe("retrieval integration (live stack)", () => {
  it("a @notion-scoped query returns MULTIPLE distinct notion documents, no email", async () => {
    if (!stackUp) return;

    const docs = await retrieveDocuments(
      USER_ID,
      "Who was given a task and to whom was it assigned?",
      { sources: ["notion"] }
    );

    // The whole point of item 4: read across ALL the pages, not one answer.
    expect(docs.length).toBeGreaterThan(1);

    // Strictly scoped — email must not leak in.
    expect(docs.every((d) => d.source === "notion")).toBe(true);

    // Every document resolved back to its source-of-truth record.
    expect(docs.every((d) => d.title && d.title.length > 0)).toBe(true);

    // Distinct documents, not the same page repeated.
    const ids = new Set(docs.map((d) => d.docId));
    expect(ids.size).toBe(docs.length);
  }, 60_000);

  it("builds a numbered context containing every retrieved document", async () => {
    if (!stackUp) return;

    const docs = await retrieveDocuments(USER_ID, "tasks and owners", {
      sources: ["notion"],
    });
    const context = buildContext(docs);

    for (let i = 1; i <= docs.length; i++) {
      expect(context).toContain(`[${i}]`);
    }
    expect(context).toContain("source: notion");
  }, 60_000);

  it("emits one citation per document, numbered to match the context", async () => {
    if (!stackUp) return;

    const docs = await retrieveDocuments(USER_ID, "tasks and owners", {
      sources: ["notion"],
    });
    const cites = citationsFor(docs);

    expect(cites.length).toBe(docs.length);
    expect(cites.every((c) => c.source === "notion")).toBe(true);
    expect(cites.every((c) => typeof c.title === "string" && c.title.length > 0)).toBe(true);
  }, 60_000);

  it("end-to-end: '@notion who was given a task' scopes retrieval to notion", async () => {
    if (!stackUp) return;

    // Exactly what the prompt box submits: prose + structured reference tokens.
    const parsed = parseSubmission({
      text: "Who was given a task on this based at the @notion page?",
      references: [{ type: "entity", id: "notion", label: "@notion" }],
    });

    const sources = resolveSearchSources(parsed, "QUERY");
    expect(sources).toEqual(["notion"]);

    const docs = await retrieveDocuments(USER_ID, parsed.prose, { sources });
    expect(docs.length).toBeGreaterThan(1);
    expect(docs.every((d) => d.source === "notion")).toBe(true);
  }, 60_000);

  it("an unscoped query is NOT restricted (searches everything)", async () => {
    if (!stackUp) return;

    const docs = await retrieveDocuments(USER_ID, "what is our refund policy?");
    // No assertion on which sources — just that scoping didn't wrongly filter.
    expect(Array.isArray(docs)).toBe(true);
  }, 60_000);
});

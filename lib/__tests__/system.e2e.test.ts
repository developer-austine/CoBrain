import "dotenv/config";
import { describe, it, expect, beforeAll } from "vitest";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/queue/publisher";
import { retrieveDocuments } from "@/lib/chat/rag";
import { storageReachable } from "@/lib/sources/storage";
import { parseSubmission } from "@/lib/interactive/references";
import { classifyIntent } from "@/lib/interactive/intentClassifier";
import { resolveSearchSources } from "@/lib/interactive/sourceScope";
import { draftFromWritePrompt, writeBrainBlock } from "@/lib/interactive/pageMutation";
import { resolveKnowledgeScope } from "@/lib/workflow/knowledgeScope";

/**
 * SYSTEM E2E — exercises every layer of the running stack end to end:
 *
 *   Postgres · Redis · Qdrant (+ payload indexes) · MinIO · Python search-api
 *   · retrieval → document regrouping → citation resolution
 *   · the @-mention → intent → source-scope routing that drives chat
 *
 * Skips itself when the stack is down so `pnpm test` stays green on a cold
 * machine.  Bring it up first:  cd backend && docker compose up -d
 */

const PYTHON_URL = process.env.PYTHON_BACKEND_URL || "http://localhost:8000";
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const COLLECTION = process.env.QDRANT_COLLECTION || "company_brain";
const USER_ID = process.env.E2E_USER_ID || "RXZdd66pLkq4odPZ7A4ShJrKaEDUhJyN";

let up = false;

beforeAll(async () => {
  try {
    const r = await fetch(`${PYTHON_URL}/docs`, { signal: AbortSignal.timeout(4000) });
    up = r.ok;
  } catch {
    up = false;
  }
  if (!up) console.warn(`[e2e] stack unreachable at ${PYTHON_URL} — skipping`);
});

describe("E2E · infrastructure", () => {
  it("Postgres is reachable and the schema is migrated", async () => {
    if (!up) return;
    await expect(prisma.$queryRaw`SELECT 1`).resolves.toBeDefined();
    // Tables added by this work must exist.
    await expect(prisma.sourceFile.count()).resolves.toBeGreaterThanOrEqual(0);
    await expect(prisma.workflowLink.count()).resolves.toBeGreaterThanOrEqual(0);
    await expect(prisma.brainBlock.count()).resolves.toBeGreaterThanOrEqual(0);
  }, 30_000);

  it("Redis (the ingestion queue) accepts commands", async () => {
    if (!up) return;
    await expect(redis.ping()).resolves.toBe("PONG");
  }, 20_000);

  it("MinIO object storage is reachable", async () => {
    if (!up) return;
    await expect(storageReachable()).resolves.toBe(true);
  }, 20_000);

  it("Qdrant has keyword payload indexes on namespace AND source", async () => {
    if (!up) return;
    // Without these, every source-filtered search full-scans the collection
    // and times out. This is the regression guard for that bug.
    const r = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`);
    const schema = (await r.json()).result.payload_schema ?? {};

    expect(schema.source?.data_type).toBe("keyword");
    expect(schema.namespace?.data_type).toBe("keyword");
  }, 20_000);
});

describe("E2E · source-scoped vector search", () => {
  it("restricts results to the requested source (no email bleed)", async () => {
    if (!up) return;

    const search = async (sources?: string[]) => {
      const r = await fetch(`${PYTHON_URL}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "what tasks were assigned and to whom",
          namespace: "*",
          limit: 15,
          ...(sources ? { sources } : {}),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const d = await r.json();
      return (d.results ?? []) as { source: string }[];
    };

    const notionOnly = await search(["notion"]);
    expect(notionOnly.length).toBeGreaterThan(0);
    expect(notionOnly.every((x) => x.source === "notion")).toBe(true);

    const gmailOnly = await search(["gmail"]);
    expect(gmailOnly.every((x) => x.source === "gmail")).toBe(true);

    // Unscoped is where email dominates — that's the behaviour we scope away from.
    const all = await search();
    expect(all.length).toBeGreaterThan(0);
  }, 90_000);
});

describe("E2E · the full chat routing path", () => {
  it("'@notion who was given a task' → QUERY, scoped to notion, many docs, all cited", async () => {
    if (!up) return;

    // 1. Exactly what the prompt box submits.
    const submission = {
      text: "Who was given a task on this based at the @notion page?",
      references: [{ type: "entity" as const, id: "notion", label: "@notion" }],
    };

    // 2. Parse → prose + structured refs.
    const p = parseSubmission(submission);
    expect(p.contextRefs.map((r) => r.id)).toEqual(["notion"]);

    // 3. Classify → a question, not a write.
    const classified = await classifyIntent(p);
    expect(classified.intent).toBe("QUERY");

    // 4. Scope → notion only (email excluded).
    const sources = resolveSearchSources(p, classified.intent);
    expect(sources).toEqual(["notion"]);

    // 5. Retrieve → MULTIPLE whole documents, every one resolved + linkable.
    const docs = await retrieveDocuments(USER_ID, p.prose, { sources });
    expect(docs.length).toBeGreaterThan(1);
    expect(docs.every((d) => d.source === "notion")).toBe(true);
    expect(docs.every((d) => d.title.length > 0)).toBe(true);
    expect(new Set(docs.map((d) => d.docId)).size).toBe(docs.length);
  }, 90_000);

  it("'edit the @brain page with tasks from @notion' → WRITE, still reads notion", async () => {
    if (!up) return;

    const p = parseSubmission({
      text: "Edit the @brain page with who was given a task from @notion and why",
      references: [
        { type: "page" as const, id: "brain", label: "@brain" },
        { type: "entity" as const, id: "notion", label: "@notion" },
      ],
    });

    expect(p.writeTargets).toEqual(["brain"]);

    // The destination is @brain, but the SOURCE we read must be notion.
    const sources = resolveSearchSources(p, "WRITE");
    expect(sources).toEqual(["notion"]);

    const docs = await retrieveDocuments(USER_ID, p.prose, { sources });
    expect(docs.every((d) => d.source === "notion")).toBe(true);
  }, 90_000);
});

describe("E2E · brain write round-trip", () => {
  it("a human WRITE persists an active, typed brain block (then cleans up)", async () => {
    if (!up) return;

    const draft = draftFromWritePrompt(
      "We decided to launch the closed beta on Friday because the investor demo is Monday."
    );
    // Keyword typing + human-authored gate.
    expect(draft.type).toBe("decision");
    expect(draft.createdBy).toBe("human");

    const block = await writeBrainBlock(USER_ID, draft);
    try {
      // Human-dictated content is authoritative → live immediately, not queued.
      expect(block.status).toBe("active");

      // It's really in Postgres and reads back with its provenance intact.
      const found = await prisma.brainBlock.findUnique({ where: { id: block.id } });
      expect(found).not.toBeNull();
      expect(found?.type).toBe("decision");
      expect(found?.createdBy).toBe("human");
      expect(found?.title.length).toBeGreaterThan(0);
    } finally {
      // Don't pollute the dev database.
      await prisma.brainBlock.delete({ where: { id: block.id } }).catch(() => {});
    }
  }, 30_000);
});

describe("E2E · workflow knowledge scope (DB round-trip)", () => {
  it("linked workflows expand a workflow's readable scope, transitively", async () => {
    if (!up) return;

    // Three throwaway workflows: A -> B -> C.
    const mk = (name: string) =>
      prisma.workflow.create({
        data: {
          userId: USER_ID,
          name: `__e2e_${name}_${Date.now()}`,
          definition: "{}",
          status: "draft",
        },
      });

    const [a, b, c] = await Promise.all([mk("A"), mk("B"), mk("C")]);
    try {
      await prisma.workflowLink.createMany({
        data: [
          { userId: USER_ID, sourceWorkflowId: a.id, targetWorkflowId: b.id },
          { userId: USER_ID, sourceWorkflowId: b.id, targetWorkflowId: c.id },
        ],
      });

      const links = await prisma.workflowLink.findMany({
        where: { userId: USER_ID, sourceWorkflowId: { in: [a.id, b.id] } },
        select: { sourceWorkflowId: true, targetWorkflowId: true },
      });

      // C reads itself + B + A (transitive); A reads only itself.
      const scopeC = resolveKnowledgeScope(c.id, links);
      expect(scopeC).toContain(c.id);
      expect(scopeC).toContain(b.id);
      expect(scopeC).toContain(a.id);

      const scopeA = resolveKnowledgeScope(a.id, links);
      expect(scopeA).toEqual([a.id]);
    } finally {
      // Cascade deletes the links with the workflows.
      await prisma.workflow
        .deleteMany({ where: { id: { in: [a.id, b.id, c.id] } } })
        .catch(() => {});
    }
  }, 30_000);
});

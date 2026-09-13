import { describe, expect, it } from "vitest";
import {
  chunkDocument,
  mergeCandidates,
  parseCandidateJson,
  reconcile,
  sameSubject,
  similarity,
  tokenize,
  type ExtractionCandidate,
} from "../extraction";

/**
 * The decisions that determine what actually lands in someone's brain.
 *
 * These are worth pinning hard: the failure modes are quiet ones. A chunker
 * that drops the tail loses the conclusion of every long document and nothing
 * reports an error; a reconciler that mis-matches either duplicates knowledge
 * forever or silently supersedes an unrelated block.
 */

const candidate = (over: Partial<ExtractionCandidate> = {}): ExtractionCandidate => ({
  type: "learned_fact",
  title: "Pricing model",
  body: "We charge per seat.",
  confidence: 0.8,
  ...over,
});

describe("chunkDocument", () => {
  it("ignores input too short to hold knowledge", () => {
    expect(chunkDocument("")).toEqual([]);
    expect(chunkDocument("   ")).toEqual([]);
    expect(chunkDocument("Invoice #4102")).toEqual([]);
  });

  it("keeps a normal document in one piece", () => {
    const doc = "x".repeat(5_000);
    expect(chunkDocument(doc)).toEqual([doc]);
  });

  it("covers the WHOLE document, including the last page", () => {
    // The point of the whole design: a decision recorded in the final
    // paragraph must reach the model. A fixed window count would drop it.
    const doc = "a".repeat(400_000) + "THE-FINAL-DECISION";
    const windows = chunkDocument(doc);

    expect(windows.length).toBeGreaterThan(1);
    expect(windows[windows.length - 1]).toContain("THE-FINAL-DECISION");

    const covered = windows.join("");
    expect(covered.length).toBeGreaterThanOrEqual(doc.length);
  });

  it("never exceeds the window cap, however long the input", () => {
    for (const len of [50_000, 500_000, 4_000_000]) {
      expect(chunkDocument("z".repeat(len)).length).toBeLessThanOrEqual(10);
    }
  });

  it("overlaps windows so a fact on a boundary survives in one piece", () => {
    const windows = chunkDocument("q".repeat(200_000));
    for (let i = 1; i < windows.length; i++) {
      const prevTail = windows[i - 1].slice(-100);
      expect(windows[i].startsWith(prevTail.slice(0, 50))).toBe(true);
    }
  });

  it("terminates on a document of any size", () => {
    // Guards the loop condition: a bad size/overlap pair would hang the worker
    // rather than fail, which is the worst way for this to break.
    expect(() => chunkDocument("w".repeat(10_000_000))).not.toThrow();
  });
});

describe("similarity", () => {
  it("ignores case, punctuation, and filler words", () => {
    expect(similarity("The Q3 Budget", "q3 budget")).toBe(1);
  });

  it("separates different subjects", () => {
    expect(similarity("Q3 budget", "hiring plan for engineering")).toBeLessThan(0.2);
  });

  it("cannot compare when a side has no content words", () => {
    expect(similarity("the a of", "Q3 budget")).toBe(0);
    expect(similarity("", "anything")).toBe(0);
  });

  it("drops stopwords from the token set", () => {
    expect(tokenize("the budget of the team")).toEqual(new Set(["budget", "team"]));
  });
});

describe("sameSubject", () => {
  it("matches a long title against its own short paraphrase", () => {
    // The pair that slipped through in a live run: symmetric overlap scores
    // these 0.29 because the longer title is penalised for being longer, so
    // both were written to the brain as separate decisions.
    const long = "Stay on Qdrant rather than migrate to pgvector";
    const short = "The Qdrant vs pgvector decision";

    expect(similarity(long, short)).toBeLessThan(0.4);
    expect(sameSubject(long, short)).toBeGreaterThanOrEqual(0.6);
  });

  it("is symmetric regardless of argument order", () => {
    const a = "Billing moves to per-document pricing in October";
    const b = "Billing model";
    expect(sameSubject(a, b)).toBe(sameSubject(b, a));
  });

  it("still separates unrelated subjects", () => {
    expect(sameSubject("Q3 budget planning", "Kubernetes upgrade path")).toBe(0);
    expect(sameSubject("Hiring plan for design", "Vector store latency")).toBe(0);
  });

  it("does not let a one-word title swallow every longer title", () => {
    // Containment alone would score this 1.0 and merge two real subjects.
    expect(sameSubject("Billing", "Billing model changes for enterprise")).toBeLessThan(0.6);
  });

  it("requires real overlap, not one shared word out of many", () => {
    expect(
      sameSubject("Pricing changes for enterprise customers", "Pricing")
    ).toBeLessThan(0.6);
  });
});

describe("mergeCandidates", () => {
  it("collapses the same fact found by overlapping windows", () => {
    const merged = mergeCandidates([
      candidate({ title: "Pricing model", confidence: 0.6 }),
      candidate({ title: "The pricing model", confidence: 0.9 }),
    ]);

    expect(merged).toHaveLength(1);
    // The better-supported statement is the one kept.
    expect(merged[0].confidence).toBe(0.9);
  });

  it("keeps same-titled candidates of genuinely different types", () => {
    const merged = mergeCandidates([
      candidate({ title: "Pricing model", type: "learned_fact" }),
      candidate({ title: "Pricing model", type: "decision" }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("caps how much one document can push into the review queue", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      candidate({ title: `Distinct subject number ${i}` })
    );
    expect(mergeCandidates(many).length).toBeLessThanOrEqual(12);
  });

  it("handles an empty read", () => {
    expect(mergeCandidates([])).toEqual([]);
  });
});

describe("reconcile", () => {
  const existing = [
    {
      id: "blk_1",
      type: "learned_fact",
      title: "Pricing model",
      body: "We charge per seat, billed monthly.",
    },
  ];

  it("creates when the brain has never seen the subject", () => {
    const [decision] = reconcile([candidate({ title: "Refund policy" })], existing);
    expect(decision.action).toBe("create");
  });

  it("skips a re-read of something already known", () => {
    // Re-uploading the same file must not duplicate the brain.
    const [decision] = reconcile(
      [candidate({ body: "We charge per seat, billed monthly." })],
      existing
    );
    expect(decision.action).toBe("skip");
  });

  it("supersedes when the same subject now says something different", () => {
    const [decision] = reconcile(
      [candidate({ body: "Pricing moved to usage-based billing in March, replacing per-seat." })],
      existing
    );
    expect(decision.action).toBe("update");
    if (decision.action === "update") expect(decision.supersedes).toBe("blk_1");
  });

  it("treats an empty brain as all-new", () => {
    const decisions = reconcile([candidate(), candidate({ title: "Refunds" })], []);
    expect(decisions.every((d) => d.action === "create")).toBe(true);
  });

  it("never supersedes across block types", () => {
    const [decision] = reconcile(
      [candidate({ type: "decision", body: "Something else entirely happened here." })],
      existing
    );
    expect(decision.action).toBe("create");
  });
});

describe("parseCandidateJson", () => {
  it("reads a plain array", () => {
    const rows = parseCandidateJson(
      '[{"type":"decision","title":"Move to Postgres","body":"We chose Postgres.","confidence":0.9}]'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("decision");
  });

  it("tolerates a code fence and surrounding prose", () => {
    const rows = parseCandidateJson(
      'Here is what I found:\n```json\n[{"title":"A","body":"B","type":"note","confidence":0.5}]\n```'
    );
    expect(rows).toHaveLength(1);
  });

  it("treats an empty array as the valid answer it is", () => {
    // Most sections of most documents contain no durable knowledge.
    expect(parseCandidateJson("[]")).toEqual([]);
  });

  it("returns nothing rather than throwing on unparseable output", () => {
    expect(parseCandidateJson("I could not read that document.")).toEqual([]);
    expect(parseCandidateJson('[{"title": broken')).toEqual([]);
    expect(parseCandidateJson("")).toEqual([]);
  });

  it("drops rows missing a title or body instead of writing empty blocks", () => {
    const rows = parseCandidateJson(
      '[{"title":"","body":"x"},{"title":"y","body":""},{"title":"ok","body":"real"}]'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("ok");
  });

  it("falls back to a known type and a sane confidence", () => {
    const [row] = parseCandidateJson('[{"type":"nonsense","title":"T","body":"B","confidence":42}]');
    expect(row.type).toBe("learned_fact");
    expect(row.confidence).toBeGreaterThan(0);
    expect(row.confidence).toBeLessThanOrEqual(1);
  });
});

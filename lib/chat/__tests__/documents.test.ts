import { describe, it, expect } from "vitest";
import { groupChunksByDocument, sourcesPresent } from "../documents";
import type { RetrievedChunk } from "../documents";

const chunk = (o: Partial<RetrievedChunk>): RetrievedChunk => ({
  text: "t",
  source: "notion",
  parent_doc_id: "d1",
  chunk_index: 0,
  score: 0.5,
  ...o,
});

describe("groupChunksByDocument", () => {
  it("collapses chunks of the same document into one entry", () => {
    const docs = groupChunksByDocument([
      chunk({ parent_doc_id: "d1", chunk_index: 0, text: "alpha", score: 0.9 }),
      chunk({ parent_doc_id: "d1", chunk_index: 1, text: "beta", score: 0.4 }),
    ]);
    expect(docs).toHaveLength(1);
    expect(docs[0].docId).toBe("d1");
    expect(docs[0].text).toBe("alpha\n\nbeta");
  });

  it("reassembles text in document order, not relevance order", () => {
    const docs = groupChunksByDocument([
      chunk({ chunk_index: 2, text: "third", score: 0.9 }),
      chunk({ chunk_index: 0, text: "first", score: 0.3 }),
      chunk({ chunk_index: 1, text: "second", score: 0.5 }),
    ]);
    expect(docs[0].text).toBe("first\n\nsecond\n\nthird");
  });

  it("ranks documents by their best chunk score", () => {
    const docs = groupChunksByDocument([
      chunk({ parent_doc_id: "low", score: 0.2 }),
      chunk({ parent_doc_id: "high", score: 0.95 }),
      chunk({ parent_doc_id: "mid", score: 0.6 }),
    ]);
    expect(docs.map((d) => d.docId)).toEqual(["high", "mid", "low"]);
    expect(docs[0].bestScore).toBe(0.95);
  });

  it("surfaces every distinct document (email cannot crowd out notion)", () => {
    // 5 email chunks from one doc + 1 chunk each from three notion pages.
    const chunks: RetrievedChunk[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        chunk({ parent_doc_id: "email1", source: "gmail", chunk_index: i, score: 0.9 })
      ),
      chunk({ parent_doc_id: "n1", source: "notion", score: 0.5 }),
      chunk({ parent_doc_id: "n2", source: "notion", score: 0.4 }),
      chunk({ parent_doc_id: "n3", source: "notion", score: 0.3 }),
    ];
    const docs = groupChunksByDocument(chunks);
    // 5 email chunks collapse to ONE document, so all 3 notion pages survive.
    expect(docs).toHaveLength(4);
    expect(docs.filter((d) => d.source === "notion")).toHaveLength(3);
  });

  it("dedupes identical chunk text within a document", () => {
    const docs = groupChunksByDocument([
      chunk({ chunk_index: 0, text: "same" }),
      chunk({ chunk_index: 1, text: "same" }),
    ]);
    expect(docs[0].text).toBe("same");
  });

  it("drops chunks with no parent document id", () => {
    const docs = groupChunksByDocument([
      chunk({ parent_doc_id: "" }),
      chunk({ parent_doc_id: "ok" }),
    ]);
    expect(docs.map((d) => d.docId)).toEqual(["ok"]);
  });

  it("handles an empty result set", () => {
    expect(groupChunksByDocument([])).toEqual([]);
  });
});

describe("sourcesPresent", () => {
  it("lists distinct sources", () => {
    const docs = groupChunksByDocument([
      chunk({ parent_doc_id: "a", source: "notion", score: 0.9 }),
      chunk({ parent_doc_id: "b", source: "gmail", score: 0.5 }),
      chunk({ parent_doc_id: "c", source: "notion", score: 0.4 }),
    ]);
    expect(sourcesPresent(docs)).toEqual(["notion", "gmail"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  codeDocuments,
  isCodeQuestion,
  renderCodeAnswer,
  stripIndexHeader,
  toCodeCitation,
} from "../codeAnswer";
import type { RetrievedDocument } from "../documents";

const doc = (o: Partial<RetrievedDocument> = {}): RetrievedDocument => ({
  docId: "d1",
  source: "github",
  author: "",
  timestamp: "",
  chunks: [],
  bestScore: 0.5,
  text: "code",
  ...o,
});

describe("isCodeQuestion", () => {
  it.each([
    "Where in the code repo do I load the RAG pipeline?",
    "which file defines the retrieval handler",
    "show me the function that builds the prompt",
  ])("detects %j", (q) => expect(isCodeQuestion(q)).toBe(true));

  it.each([
    // Wants the Notion decision page, not the source file.
    "what did we decide about the RAG pipeline?",
    "who are the devs in the company?",
    "where is the office located",
  ])("leaves %j to the normal answer path", (q) => {
    expect(isCodeQuestion(q)).toBe(false);
  });
});

describe("codeDocuments", () => {
  it("keeps only indexed source files", () => {
    const docs = [
      doc({ docId: "a", kind: "code", path: "lib/rag.ts" }),
      doc({ docId: "b", kind: "commit" }),
      doc({ docId: "c", source: "notion" }),
      // kind=code with no path cannot be rendered or linked.
      doc({ docId: "d", kind: "code", path: null }),
    ];
    expect(codeDocuments(docs).map((d) => d.docId)).toEqual(["a"]);
  });
});

describe("stripIndexHeader", () => {
  it("removes the preamble the indexer added for retrieval", () => {
    const stored =
      "# lib/chat/rag.ts\nrepository: acme/app | language: typescript | L12 | part 1/3\n\n" +
      "export function retrieve() {\n  return 1;\n}";

    expect(stripIndexHeader(stored)).toBe("export function retrieve() {\n  return 1;\n}");
  });

  it("leaves a file that genuinely starts with a heading alone", () => {
    const md = "# Title\n\nSome prose.";
    expect(stripIndexHeader(md)).toBe("Some prose.");
  });

  it("passes through text with no header", () => {
    expect(stripIndexHeader("const a = 1;")).toBe("const a = 1;");
  });
});

describe("toCodeCitation", () => {
  it("carries path, language and a deep link to the matched line", () => {
    const c = toCodeCitation(
      doc({
        kind: "code",
        path: "lib/chat/rag.ts",
        language: "typescript",
        repository: "acme/app",
        startLine: 42,
        text: "# lib/chat/rag.ts\nrepository: acme/app | language: typescript | L42 | part 1/2\n\nconst x = 1;",
      })
    );

    expect(c.path).toBe("lib/chat/rag.ts");
    expect(c.language).toBe("typescript");
    expect(c.startLine).toBe(42);
    expect(c.url).toBe("https://github.com/acme/app/blob/HEAD/lib/chat/rag.ts#L42");
    expect(c.code).toBe("const x = 1;");
  });

  it("omits the link when the repository is unknown", () => {
    expect(toCodeCitation(doc({ kind: "code", path: "a.ts" })).url).toBeNull();
  });
});

describe("renderCodeAnswer", () => {
  it("fences the code with its language so the UI can highlight it", () => {
    const out = renderCodeAnswer([
      {
        path: "lib/chat/rag.ts",
        language: "typescript",
        repository: "acme/app",
        startLine: 42,
        url: "https://github.com/acme/app/blob/HEAD/lib/chat/rag.ts#L42",
        code: "const x = 1;",
      },
    ]);

    expect(out).toContain("**`lib/chat/rag.ts:42`**");
    expect(out).toContain("```typescript\nconst x = 1;\n```");
    expect(out).toContain("[open on GitHub]");
  });

  it("is empty when nothing matched", () => {
    expect(renderCodeAnswer([])).toBe("");
  });
});

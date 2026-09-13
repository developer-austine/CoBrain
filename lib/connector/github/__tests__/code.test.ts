import { describe, expect, it } from "vitest";
import {
  chunkFile,
  embeddableText,
  fenceLanguageFor,
  languageFor,
  shouldIndex,
  MAX_INDEXABLE_BYTES,
} from "../code";

describe("languageFor", () => {
  it("maps source extensions to a splitter profile", () => {
    expect(languageFor("lib/chat/rag.ts")).toBe("js");
    expect(languageFor("backend/python/api/search.py")).toBe("python");
    expect(languageFor("cmd/main.go")).toBe("go");
  });

  it("indexes config and docs as plain text", () => {
    expect(languageFor("docker-compose.yml")).toBe("text");
    expect(languageFor("prisma/schema.prisma")).toBe("text");
  });

  it("refuses vendored and generated trees", () => {
    expect(languageFor("node_modules/react/index.js")).toBeNull();
    expect(languageFor("lib/generated/prisma/client.ts")).toBeNull();
    expect(languageFor(".next/server/app/page.js")).toBeNull();
  });

  it("refuses lockfiles — the largest files in a repo and the least useful", () => {
    expect(languageFor("pnpm-lock.yaml")).toBeNull();
    expect(languageFor("package-lock.json")).toBeNull();
    expect(languageFor("Cargo.lock")).toBeNull();
  });

  it("refuses binaries and minified bundles", () => {
    expect(languageFor("public/logo.png")).toBeNull();
    expect(languageFor("dist/app.min.js")).toBeNull();
  });
});

describe("shouldIndex", () => {
  it("skips a blob too large to be hand-written", () => {
    expect(shouldIndex({ path: "src/app.ts", size: MAX_INDEXABLE_BYTES + 1 })).toBe(false);
  });

  it("skips empty files", () => {
    expect(shouldIndex({ path: "src/app.ts", size: 0 })).toBe(false);
  });

  it("accepts ordinary source", () => {
    expect(shouldIndex({ path: "src/app.ts", size: 4000 })).toBe(true);
  });
});

describe("fenceLanguageFor", () => {
  it("labels fences so the chat renderer can highlight them", () => {
    expect(fenceLanguageFor("lib/chat/rag.ts")).toBe("typescript");
    expect(fenceLanguageFor("components/Chat.tsx")).toBe("tsx");
    expect(fenceLanguageFor("main.py")).toBe("python");
    expect(fenceLanguageFor("Makefile.unknown")).toBe("text");
  });
});

describe("chunkFile", () => {
  const tsSource = `import { a } from "./a";

export function loadPipeline(config: Config) {
  const store = connect(config.url);
  return store;
}

export class Retriever {
  constructor(private store: Store) {}

  search(query: string) {
    return this.store.query(query);
  }
}
`;

  it("returns nothing for a file that should not be indexed", async () => {
    expect(await chunkFile("pnpm-lock.yaml", "lockfile contents")).toEqual([]);
  });

  it("splits code and labels every chunk with its file and language", async () => {
    const chunks = await chunkFile("lib/pipeline.ts", tsSource, { chunkSize: 120 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.path).toBe("lib/pipeline.ts");
      expect(c.language).toBe("typescript");
      expect(c.total).toBe(chunks.length);
    }
  });

  it("preserves indentation — collapsing it changes what the code means", async () => {
    const chunks = await chunkFile("lib/pipeline.ts", tsSource, { chunkSize: 4000 });
    expect(chunks[0].text).toContain("  const store = connect(config.url);");
  });

  it("tracks the starting line so a citation can point into the file", async () => {
    const chunks = await chunkFile("lib/pipeline.ts", tsSource, { chunkSize: 120 });
    expect(chunks[0].startLine).toBe(1);
    // Later chunks start further down; monotonic non-decreasing is the contract.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startLine).toBeGreaterThanOrEqual(chunks[i - 1].startLine);
    }
  });
});

describe("embeddableText", () => {
  it("puts the path into the embedded text", async () => {
    // "where do we load the RAG pipeline" matches the PATH more reliably than
    // the code body, so the path has to be part of what gets embedded.
    const [chunk] = await chunkFile("lib/chat/rag.ts", "export const x = 1;\n".repeat(3));
    const text = embeddableText("acme/app", chunk);

    expect(text).toContain("# lib/chat/rag.ts");
    expect(text).toContain("repository: acme/app");
    expect(text).toContain("export const x = 1;");
  });
});

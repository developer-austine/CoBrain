import { describe, expect, it } from "vitest";
import {
  bestExcerpt,
  documentHeading,
  editDistanceWithin,
  lexicalBoost,
  queryTerms,
  rankDocuments,
} from "../ranking";
import type { RetrievedDocument } from "../documents";

const doc = (o: Partial<RetrievedDocument> = {}): RetrievedDocument => ({
  docId: "d1",
  source: "notion",
  author: "",
  timestamp: "",
  chunks: [],
  text: "body",
  bestScore: 0.5,
  ...o,
});

describe("queryTerms", () => {
  it("drops stopwords and question scaffolding", () => {
    expect(queryTerms("What decisions were made about coding best practises?")).toEqual([
      "decisions",
      "coding",
      "best",
      "practises",
    ]);
  });
});

describe("documentHeading", () => {
  it("reads the markdown heading our extractors emit", () => {
    expect(documentHeading("# Coding Best Practices & Standards\nbody text")).toBe(
      "Coding Best Practices & Standards"
    );
  });

  it("accepts a short unmarked first line as a title", () => {
    expect(documentHeading("AUTOMATIC TIMETABLE GENERATOR\nAbstract...")).toBe(
      "AUTOMATIC TIMETABLE GENERATOR"
    );
  });

  it("refuses mid-sentence prose — an email chunk has no heading", () => {
    expect(
      documentHeading("the 'best coding model in the world'. Explore new features, plus a look")
    ).toBe("");
  });
});

describe("editDistanceWithin", () => {
  it("forgives a single typo", () => {
    expect(editDistanceWithin("practises", "practices", 1)).toBe(true);
  });

  it("does not collapse genuinely different words", () => {
    expect(editDistanceWithin("coding", "coping", 1)).toBe(true); // 1 edit — guarded by length elsewhere
    expect(editDistanceWithin("coding", "trading", 1)).toBe(false);
  });
});

describe("lexicalBoost", () => {
  const query = "What decisions were made about coding best practises?";

  it("rewards a title match, tolerating the user's spelling", () => {
    const boost = lexicalBoost(query, {
      text: "# Coding Best Practices & Standards\nproject structure guidance",
    });
    expect(boost).toBeCloseTo(0.375, 3); // 3 of 4 terms in the title
  });

  it("barely rewards a newsletter that merely mentions the words", () => {
    const boost = lexicalBoost(query, {
      text: "the 'best coding model in the world'. Explore new features and benchmarks.",
    });
    expect(boost).toBeLessThan(0.1);
  });

  it("ranks the titled page above the newsletter despite a lower vector score", () => {
    const page = doc({
      docId: "page",
      bestScore: 0.25,
      text: "# Coding Best Practices & Standards\nproject structure",
    });
    const newsletter = doc({
      docId: "mail",
      source: "gmail",
      bestScore: 0.44,
      text: "the 'best coding model in the world'. Explore coding features.",
    });

    const ranked = rankDocuments(query, [newsletter, page], { maxDocs: 2 });
    expect(ranked[0].docId).toBe("page");
  });
});

describe("rankDocuments source caps", () => {
  // Distinct text per document: identical bodies are deliberately deduplicated,
  // which would otherwise collapse the fixture to a single result.
  const many = (source: string, n: number) =>
    Array.from({ length: n }, (_, i) =>
      doc({
        docId: `${source}${i}`,
        source,
        bestScore: 0.9 - i * 0.01,
        text: `${source} document number ${i}`,
      })
    );

  it("keeps a high-volume source from filling every slot", () => {
    const ranked = rankDocuments("status", [...many("gmail", 10), ...many("notion", 4)], {
      maxDocs: 8,
      perSourceCap: 5,
    });
    expect(ranked.filter((d) => d.source === "gmail").length).toBeLessThanOrEqual(5);
    expect(ranked.some((d) => d.source === "notion")).toBe(true);
  });

  it("applies a per-source override below the general cap", () => {
    const ranked = rankDocuments("status", [...many("gmail", 10), ...many("notion", 6)], {
      maxDocs: 8,
      perSourceCap: 5,
      sourceCaps: { gmail: 2 },
    });
    expect(ranked.filter((d) => d.source === "gmail")).toHaveLength(2);
  });

  it("lets an explicitly scoped search fill every slot", () => {
    const ranked = rankDocuments("status", many("notion", 10), { maxDocs: 6 });
    expect(ranked).toHaveLength(6);
  });
});

describe("bestExcerpt", () => {
  const page =
    "# Coding Best Practices & Standards\n" +
    "Here is the correct way we will go through our project structure.\n" +
    "It is a feature based folder where everything is organised into features.\n" +
    "In order for the configurations to work we configure .eslintrc.json.\n" +
    "HAPPY CODING!\n" +
    "Edited by: Developer-Austine";

  it("returns the whole document when it already fits", () => {
    expect(bestExcerpt("anything", "short doc", 100)).toBe("short doc");
  });

  it("follows the question to the relevant part of a long page", () => {
    const out = bestExcerpt("who edited the standards?", page, 80);
    expect(out).toContain("Developer-Austine");
  });

  it("keeps the heading for context when quoting from further down", () => {
    const out = bestExcerpt("eslintrc configurations", page, 90);
    expect(out.startsWith("Coding Best Practices & Standards —")).toBe(true);
    expect(out).toContain("eslintrc");
  });
});

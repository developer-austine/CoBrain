import { describe, expect, it } from "vitest";
import { parseSubmission, searchCatalog } from "@/lib/interactive/references";
import { classifyHeuristically } from "@/lib/interactive/intentClassifier";
import { decomposeConfigPrompt } from "@/lib/interactive/agentConfigurator";
import {
  CONFIDENCE_AUTO_WRITE,
  detectBlockType,
  draftFromWritePrompt,
  extractiveDraftFromSources,
  gateStatus,
  validateDraft,
} from "@/lib/interactive/pageMutation";
import type { ResolvedDocument } from "@/lib/chat/rag";
import type { PromptReference } from "@/lib/interactive/types";

const ref = (type: PromptReference["type"], id: string): PromptReference => ({
  type,
  id,
  label: `@${id}`,
});

describe("parseSubmission", () => {
  it("separates prose, write targets, model and context", () => {
    const parsed = parseSubmission({
      text: "@claude summarise last week's meetings and write to @brain",
      references: [ref("model", "claude"), ref("page", "brain")],
    });
    expect(parsed.model).toBe("claude");
    expect(parsed.writeTargets).toEqual(["brain"]);
    expect(parsed.prose).toBe("summarise last week's meetings and write to");
    expect(parsed.contextRefs).toHaveLength(0);
  });

  it("dedupes repeated references and ignores empty ids", () => {
    const parsed = parseSubmission({
      text: "note to @brain @brain",
      references: [ref("page", "brain"), ref("page", "brain"), { type: "page", id: "", label: "@x" }],
    });
    expect(parsed.writeTargets).toEqual(["brain"]);
  });

  it("keeps entity refs as context", () => {
    const parsed = parseSubmission({
      text: "what changed in @gmail this week?",
      references: [ref("entity", "gmail")],
    });
    expect(parsed.contextRefs.map((r) => r.id)).toEqual(["gmail"]);
    expect(parsed.writeTargets).toHaveLength(0);
  });
});

describe("searchCatalog", () => {
  it("filters by query and strips the leading @", () => {
    const hits = searchCatalog("@bra");
    expect(hits.some((h) => h.id === "brain")).toBe(true);
  });
  it("returns the full grouped catalog for an empty query (capped)", () => {
    expect(searchCatalog("").length).toBeGreaterThan(0);
    expect(searchCatalog("").length).toBeLessThanOrEqual(8);
  });
});

describe("classifyHeuristically", () => {
  const parsedOf = (prose: string, targets: string[] = []) => ({
    prose,
    writeTargets: targets,
    model: null,
    contextRefs: [],
  });

  it("routes questions to QUERY", () => {
    expect(classifyHeuristically(parsedOf("What did we decide about pricing?")).intent).toBe(
      "QUERY"
    );
  });

  it("routes standing-behaviour prompts to CONFIG", () => {
    const c = classifyHeuristically(
      parsedOf(
        "Configure yourself as an AI agent brain that gathers info from meetings and updates the brain",
        ["brain"]
      )
    );
    expect(c.intent).toBe("CONFIG");
    expect(c.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("'from now on' is CONFIG even with a write verb", () => {
    expect(
      classifyHeuristically(parsedOf("From now on add every meeting summary to the brain", ["brain"]))
        .intent
    ).toBe("CONFIG");
  });

  it("routes direct page writes to WRITE", () => {
    const c = classifyHeuristically(
      parsedOf("Add a note that Q3 pricing is final", ["brain"])
    );
    expect(c.intent).toBe("WRITE");
  });

  it("write verb WITHOUT a page target stays QUERY", () => {
    expect(classifyHeuristically(parsedOf("add up our totals for me")).intent).toBe("QUERY");
  });

  it("asks to clarify when write and question signals collide", () => {
    const c = classifyHeuristically(
      parsedOf("what should I add about pricing?", ["brain"])
    );
    expect(c.clarifyingQuestion).toBeTruthy();
    expect(c.confidence).toBeLessThan(0.6);
  });
});

describe("decomposeConfigPrompt", () => {
  it("decomposes the blueprint's example prompt", () => {
    const d = decomposeConfigPrompt({
      prose:
        "Configure yourself as an AI agent brain that will gather all information from the meetings you attend and TFT forecasts you will do. Afterwards you will update the brain and it will be used as one of the connectors in future",
      writeTargets: ["brain"],
      model: null,
      contextRefs: [],
    });
    expect(d.triggers).toContain("meeting_attended");
    expect(d.triggers).toContain("tft_forecast_completed");
    expect(d.writeTarget).toBe("brain");
    expect(d.persistence).toBe("permanent");
    expect(d.extraFlags.promoteBrainToConnector).toBe(true);
  });

  it("defaults to brain + generic trigger when nothing is recognizable", () => {
    const d = decomposeConfigPrompt({
      prose: "always keep things tidy",
      writeTargets: [],
      model: null,
      contextRefs: [],
    });
    expect(d.writeTarget).toBe("brain");
    expect(d.triggers).toEqual(["document_processed"]);
  });
});

describe("page mutation gates", () => {
  it("validates drafts strictly", () => {
    expect(validateDraft(draftFromWritePrompt("Q3 pricing is final")).ok).toBe(true);
    expect(
      validateDraft({ type: "nope" as never, title: "t", body: "b", confidence: 1, createdBy: "ai" }).ok
    ).toBe(false);
    expect(
      validateDraft({ type: "note", title: " ", body: "b", confidence: 1, createdBy: "ai" }).ok
    ).toBe(false);
    expect(
      validateDraft({ type: "note", title: "t", body: "b", confidence: 2, createdBy: "ai" }).ok
    ).toBe(false);
  });

  it("human writes bypass the review queue; low-confidence AI writes do not", () => {
    expect(gateStatus({ confidence: 0.2, createdBy: "human" })).toBe("active");
    expect(gateStatus({ confidence: CONFIDENCE_AUTO_WRITE, createdBy: "ai" })).toBe("active");
    expect(gateStatus({ confidence: 0.4, createdBy: "ai" })).toBe("queued_for_review");
  });

  it("types direct writes sensibly", () => {
    expect(detectBlockType("we decided to ship on friday")).toBe("decision");
    expect(detectBlockType("summary of the standup meeting")).toBe("meeting_summary");
    expect(detectBlockType("the burnout forecast looks bad")).toBe("forecast");
    expect(detectBlockType("random reminder")).toBe("note");
    // Who works here is knowledge the company learned, not a loose note.
    expect(detectBlockType("the devs are Lynn, Elvis and Kwara")).toBe("learned_fact");
    expect(detectBlockType("who owns the admin page")).toBe("learned_fact");
  });
});

describe("extractive draft (no-LLM fallback)", () => {
  const doc = (over: Partial<ResolvedDocument> = {}): ResolvedDocument =>
    ({
      docId: "d1",
      source: "notion",
      author: "",
      timestamp: "",
      chunks: [],
      bestScore: 0.5,
      text: "Assigned To: LYNN BITOK. Status: Done. Due Date: 2026-06-12.",
      title: "Admin analytic page",
      url: null,
      displayAuthor: "LYNN BITOK",
      ...over,
    }) as ResolvedDocument;

  const docs = [
    doc(),
    doc({
      docId: "d2",
      source: "upload",
      title: "Proposal.pdf",
      displayAuthor: null,
      text: "Milestone 1: collision-free schedules by August.",
    }),
  ];

  const draft = extractiveDraftFromSources("update the brain from notion and files", docs);

  it("records what the sources say, not the instruction that asked for it", () => {
    // The old fallback wrote the user's own words to the Brain, which reads as
    // a successful write while recording no knowledge at all.
    expect(draft.body).not.toContain("update the brain from notion and files");
    expect(draft.body).toContain("LYNN BITOK");
    expect(draft.body).toContain("Milestone 1");
    expect(draft.title).toBe("Source digest — notion, upload (2 documents)");
  });

  it("attributes every document so the block stays auditable", () => {
    expect(draft.body).toContain("| [1] | notion | Admin analytic page | LYNN BITOK |");
    expect(draft.body).toContain("| [2] | upload | Proposal.pdf | Not stated |");
    expect(draft.sourceRefs).toHaveLength(2);
    expect(draft.sourceRefs?.[0]).toMatchObject({ kind: "document", index: 1, docId: "d1" });
  });

  it("files a roster as a learned fact named after the people, not a digest", () => {
    // A Notion task page as our extractor really emits it: properties on their
    // own lines, so ownership is machine-readable.
    const tasks = [
      doc({
        docId: "t1",
        title: "Admin analytic page",
        text: "# Admin analytic page\n## Details\nAssigned To: LYNN BITOK\nStatus: Doing",
      }),
      doc({
        docId: "t2",
        title: "Add module audio functions",
        text: "# Add module audio functions\n## Details\nAssigned To: Elvis Kemoi\nStatus: Doing",
      }),
    ];

    const roster = extractiveDraftFromSources("update the brain from notion", tasks);

    expect(roster.type).toBe("learned_fact");
    expect(roster.title).toBe("Team & ownership — LYNN BITOK, Elvis Kemoi");
    expect(roster.body).toContain("## Who works on what");
    expect(roster.body).toContain("Admin analytic page");
    expect((roster.data as { people?: unknown[] })?.people).toHaveLength(2);
  });

  it("says on the page that nothing was synthesised", () => {
    expect(draft.body).toContain("AI synthesis was unavailable");
    expect(draft.createdBy).toBe("ai");
    // Quoted source material still clears the auto-write gate — the caveat is
    // in the body, not in a review queue nobody looks at.
    expect(gateStatus(draft)).toBe("active");
    expect(validateDraft(draft).ok).toBe(true);
  });
});

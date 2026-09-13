import { describe, expect, it } from "vitest";
import {
  composePageDocument,
  extractTextFromBlock,
  extractTitle,
  hasSubstance,
  renderProperties,
} from "../notionExtract";

/** Stub resolver — asserts we never need a network call for inlined names. */
const noLookup = async (id: string | null | undefined) => {
  throw new Error(`unexpected user lookup for ${id}`);
};
const resolvesTo = (name: string) => async () => name;

describe("extractTitle", () => {
  it("finds the title property whatever it is named", () => {
    expect(
      extractTitle({
        properties: {
          Status: { type: "status", status: { name: "Done" } },
          "Task name": { type: "title", title: [{ plain_text: "Ship the admin page" }] },
        },
      })
    ).toBe("Ship the admin page");
  });

  it("falls back when a page has no title", () => {
    expect(extractTitle({ properties: {} })).toBe("(untitled)");
  });
});

describe("renderProperties", () => {
  // A database row (a "task") usually has NO blocks at all — its owner, status
  // and dates live only here, which is why a block-only reader saw nothing.
  it("renders the fields that answer who-owns-what", async () => {
    const page = {
      properties: {
        "Task name": { type: "title", title: [{ plain_text: "Admin analytics" }] },
        "Assigned To": { type: "people", people: [{ id: "u1", name: "LYNN BITOK" }] },
        Status: { type: "status", status: { name: "Done" } },
        "Due Date": { type: "date", date: { start: "2026-06-12" } },
        "Priority Level": { type: "select", select: { name: "High" } },
        Sprint: { type: "number", number: 10 },
        Checkbox: { type: "checkbox", checkbox: false },
      },
    };

    const out = await renderProperties(page, noLookup);

    expect(out).toContain("Assigned To: LYNN BITOK");
    expect(out).toContain("Status: Done");
    expect(out).toContain("Due Date: 2026-06-12");
    expect(out).toContain("Priority Level: High");
    expect(out).toContain("Sprint: 10");
    expect(out).toContain("Checkbox: No");
    // The title is the document heading, not a detail line.
    expect(out).not.toContain("Admin analytics");
  });

  it("looks a person up only when Notion did not inline their name", async () => {
    const page = { properties: { Owner: { type: "people", people: [{ id: "u9" }] } } };
    expect(await renderProperties(page, resolvesTo("Elvis Kemoi"))).toBe("Owner: Elvis Kemoi");
  });

  it("omits empty properties instead of writing blank lines", async () => {
    const page = {
      properties: {
        Notes: { type: "rich_text", rich_text: [] },
        Status: { type: "status", status: null },
        Owner: { type: "people", people: [] },
      },
    };
    expect(await renderProperties(page, noLookup)).toBe("");
  });

  it("renders date ranges and multi-selects", async () => {
    const page = {
      properties: {
        Window: { type: "date", date: { start: "2026-06-01", end: "2026-06-30" } },
        Tags: { type: "multi_select", multi_select: [{ name: "api" }, { name: "admin" }] },
      },
    };
    const out = await renderProperties(page, noLookup);
    expect(out).toContain("Window: 2026-06-01 → 2026-06-30");
    expect(out).toContain("Tags: api, admin");
  });
});

describe("extractTextFromBlock", () => {
  const block = (type: string, content: Record<string, unknown>) => ({ type, [type]: content });
  const rt = (text: string) => [{ plain_text: text }];

  it("keeps document structure that survives chunking", () => {
    expect(extractTextFromBlock(block("heading_2", { rich_text: rt("Milestones") }))).toBe(
      "## Milestones"
    );
    expect(extractTextFromBlock(block("bulleted_list_item", { rich_text: rt("Ship v1") }))).toBe(
      "- Ship v1"
    );
    expect(
      extractTextFromBlock(block("to_do", { rich_text: rt("Write tests"), checked: true }))
    ).toBe("- [x] Write tests");
    expect(extractTextFromBlock(block("quote", { rich_text: rt("Ship it") }))).toBe("> Ship it");
  });

  it("reads table rows as pipe-delimited cells", () => {
    expect(
      extractTextFromBlock(block("table_row", { cells: [rt("Owner"), rt("Elvis")] }))
    ).toBe("Owner | Elvis");
  });

  it("captures captions and names on media, which is often the only prose", () => {
    expect(
      extractTextFromBlock(block("image", { caption: rt("Sprint 10 burndown"), name: "" }))
    ).toBe("[image] Sprint 10 burndown");
    expect(extractTextFromBlock(block("bookmark", { url: "https://x.dev", caption: [] }))).toBe(
      "https://x.dev"
    );
  });

  it("returns nothing for structural blocks — their children carry the text", () => {
    expect(extractTextFromBlock(block("divider", {}))).toBe("");
    expect(extractTextFromBlock(block("column_list", {}))).toBe("");
    expect(extractTextFromBlock(block("synced_block", {}))).toBe("");
  });

  it("survives a block type it has never seen", () => {
    expect(extractTextFromBlock({ type: "some_future_block", some_future_block: {} })).toBe("");
    expect(extractTextFromBlock({})).toBe("");
  });
});

describe("composePageDocument / hasSubstance", () => {
  it("labels each section so a lone chunk still says what it is", () => {
    const doc = composePageDocument({
      title: "Admin analytics",
      properties: "Assigned To: LYNN BITOK\nStatus: Done",
      body: "Wire the charts to the API.",
      comments: "Miss Kwara (2026-06-10): blocked on the endpoint",
    });

    expect(doc).toContain("# Admin analytics");
    expect(doc).toContain("## Details\nAssigned To: LYNN BITOK");
    expect(doc).toContain("Wire the charts to the API.");
    expect(doc).toContain("## Discussion\nMiss Kwara (2026-06-10)");
  });

  it("omits sections that are empty", () => {
    const doc = composePageDocument({
      title: "Task",
      properties: "Status: Done",
      body: "",
      comments: "",
    });
    expect(doc).not.toContain("## Discussion");
    expect(doc).toBe("# Task\n\n## Details\nStatus: Done");
  });

  it("rejects a page whose only content is its title", () => {
    const title = "Empty page";
    expect(hasSubstance(composePageDocument({ title, properties: "", body: "", comments: "" }), title)).toBe(
      false
    );
    // A single property is enough to be worth embedding.
    expect(
      hasSubstance(
        composePageDocument({ title, properties: "Assigned To: Elvis Kemoi", body: "", comments: "" }),
        title
      )
    ).toBe(true);
  });
});

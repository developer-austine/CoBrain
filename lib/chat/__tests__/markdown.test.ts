import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "../markdown";

describe("parseMarkdown — tables", () => {
  it("parses the roster table instead of leaving raw pipes", () => {
    // This is the exact shape the answer path emits, and the shape that used
    // to reach the user as literal "| Person | Items |" text.
    const md = [
      "| Person | Items | Assigned work |",
      "| --- | --- | --- |",
      "| LYNN BITOK | 4 | Admin analytic page; Living Map |",
      "| Elvis Kemoi | 3 | Add module audio functions |",
    ].join("\n");

    const [block] = parseMarkdown(md);
    expect(block.type).toBe("table");
    if (block.type !== "table") return;

    expect(block.headers).toEqual(["Person", "Items", "Assigned work"]);
    expect(block.rows).toHaveLength(2);
    expect(block.rows[0]).toEqual(["LYNN BITOK", "4", "Admin analytic page; Living Map"]);
  });

  it("does not treat a sentence containing pipes as a table", () => {
    const blocks = parseMarkdown("Run `a | b` to pipe output.");
    expect(blocks[0].type).toBe("paragraph");
  });
});

describe("parseMarkdown — blocks", () => {
  it("parses headings without keeping the hashes", () => {
    const [h] = parseMarkdown("## Who works on what");
    expect(h).toEqual({ type: "heading", level: 2, text: "Who works on what" });
  });

  it("parses bullet and numbered lists", () => {
    const [bullets] = parseMarkdown("- one\n- two\n- three");
    expect(bullets).toEqual({ type: "list", ordered: false, items: ["one", "two", "three"] });

    const [numbers] = parseMarkdown("1. first\n2. second");
    expect(numbers).toEqual({ type: "list", ordered: true, items: ["first", "second"] });
  });

  it("parses a horizontal rule", () => {
    expect(parseMarkdown("---")[0]).toEqual({ type: "rule" });
  });

  it("parses a blockquote", () => {
    expect(parseMarkdown("> quoted line")[0]).toEqual({ type: "quote", text: "quoted line" });
  });

  it("separates paragraphs on blank lines", () => {
    const blocks = parseMarkdown("First para.\n\nSecond para.");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  });
});

describe("parseMarkdown — code fences", () => {
  it("keeps fenced content out of the markdown parser", () => {
    // The `#` and `-` inside the fence must not become a heading and a list.
    const md = "Here:\n\n```python\n# not a heading\n- not a list\n```\n\nAfter.";
    const blocks = parseMarkdown(md);

    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "code", "paragraph"]);
    const code = blocks[1];
    if (code.type !== "code") throw new Error("expected code block");
    expect(code.language).toBe("python");
    expect(code.code).toContain("# not a heading");
  });

  it("captures the path header the code answer emits", () => {
    const md =
      "**`lib/chat/rag.ts:84`** — [open on GitHub](https://github.com/a/b/blob/HEAD/x#L84)\n\n" +
      "```typescript\nconst x = 1;\n```";

    const [block] = parseMarkdown(md);
    if (block.type !== "code") throw new Error("expected code block");

    expect(block.path).toBe("lib/chat/rag.ts");
    expect(block.startLine).toBe(84);
    expect(block.url).toBe("https://github.com/a/b/blob/HEAD/x#L84");
  });
});

describe("parseInline", () => {
  it("parses bold, italic, code, links and mentions", () => {
    const spans = parseInline("**Bold** and *soft* and `code` and [x](https://a.io) and @brain");
    expect(spans.filter((s) => s.type === "bold")[0]).toMatchObject({ text: "Bold" });
    expect(spans.filter((s) => s.type === "italic")[0]).toMatchObject({ text: "soft" });
    expect(spans.filter((s) => s.type === "code")[0]).toMatchObject({ text: "code" });
    expect(spans.filter((s) => s.type === "link")[0]).toMatchObject({
      text: "x",
      href: "https://a.io",
    });
    expect(spans.filter((s) => s.type === "mention")[0]).toMatchObject({ text: "@brain" });
  });

  it("leaves emphasis characters inside inline code alone", () => {
    // `**kwargs` is Python, not bold text.
    const spans = parseInline("Pass `**kwargs` through.");
    expect(spans.filter((s) => s.type === "code")[0]).toMatchObject({ text: "**kwargs" });
    expect(spans.some((s) => s.type === "bold")).toBe(false);
  });

  it("does not treat an email address as a mention", () => {
    const spans = parseInline("Write to austine@example.com today");
    expect(spans.some((s) => s.type === "mention")).toBe(false);
  });
});

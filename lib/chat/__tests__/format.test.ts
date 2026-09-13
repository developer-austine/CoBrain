import { describe, expect, it } from "vitest";
import {
  aggregateCitations,
  cleanForDisplay,
  deriveConversationTitle,
  formatRelativeTime,
  shortUrlLabel,
  truncateWords,
} from "@/lib/chat/format";

describe("cleanForDisplay", () => {
  it("strips full URLs", () => {
    expect(cleanForDisplay("See https://example.com/a?b=c for details")).toBe("See for details");
  });

  it("strips percent-encoded tracking fragments", () => {
    expect(cleanForDisplay("junk _02-pymk%3A+urn%3Ali%3Amember here")).toBe("junk here");
  });

  it("strips query-param chains without a scheme", () => {
    expect(cleanForDisplay("text trk=eml&midToken=AQHOP tail")).toBe("text tail");
  });

  it("strips opaque 40+ char tokens", () => {
    const token = "a".repeat(45);
    expect(cleanForDisplay(`start ${token} end`)).toBe("start end");
  });

  it("collapses whitespace and preserves normal prose", () => {
    expect(cleanForDisplay("  Hello   world.\n\nNew   line ")).toBe("Hello world. New line");
  });

  it("handles empty/nullish input", () => {
    expect(cleanForDisplay("")).toBe("");
    expect(cleanForDisplay(undefined as unknown as string)).toBe("");
  });
});

describe("truncateWords", () => {
  it("returns short text unchanged", () => {
    expect(truncateWords("short", 10)).toBe("short");
  });

  it("cuts on a word boundary with ellipsis", () => {
    const result = truncateWords("the quick brown fox jumps over the lazy dog", 20);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(21);
    expect(result).toBe("the quick brown fox…");
  });

  it("hard-cuts when no usable space exists", () => {
    const result = truncateWords("a".repeat(50), 10);
    expect(result).toBe("a".repeat(10) + "…");
  });
});

describe("deriveConversationTitle", () => {
  it("uses the question as the title", () => {
    expect(deriveConversationTitle("What leads came in today?")).toBe(
      "What leads came in today?"
    );
  });

  it("collapses whitespace and truncates long questions", () => {
    const long = "word ".repeat(40);
    const title = deriveConversationTitle(long);
    expect(title.length).toBeLessThanOrEqual(65);
    expect(title.endsWith("…")).toBe(true);
  });

  it("falls back for empty input", () => {
    expect(deriveConversationTitle("   ")).toBe("New chat");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-05T12:00:00Z");

  it("says 'just now' under a minute", () => {
    expect(formatRelativeTime(new Date("2026-07-05T11:59:30Z"), now)).toBe("just now");
  });

  it("uses minutes under an hour", () => {
    expect(formatRelativeTime(new Date("2026-07-05T11:15:00Z"), now)).toBe("45m");
  });

  it("uses hours under a day", () => {
    expect(formatRelativeTime(new Date("2026-07-05T05:00:00Z"), now)).toBe("7h");
  });

  it("uses days under a week", () => {
    expect(formatRelativeTime(new Date("2026-07-03T12:00:00Z"), now)).toBe("2d");
  });

  it("accepts ISO strings", () => {
    expect(formatRelativeTime("2026-07-05T11:30:00Z", now)).toBe("30m");
  });
});

describe("shortUrlLabel", () => {
  it("drops the scheme and www", () => {
    expect(shortUrlLabel("https://www.linkedin.com/jobs")).toBe("linkedin.com/jobs");
  });

  it("truncates long URLs", () => {
    const label = shortUrlLabel("https://example.com/" + "x".repeat(100));
    expect(label.length).toBeLessThanOrEqual(42);
    expect(label.endsWith("…")).toBe(true);
  });
});

describe("aggregateCitations", () => {
  const c = (source: string, title: string, url: string | null = null) => ({
    source,
    title,
    url,
  });

  it("dedupes identical citations across messages", () => {
    const messages = [
      { citations: [c("gmail", "A"), c("notion", "B")] },
      { citations: [c("gmail", "A"), c("gmail", "C")] },
    ];
    const out = aggregateCitations(messages);
    expect(out).toHaveLength(3);
  });

  it("keeps same-title citations from different sources", () => {
    const out = aggregateCitations([{ citations: [c("gmail", "A"), c("notion", "A")] }]);
    expect(out).toHaveLength(2);
  });

  it("caps the result", () => {
    const many = Array.from({ length: 20 }, (_, i) => c("gmail", `T${i}`));
    const out = aggregateCitations([{ citations: many }], 8);
    expect(out).toHaveLength(8);
  });

  it("handles messages without citations", () => {
    expect(aggregateCitations([{ citations: undefined }, {}] as never[])).toHaveLength(0);
  });
});

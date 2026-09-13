import { describe, it, expect } from "vitest";
import { detectSourceIntent } from "../sourceIntent";

describe("detectSourceIntent", () => {
  it("detects notion and excludes email for a notion question", () => {
    const s = detectSourceIntent(
      "What tasks were assigned in notion and to whom?"
    );
    expect(s).toContain("notion");
    expect(s).not.toContain("gmail");
  });

  it("maps 'pages' to notion", () => {
    expect(detectSourceIntent("summarize my notion pages")).toContain("notion");
    expect(detectSourceIntent("what's on the roadmap page")).toContain("notion");
  });

  it("maps code/github terms to github", () => {
    expect(detectSourceIntent("show me the latest code changes")).toContain("github");
    expect(detectSourceIntent("any open issues in github?")).toContain("github");
    expect(detectSourceIntent("recent commits and PRs")).toContain("github");
  });

  it("only searches email when the user asks for email", () => {
    expect(detectSourceIntent("what did finance email me?")).toEqual(["gmail"]);
    expect(detectSourceIntent("check my inbox for invoices")).toContain("gmail");
  });

  it("maps file/upload terms to upload", () => {
    expect(detectSourceIntent("what's in the pdf I uploaded")).toContain("upload");
    expect(detectSourceIntent("summarize that document")).toContain("upload");
  });

  it("detects multiple sources when several are named", () => {
    const s = detectSourceIntent("compare the notion page with the github issue");
    expect(s).toContain("notion");
    expect(s).toContain("github");
    expect(s).not.toContain("gmail");
  });

  it("returns empty for a source-agnostic question (search everything)", () => {
    expect(detectSourceIntent("what is our refund policy?")).toEqual([]);
    expect(detectSourceIntent("who is responsible for onboarding?")).toEqual([]);
  });

  it("does not match 'mail' inside 'email' as a false positive beyond gmail", () => {
    // 'email' legitimately maps to gmail; just assert it stays a single source.
    expect(detectSourceIntent("email")).toEqual(["gmail"]);
  });

  it("is case-insensitive", () => {
    expect(detectSourceIntent("NOTION tasks")).toContain("notion");
    expect(detectSourceIntent("Slack messages")).toContain("slack");
  });

  it("does not false-positive 'git' inside unrelated words", () => {
    // 'digital' contains 'git' but must not trigger github (word boundaries).
    expect(detectSourceIntent("our digital strategy")).toEqual([]);
  });
});

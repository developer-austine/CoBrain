import { describe, expect, it } from "vitest";
import { isWorthIngesting, tsToDate } from "../slack";
import { isReadableFile } from "../drive";

/**
 * The filters that decide what reaches the brain.
 *
 * These are cheap to get subtly wrong and expensive to notice: over-filter and
 * a channel silently never appears in answers; under-filter and every "has
 * joined the channel" notice becomes a citable source that buries real
 * discussion at retrieval time.
 */

describe("slack: tsToDate", () => {
  it("reads Slack's seconds-with-microseconds stamp", () => {
    // 1723473000 = 2024-08-12T14:30:00Z
    expect(tsToDate("1723473000.001200")?.toISOString()).toBe("2024-08-12T14:30:00.001Z");
  });

  it("handles a whole-second stamp", () => {
    expect(tsToDate("1723473000")?.toISOString()).toBe("2024-08-12T14:30:00.000Z");
  });

  it("returns null rather than an Invalid Date", () => {
    // A null is checkable; `new Date(NaN)` propagates into the row and only
    // fails later, at insert time, far from the cause.
    expect(tsToDate("")).toBeNull();
    expect(tsToDate("not-a-ts")).toBeNull();
  });
});

describe("slack: isWorthIngesting", () => {
  it("keeps an ordinary human message", () => {
    expect(isWorthIngesting({ ts: "1.0", text: "We shipped the migration", user: "U1" })).toBe(true);
  });

  it("drops join/leave and topic-change events", () => {
    // These carry no knowledge and there are thousands of them.
    expect(isWorthIngesting({ ts: "1.0", text: "has joined", subtype: "channel_join" })).toBe(false);
    expect(isWorthIngesting({ ts: "1.0", text: "set the topic", subtype: "channel_topic" })).toBe(false);
  });

  it("drops bot posts", () => {
    // Usually automation echoing something already ingested from its source.
    expect(isWorthIngesting({ ts: "1.0", text: "Build #421 passed", bot_id: "B1" })).toBe(false);
  });

  it("drops empty and single-character messages", () => {
    expect(isWorthIngesting({ ts: "1.0", text: "" })).toBe(false);
    expect(isWorthIngesting({ ts: "1.0", text: "   " })).toBe(false);
    expect(isWorthIngesting({ ts: "1.0", text: "k" })).toBe(false);
    expect(isWorthIngesting({ ts: "1.0" })).toBe(false);
  });

  it("keeps thread replies", () => {
    // The answer usually lives in the reply; dropping these keeps every
    // question and loses every conclusion.
    expect(
      isWorthIngesting({ ts: "2.0", thread_ts: "1.0", text: "Because the index was missing", user: "U2" })
    ).toBe(true);
  });
});

describe("drive: isReadableFile", () => {
  const file = (over: Record<string, unknown> = {}) => ({
    id: "f1",
    name: "Spec.pdf",
    mimeType: "application/pdf",
    ...over,
  });

  it("accepts the binary types the upload parsers already handle", () => {
    expect(isReadableFile(file())).toBe(true);
    expect(
      isReadableFile(
        file({
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        })
      )
    ).toBe(true);
    expect(isReadableFile(file({ mimeType: "text/plain" }))).toBe(true);
  });

  it("accepts Google-native docs, which are exported rather than downloaded", () => {
    expect(isReadableFile(file({ mimeType: "application/vnd.google-apps.document" }))).toBe(true);
    expect(isReadableFile(file({ mimeType: "application/vnd.google-apps.spreadsheet" }))).toBe(true);
    expect(isReadableFile(file({ mimeType: "application/vnd.google-apps.presentation" }))).toBe(true);
  });

  it("rejects folders", () => {
    expect(isReadableFile(file({ mimeType: "application/vnd.google-apps.folder" }))).toBe(false);
  });

  it("rejects types with no text to extract", () => {
    expect(isReadableFile(file({ mimeType: "video/mp4" }))).toBe(false);
    expect(isReadableFile(file({ mimeType: "image/png" }))).toBe(false);
    expect(isReadableFile(file({ mimeType: undefined }))).toBe(false);
  });

  it("rejects trashed files", () => {
    // Drive still lists them; ingesting one resurrects deleted content as a
    // citable source.
    expect(isReadableFile(file({ trashed: true }))).toBe(false);
  });

  it("rejects anything over the size cap", () => {
    expect(isReadableFile(file({ size: String(50 * 1024 * 1024) }))).toBe(false);
    expect(isReadableFile(file({ size: String(1024) }))).toBe(true);
  });

  it("accepts a file with no reported size", () => {
    // Google-native docs report no size at all — treating that as "too big"
    // would silently exclude every Google Doc.
    expect(isReadableFile(file({ mimeType: "application/vnd.google-apps.document", size: undefined }))).toBe(true);
  });
});

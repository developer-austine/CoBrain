import { describe, it, expect } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  kindForFile,
  validateUpload,
  humanFileSize,
} from "../constants";

describe("kindForFile", () => {
  it("resolves kind from extension (case-insensitive)", () => {
    expect(kindForFile("notes.TXT", "")).toBe("text");
    expect(kindForFile("data.csv", "")).toBe("text");
    expect(kindForFile("README.md", "")).toBe("text");
    expect(kindForFile("report.pdf", "")).toBe("pdf");
    expect(kindForFile("spec.docx", "")).toBe("docx");
  });

  it("falls back to MIME type when the extension is unknown", () => {
    expect(kindForFile("blob", "application/pdf")).toBe("pdf");
    expect(kindForFile("blob", "text/plain")).toBe("text");
  });

  it("returns null for unsupported files", () => {
    expect(kindForFile("photo.png", "image/png")).toBeNull();
    expect(kindForFile("archive.zip", "application/zip")).toBeNull();
  });
});

describe("validateUpload", () => {
  it("accepts a valid file and reports its kind", () => {
    const r = validateUpload("q3.pdf", "application/pdf", 1024);
    expect(r).toEqual({ ok: true, kind: "pdf" });
  });

  it("rejects unsupported types", () => {
    const r = validateUpload("clip.mp4", "video/mp4", 1024);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unsupported/i);
  });

  it("rejects empty files", () => {
    const r = validateUpload("empty.txt", "text/plain", 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty/i);
  });

  it("rejects files over the size limit", () => {
    const r = validateUpload("huge.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/exceeds/i);
  });

  it("accepts a file exactly at the limit", () => {
    const r = validateUpload("edge.pdf", "application/pdf", MAX_UPLOAD_BYTES);
    expect(r.ok).toBe(true);
  });
});

describe("humanFileSize", () => {
  it("formats bytes, KB, MB, GB", () => {
    expect(humanFileSize(512)).toBe("512 B");
    expect(humanFileSize(1024)).toBe("1.0 KB");
    expect(humanFileSize(25 * 1024 * 1024)).toBe("25 MB");
    expect(humanFileSize(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });

  it("rounds larger values without decimals", () => {
    expect(humanFileSize(15 * 1024 * 1024)).toBe("15 MB");
  });
});

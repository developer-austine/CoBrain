/**
 * Upload validation rules — pure module, unit-tested in isolation.
 * Uploaded files become searchable knowledge via the same pipeline as
 * connectors (blueprint §9.3), so we only accept types we can extract
 * text from today. OCR for images/scans is a documented future addition.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

/** Extraction strategy per accepted file kind. */
export type FileKind = "text" | "pdf" | "docx";

const EXTENSION_KINDS: Record<string, FileKind> = {
  txt: "text",
  md: "text",
  markdown: "text",
  csv: "text",
  json: "text",
  log: "text",
  pdf: "pdf",
  docx: "docx",
};

const MIME_KINDS: Record<string, FileKind> = {
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "text",
  "application/json": "text",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

/** Human-readable accept list for the file input / dropzone hint. */
export const ACCEPT_ATTRIBUTE = ".txt,.md,.csv,.json,.log,.pdf,.docx";
export const ACCEPTED_SUMMARY = "PDF, DOCX, TXT, MD, CSV, JSON — up to 25 MB";

/**
 * Resolve the extraction kind for a file, trusting the extension first
 * (browsers report unreliable MIME types for md/csv) then the MIME type.
 * Returns null for unsupported files.
 */
export function kindForFile(fileName: string, mimeType: string): FileKind | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_KINDS[ext] ?? MIME_KINDS[mimeType.toLowerCase()] ?? null;
}

/** Validation with a user-facing reason. */
export function validateUpload(
  fileName: string,
  mimeType: string,
  sizeBytes: number
): { ok: true; kind: FileKind } | { ok: false; reason: string } {
  const kind = kindForFile(fileName, mimeType);
  if (!kind) {
    return { ok: false, reason: `Unsupported file type — accepted: ${ACCEPTED_SUMMARY}` };
  }
  if (sizeBytes <= 0) return { ok: false, reason: "File is empty" };
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: `File exceeds ${humanFileSize(MAX_UPLOAD_BYTES)} limit` };
  }
  return { ok: true, kind };
}

/** "1.4 MB" style size label. */
export function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = "B";
  for (const u of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = u;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

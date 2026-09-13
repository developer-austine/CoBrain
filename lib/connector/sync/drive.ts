import "server-only";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/queue/publisher";
import { extractText } from "@/lib/sources/extract";
import type { SyncResult } from "./types";

/**
 * Google Drive sync service.
 *
 * One implementation shared by the "Sync now" button (app/api/drive/sync) and
 * the scheduler (lib/connector/sync/runner), so a manual sync and an automatic
 * one can never diverge.
 *
 * Three things here are deliberate:
 *
 *  - **Google-native docs are exported, binaries are downloaded.** A Google Doc
 *    has no bytes to fetch — `files/get?alt=media` fails on it — so it goes
 *    through `files/export` to text/plain. PDFs and Word files are the reverse.
 *    Getting this wrong yields a run of 403s that looks like a permissions
 *    problem and is not.
 *  - **Text extraction is reused, not reimplemented.** PDFs and .docx are run
 *    through lib/sources/extract, the same parsers that read uploads, so a PDF
 *    means the same thing to the brain whether it arrived by upload or by Drive.
 *  - **`version` is the dedup key, not `modifiedTime`.** Drive bumps
 *    modifiedTime for metadata-only changes such as a move or a rename, and
 *    re-embedding a 60-page unchanged report because someone dragged it into a
 *    folder is pure cost.
 */

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const QUEUE_KEY = "company_brain:ingest";

const RATE_LIMIT_MS = 120;
/** Files walked per run. */
const MAX_FILES = 200;
/** Skip anything bigger than this — a 200MB video has no text worth the fetch. */
const MAX_BYTES = 20 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type DriveConnectionLike = {
  id: string;
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: Date | null;
  email: string | null;
};

type DriveFileMeta = {
  id: string;
  name?: string;
  mimeType?: string;
  version?: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
  owners?: { displayName?: string }[];
  trashed?: boolean;
};

/**
 * Google-native types and the plain-text export each maps to.
 *
 * Slides and Sheets export as text rather than their native binary because the
 * brain wants words, not a spreadsheet it cannot parse.
 */
const GOOGLE_EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};

/** Binary types we can extract text from, via the upload parsers. */
const EXTRACTABLE: Record<string, "pdf" | "docx" | "text"> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "text",
};

/** Is this file worth fetching at all? */
export function isReadableFile(file: DriveFileMeta): boolean {
  if (file.trashed) return false;
  const mime = file.mimeType ?? "";
  if (mime === "application/vnd.google-apps.folder") return false;
  if (!(mime in GOOGLE_EXPORTS) && !(mime in EXTRACTABLE)) return false;
  if (file.size && Number(file.size) > MAX_BYTES) return false;
  return true;
}

/**
 * A Drive access token, refreshed when it is expired or about to be.
 *
 * Drive tokens last an hour and a 3-hour sync cadence guarantees the stored one
 * is stale on nearly every run, so refreshing is the normal path here rather
 * than an error path.
 */
export async function freshAccessToken(connection: DriveConnectionLike): Promise<string> {
  const expiresSoon =
    !connection.tokenExpiry || connection.tokenExpiry.getTime() - Date.now() < 60_000;

  if (!expiresSoon) return connection.accessToken;
  if (!connection.refreshToken) {
    // Nothing to refresh with — the grant must be redone by the user.
    throw new Error("drive: access token expired and no refresh token stored");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !body.access_token) {
    throw new Error(`drive: token refresh failed — ${body.error_description ?? body.error ?? res.status}`);
  }

  await prisma.driveConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: body.access_token,
      tokenExpiry: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
    },
  });

  return body.access_token;
}

async function driveApi<T>(
  token: string,
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = new URL(`${DRIVE_API}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`drive ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/**
 * List candidate files, newest first.
 *
 * `modifiedTime > since` narrows the walk on a repeat run. Trashed files are
 * excluded in the query rather than filtered afterwards, so the page budget is
 * spent on files that still exist.
 */
async function listFiles(token: string, since: Date | null): Promise<DriveFileMeta[]> {
  const out: DriveFileMeta[] = [];
  let pageToken: string | undefined;

  const clauses = ["trashed = false"];
  if (since) clauses.push(`modifiedTime > '${since.toISOString()}'`);

  do {
    const body = await driveApi<{ files: DriveFileMeta[]; nextPageToken?: string }>(
      token,
      "/files",
      {
        q: clauses.join(" and "),
        fields:
          "nextPageToken, files(id, name, mimeType, version, webViewLink, modifiedTime, size, owners(displayName), trashed)",
        pageSize: 100,
        orderBy: "modifiedTime desc",
        pageToken,
      }
    );

    out.push(...(body.files ?? []));
    pageToken = body.nextPageToken;
    if (pageToken) await sleep(RATE_LIMIT_MS);
  } while (pageToken && out.length < MAX_FILES);

  return out.slice(0, MAX_FILES);
}

/** Fetch one file's text, by whichever route its type requires. */
async function fetchText(token: string, file: DriveFileMeta): Promise<string> {
  const mime = file.mimeType ?? "";
  const exportAs = GOOGLE_EXPORTS[mime];

  if (exportAs) {
    const url = new URL(`${DRIVE_API}/files/${file.id}/export`);
    url.searchParams.set("mimeType", exportAs);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`export ${file.id}: ${res.status}`);
    return await res.text();
  }

  const url = new URL(`${DRIVE_API}/files/${file.id}`);
  url.searchParams.set("alt", "media");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`download ${file.id}: ${res.status}`);

  const kind = EXTRACTABLE[mime];
  if (kind === "text") return await res.text();

  const buffer = Buffer.from(await res.arrayBuffer());
  const { text } = await extractText(kind, buffer);
  return text;
}

export async function syncDriveConnection(
  connection: DriveConnectionLike,
  opts: { since?: Date | null } = {}
): Promise<SyncResult> {
  const token = await freshAccessToken(connection);
  const since = opts.since ?? null;

  const files = (await listFiles(token, since)).filter(isReadableFile);
  let synced = 0;
  let skipped = 0;

  // Every version we already hold, read once — so an unchanged file costs a
  // map lookup instead of a download.
  const known = new Map(
    (
      await prisma.driveFile.findMany({
        where: { driveConnectionId: connection.id },
        select: { fileId: true, version: true },
      })
    ).map((row) => [row.fileId, row.version])
  );

  for (const file of files) {
    if (file.version && known.get(file.id) === file.version) continue;

    try {
      const text = (await fetchText(token, file)).trim();
      if (!text) {
        // An empty document is not a failure, but embedding it would add a
        // citable source that says nothing.
        skipped++;
        continue;
      }

      const modifiedTime = file.modifiedTime ? new Date(file.modifiedTime) : null;
      const ownerName = file.owners?.[0]?.displayName ?? null;

      const stored = await prisma.driveFile.upsert({
        where: {
          driveConnectionId_fileId: { driveConnectionId: connection.id, fileId: file.id },
        },
        create: {
          driveConnectionId: connection.id,
          userId: connection.userId,
          fileId: file.id,
          name: file.name ?? null,
          mimeType: file.mimeType ?? null,
          version: file.version ?? null,
          webViewLink: file.webViewLink ?? null,
          ownerName,
          modifiedTime,
          sizeBytes: file.size ? Number(file.size) : null,
          plainText: text,
          snippet: text.slice(0, 200),
        },
        update: {
          name: file.name ?? null,
          version: file.version ?? null,
          modifiedTime,
          plainText: text,
          snippet: text.slice(0, 200),
          status: "PENDING", // changed — must be re-embedded
        },
      });

      await redis.lpush(
        QUEUE_KEY,
        JSON.stringify({
          raw_document_id: stored.id,
          source: "drive",
          external_id: file.id,
          author: ownerName ?? "",
          subject: file.name ?? "Drive file",
          content: text,
          timestamp: modifiedTime?.toISOString() ?? new Date().toISOString(),
          metadata: {
            mime_type: file.mimeType ?? null,
            url: file.webViewLink ?? null,
            size_bytes: file.size ? Number(file.size) : null,
          },
          connector_id: connection.id,
          namespace: `${connection.userId}:drive`, // RBAC boundary
        })
      );

      synced++;
      await sleep(RATE_LIMIT_MS);
    } catch (err) {
      // One unreadable file must not end the run — a shared doc with revoked
      // access is common and expected.
      console.error(`[sync/drive] failed on ${file.id}:`, err);
      skipped++;
    }
  }

  return { source: "drive", itemCount: synced, skipped, incremental: Boolean(since) };
}

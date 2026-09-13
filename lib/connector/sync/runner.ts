import "server-only";
import prisma from "@/lib/prisma";

/**
 * TENANT SCOPE: fleet-wide by design.
 *
 * The scheduler decides which connections across ALL tenants are due, so it
 * cannot run inside a single tenant's scope. It needs a role permitted to read
 * across tenants — a deployment decision, not something this code can grant.
 */
import { shouldSync, SYNC_LOCK_TIMEOUT_MS, type SyncSource } from "./policy";
import { syncGmailConnection } from "./gmail";
import { syncNotionConnection } from "./notion";
import { syncSlackConnection } from "./slack";
import { syncDriveConnection } from "./drive";
import type { ConnectionSyncOutcome, SyncRunSummary } from "./types";

/**
 * The sync runner — "poke + due-check".
 *
 * Something external pokes this often (Celery Beat locally, a platform cron in
 * production); the runner decides what is actually DUE per lib/connector/sync/
 * policy.ts. That keeps the trigger dumb (one schedule) while each source keeps
 * its own cadence — Gmail every 5 minutes, knowledge sources every 3 hours.
 *
 * Guarantees:
 *  - never runs two syncs for the same connection concurrently (DB lock)
 *  - one failing connector never blocks the others (isolated try/catch)
 *  - a crashed run cannot wedge a source forever (locks go stale)
 */

/** Candidate connection, normalised across sources. */
type Candidate = { source: SyncSource; connectionId: string; userId: string };

async function collectCandidates(only?: SyncSource[]): Promise<Candidate[]> {
  const want = (s: SyncSource) => !only || only.includes(s);
  const out: Candidate[] = [];

  if (want("gmail")) {
    const rows = await prisma.gmailConnection.findMany({ select: { id: true, userId: true } });
    out.push(...rows.map((r) => ({ source: "gmail" as const, connectionId: r.id, userId: r.userId })));
  }
  if (want("notion")) {
    const rows = await prisma.notionConnection.findMany({ select: { id: true, userId: true } });
    out.push(...rows.map((r) => ({ source: "notion" as const, connectionId: r.id, userId: r.userId })));
  }
  if (want("slack")) {
    const rows = await prisma.slackConnection.findMany({ select: { id: true, userId: true } });
    out.push(...rows.map((r) => ({ source: "slack" as const, connectionId: r.id, userId: r.userId })));
  }
  if (want("drive")) {
    const rows = await prisma.driveConnection.findMany({ select: { id: true, userId: true } });
    out.push(...rows.map((r) => ({ source: "drive" as const, connectionId: r.id, userId: r.userId })));
  }
  // github: add here as its sync service lands. The policy and state model
  // already understand it.
  return out;
}

/** Dispatch to the right source service. */
async function runSync(c: Candidate, since: Date | null) {
  switch (c.source) {
    case "gmail": {
      const conn = await prisma.gmailConnection.findUnique({ where: { id: c.connectionId } });
      if (!conn) throw new Error("connection disappeared");
      return syncGmailConnection(conn, { since });
    }
    case "notion": {
      const conn = await prisma.notionConnection.findUnique({ where: { id: c.connectionId } });
      if (!conn) throw new Error("connection disappeared");
      // Notion keeps its own delta cursor (NotionSyncCursor), so it ignores `since`.
      return syncNotionConnection(conn);
    }
    case "slack": {
      const conn = await prisma.slackConnection.findUnique({ where: { id: c.connectionId } });
      if (!conn) throw new Error("connection disappeared");
      return syncSlackConnection(conn, { since });
    }
    case "drive": {
      const conn = await prisma.driveConnection.findUnique({ where: { id: c.connectionId } });
      if (!conn) throw new Error("connection disappeared");
      return syncDriveConnection(conn, { since });
    }
    default:
      throw new Error(`No sync service for source "${c.source}"`);
  }
}

/**
 * Acquire the per-connection lock atomically.
 *
 * updateMany with a guard on the CURRENT state is the atomic compare-and-set:
 * only the caller whose UPDATE actually matched a row proceeds, so two
 * concurrent pokes can never both start the same connection.
 */
async function acquireLock(
  source: SyncSource,
  connectionId: string,
  userId: string,
  now: Date,
  staleBefore: Date
): Promise<boolean> {
  // Ensure a row exists so the guarded update below has something to match.
  await prisma.connectorSyncState.upsert({
    where: { source_connectionId: { source, connectionId } },
    create: { source, connectionId, userId },
    update: {},
  });

  const claimed = await prisma.connectorSyncState.updateMany({
    where: {
      source,
      connectionId,
      // Free, or held by a run old enough to be presumed dead.
      OR: [{ syncingSince: null }, { syncingSince: { lt: staleBefore } }],
    },
    data: { syncingSince: now },
  });
  return claimed.count > 0;
}

/**
 * Run every connector whose refresh interval has elapsed.
 * `only` restricts to specific sources (used by manual/targeted triggers).
 */
export async function runDueSyncs(
  opts: { only?: SyncSource[]; now?: Date } = {}
): Promise<SyncRunSummary> {
  const now = opts.now ?? new Date();
  const startedAt = Date.now();
  const outcomes: ConnectionSyncOutcome[] = [];

  const candidates = await collectCandidates(opts.only);

  const states = await prisma.connectorSyncState.findMany({
    where: { connectionId: { in: candidates.map((c) => c.connectionId) } },
  });
  const stateFor = new Map(states.map((s) => [`${s.source}:${s.connectionId}`, s]));

  let ran = 0;

  for (const c of candidates) {
    const state = stateFor.get(`${c.source}:${c.connectionId}`);

    if (!shouldSync(c.source, state, now)) {
      outcomes.push({
        source: c.source,
        connectionId: c.connectionId,
        status: "skipped",
        reason: state?.syncingSince ? "already running" : "not due",
      });
      continue;
    }

    const staleBefore = new Date(now.getTime() - SYNC_LOCK_TIMEOUT_MS);
    const locked = await acquireLock(c.source, c.connectionId, c.userId, now, staleBefore);
    if (!locked) {
      outcomes.push({
        source: c.source,
        connectionId: c.connectionId,
        status: "skipped",
        reason: "lost lock race",
      });
      continue;
    }

    ran++;
    try {
      const result = await runSync(c, state?.lastSyncedAt ?? null);

      await prisma.connectorSyncState.update({
        where: { source_connectionId: { source: c.source, connectionId: c.connectionId } },
        data: {
          // Stamp the time the run STARTED, not finished — anything that landed
          // mid-run is then picked up next time instead of being skipped.
          lastSyncedAt: now,
          syncingSince: null,
          lastStatus: "ok",
          lastError: null,
          lastItemCount: result.itemCount,
          failureCount: 0,
        },
      });

      outcomes.push({
        source: c.source,
        connectionId: c.connectionId,
        status: "ok",
        itemCount: result.itemCount,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[sync/runner] ${c.source}:${c.connectionId} failed:`, message);

      // Release the lock but do NOT advance lastSyncedAt — the source stays due
      // so the next poke retries it.
      await prisma.connectorSyncState
        .update({
          where: { source_connectionId: { source: c.source, connectionId: c.connectionId } },
          data: {
            syncingSince: null,
            lastStatus: "error",
            lastError: message.slice(0, 500),
            failureCount: { increment: 1 },
          },
        })
        .catch(() => {});

      outcomes.push({
        source: c.source,
        connectionId: c.connectionId,
        status: "error",
        reason: message,
      });
    }
  }

  return {
    startedAt: now.toISOString(),
    durationMs: Date.now() - startedAt,
    checked: candidates.length,
    ran,
    outcomes,
  };
}


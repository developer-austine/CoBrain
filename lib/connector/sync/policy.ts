/**
 * Sync scheduling policy — how often each source is refreshed.
 *
 * Email moves fast and is the source people expect to be "live", so it is
 * polled every 5 minutes. Knowledge sources (Notion, Slack, Drive, GitHub)
 * change far less often and are more expensive to walk, so they refresh every
 * 3 hours. Intervals live here alone so the cadence is one edit, not a hunt
 * through the scheduler.
 *
 * The scheduler is a "poke + due-check" design: something external pokes the
 * cron endpoint frequently, and THIS module decides what is actually due. That
 * keeps the trigger dumb (one schedule) and the policy per-source.
 *
 * Pure module — no I/O, unit-tested in isolation.
 */

/** Sources that are polled on a schedule. */
export const SYNC_SOURCES = ["gmail", "notion", "github", "slack", "drive"] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How stale a source may get before we refresh it. */
export const SYNC_INTERVALS_MS: Record<SyncSource, number> = {
  gmail: 5 * MINUTE,
  notion: 3 * HOUR,
  github: 3 * HOUR,
  slack: 3 * HOUR,
  drive: 3 * HOUR,
};

/**
 * A run that started but never recorded a result is presumed dead after this
 * long (crashed process, killed container), and the lock may be taken over.
 * Must exceed the longest realistic sync.
 */
export const SYNC_LOCK_TIMEOUT_MS = 15 * MINUTE;

/** Note: `custom` is webhook-push (POST /api/custom_api/ingest) — never polled. */
export function isSyncSource(value: string): value is SyncSource {
  return (SYNC_SOURCES as readonly string[]).includes(value);
}

/** The slice of sync state the policy needs. */
export type SyncStateLike = {
  lastSyncedAt?: Date | null;
  /** Set when a run starts, cleared when it finishes. */
  syncingSince?: Date | null;
};

/** Has enough time passed since the last successful sync? */
export function isDue(
  source: SyncSource,
  lastSyncedAt: Date | null | undefined,
  now: Date = new Date()
): boolean {
  // Never synced — always due.
  if (!lastSyncedAt) return true;
  return now.getTime() - lastSyncedAt.getTime() >= SYNC_INTERVALS_MS[source];
}

/** Is a run currently in flight (and not old enough to be presumed dead)? */
export function isLocked(
  syncingSince: Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (!syncingSince) return false;
  return now.getTime() - syncingSince.getTime() < SYNC_LOCK_TIMEOUT_MS;
}

/**
 * Should the scheduler start a run for this connection right now?
 * Due AND not already running. A stale lock is ignored so one crashed run
 * can't wedge a source forever.
 */
export function shouldSync(
  source: SyncSource,
  state: SyncStateLike | null | undefined,
  now: Date = new Date()
): boolean {
  if (isLocked(state?.syncingSince, now)) return false;
  return isDue(source, state?.lastSyncedAt, now);
}

/** Milliseconds until this source is next due (0 when due now). */
export function msUntilDue(
  source: SyncSource,
  lastSyncedAt: Date | null | undefined,
  now: Date = new Date()
): number {
  if (!lastSyncedAt) return 0;
  const elapsed = now.getTime() - lastSyncedAt.getTime();
  return Math.max(0, SYNC_INTERVALS_MS[source] - elapsed);
}

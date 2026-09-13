/**
 * The state ladders behind the visualize map (spec §2).
 *
 * Kept free of Prisma and Redis so the rules that decide what a node *looks*
 * like can be tested directly. `telemetry.ts` does the IO and calls in here for
 * every judgement — which means a change to what "live" means happens in one
 * place and is covered by a test rather than by squinting at the map.
 */

export type NodeState = "active" | "live" | "idle" | "error" | "cold";

/** How recent an event has to be for a connector to still count as "live". */
export const LIVE_WINDOW_MS = 60 * 60 * 1000;

/** The trailing window every `recentEvents15m` figure is measured over. */
export const RECENT_WINDOW_MS = 15 * 60 * 1000;

/** Below this much history a forecast is honest about being cold (§4.3). */
export const MIN_WEEKS_REQUIRED = 12;

/**
 * The shared ladder for connector-backed nodes.
 *
 * Order matters: an error outranks activity, because a connector that is both
 * erroring and mid-sync is a broken connector, and a user watching the map
 * needs to see that before they see the movement.
 */
export function connectorState({
  hasConnection,
  syncError,
  syncing,
  recentEvents15m,
  lastActivityAt,
  now = Date.now(),
}: {
  hasConnection: boolean;
  syncError: string | null;
  syncing: boolean;
  recentEvents15m: number;
  lastActivityAt: Date | null;
  now?: number;
}): NodeState {
  if (syncError) return "error";
  if (!hasConnection) return "idle";
  if (syncing || recentEvents15m > 0) return "active";
  if (lastActivityAt && now - lastActivityAt.getTime() < LIVE_WINDOW_MS) return "live";
  return "idle";
}

/**
 * The ladder for brain-derived nodes.
 *
 * These have no connector to break, so the only question is whether the brain
 * wrote one recently. A derived node with rows but no recent writes is "live",
 * not "idle" — the knowledge is there and queryable even when nothing new
 * arrived in the last quarter hour.
 */
export function derivedState(recentEvents15m: number): NodeState {
  return recentEvents15m > 0 ? "active" : "live";
}

/**
 * The forecast node's state.
 *
 * A stale model that keeps drawing confident bands is exactly the failure this
 * node exists to expose, so a drift alarm outranks everything else — including
 * fresh forecast writes, which is precisely when a drifting model looks most
 * healthy from the outside.
 */
export function forecastState({
  driftAlarm,
  cold,
  recentEvents15m,
}: {
  driftAlarm: boolean;
  cold: boolean;
  recentEvents15m: number;
}): NodeState {
  if (driftAlarm) return "error";
  if (cold) return "cold";
  return derivedState(recentEvents15m);
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** The most recent of a set of possibly-missing timestamps. */
export function newest(...dates: (Date | null | undefined)[]): Date | null {
  const valid = dates.filter((d): d is Date => d instanceof Date);
  if (!valid.length) return null;
  return valid.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
}

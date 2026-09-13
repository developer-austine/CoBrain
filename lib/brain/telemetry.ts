import "server-only";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/queue/publisher";
import { FORECAST_TARGETS } from "@/lib/forecast/types";
import {
  connectorState,
  derivedState,
  forecastState,
  formatCount,
  MIN_WEEKS_REQUIRED,
  newest,
  RECENT_WINDOW_MS,
  type NodeState,
} from "@/lib/brain/telemetryRules";

/**
 * Telemetry for the Brain visualize map (spec §2).
 *
 * The map's one law is that every moving thing is bound to a real number, so
 * this module is the whole animation's source of truth: particle rates, pulse
 * modes and node states are all derived from what it returns. Nothing here may
 * invent activity — a value that cannot be computed comes back as zero or null
 * and the UI renders its static state instead.
 *
 * Every query carries an explicit `userId` predicate AND runs inside the
 * caller's `withTenant` scope. The belt-and-braces is deliberate: RLS is
 * enabled and FORCED on these tables, but a superuser connection bypasses it,
 * and `DATABASE_URL` still points at one until the `cobrain_app` cutover. A
 * map that aggregates counts across every table in the database is the worst
 * possible place to depend on a policy that is currently inert.
 */

export type { NodeState };

export type TelemetryNode = {
  id: string;
  state: NodeState;
  count: number;
  countLabel: string;
  /** Drives particle rate (§3). Events in the trailing 15 minutes. */
  recentEvents15m: number;
  lastEventAt: string | null;
  error?: string;
};

export type VisualizeTelemetry = {
  generatedAt: string;
  brain: {
    totalItems: number;
    queueDepth: number;
    processing: boolean;
    lastWriteAt: string | null;
    activeConfigs: number;
  };
  nodes: TelemetryNode[];
};

const QUEUE_KEY = "company_brain:ingest";
const SNAPSHOT_TTL_SECONDS = 10;

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

type SyncRow = {
  source: string;
  lastSyncedAt: Date | null;
  syncingSince: Date | null;
  lastStatus: string | null;
  lastError: string | null;
};

function syncFor(rows: SyncRow[], source: string) {
  const matches = rows.filter((r) => r.source === source);
  if (!matches.length) {
    return { syncing: false, error: null as string | null, lastSyncedAt: null as Date | null };
  }
  return {
    syncing: matches.some((r) => r.syncingSince !== null),
    error: matches.find((r) => r.lastStatus === "error")?.lastError ?? null,
    lastSyncedAt: newest(...matches.map((r) => r.lastSyncedAt)),
  };
}

/**
 * Build the snapshot from the database.
 *
 * Every count is a real query. The queries are issued as one batch rather than
 * sequentially — a serial walk through ~20 aggregates is what turns a 12-second
 * poll into a visible load on the business DB.
 */
async function computeSnapshot(tenantId: string): Promise<VisualizeTelemetry> {
  const now = new Date();
  const since = new Date(now.getTime() - RECENT_WINDOW_MS);

  const [
    githubCount,
    githubRecent,
    githubLast,
    emailCount,
    emailRecent,
    emailLast,
    notionCount,
    notionRecent,
    notionLast,
    sourceFileCount,
    sourceFileRecent,
    sourceFileLast,
    meetingCount,
    meetingRecent,
    factCount,
    factRecent,
    factNewThisWeek,
    decisionCount,
    decisionRecent,
    patternCount,
    patternRecent,
    forecastBlockRecent,
    lastBrainWrite,
    activeConfigs,
    meetingTriggerConfigs,
    syncStates,
    driftAlarm,
    connections,
  ] = await Promise.all([
    prisma.gitHubItem.count({ where: { userId: tenantId } }),
    prisma.gitHubItem.count({ where: { userId: tenantId, syncedAt: { gt: since } } }),
    prisma.gitHubItem.findFirst({
      where: { userId: tenantId },
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    }),

    prisma.email.count({ where: { userId: tenantId } }),
    prisma.email.count({ where: { userId: tenantId, syncedAt: { gt: since } } }),
    prisma.email.findFirst({
      where: { userId: tenantId },
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    }),

    prisma.notionPage.count({ where: { userId: tenantId } }),
    prisma.notionPage.count({ where: { userId: tenantId, syncedAt: { gt: since } } }),
    prisma.notionPage.findFirst({
      where: { userId: tenantId },
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    }),

    prisma.sourceFile.count({ where: { userId: tenantId, status: "PROCESSED" } }),
    prisma.sourceFile.count({
      where: { userId: tenantId, status: "PROCESSED", processedAt: { gt: since } },
    }),
    prisma.sourceFile.findFirst({
      where: { userId: tenantId, status: "PROCESSED" },
      orderBy: { processedAt: "desc" },
      select: { processedAt: true },
    }),

    prisma.brainBlock.count({
      where: { userId: tenantId, type: "meeting_summary", status: "active" },
    }),
    prisma.brainBlock.count({
      where: { userId: tenantId, type: "meeting_summary", createdAt: { gt: since } },
    }),

    prisma.brainBlock.count({
      where: { userId: tenantId, type: "learned_fact", status: "active" },
    }),
    prisma.brainBlock.count({
      where: { userId: tenantId, type: "learned_fact", createdAt: { gt: since } },
    }),
    prisma.brainBlock.count({
      where: {
        userId: tenantId,
        type: "learned_fact",
        status: "active",
        createdAt: { gt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
      },
    }),

    prisma.brainBlock.count({ where: { userId: tenantId, type: "decision", status: "active" } }),
    prisma.brainBlock.count({
      where: { userId: tenantId, type: "decision", createdAt: { gt: since } },
    }),

    prisma.brainBlock.count({ where: { userId: tenantId, type: "pattern", status: "active" } }),
    prisma.brainBlock.count({
      where: { userId: tenantId, type: "pattern", createdAt: { gt: since } },
    }),

    prisma.brainBlock.count({
      where: { userId: tenantId, type: "forecast", createdAt: { gt: since } },
    }),

    prisma.brainBlock.findFirst({
      where: { userId: tenantId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),

    prisma.agentConfig.count({ where: { userId: tenantId, enabled: true } }),
    prisma.agentConfig.findMany({
      where: { userId: tenantId, enabled: true },
      select: { triggers: true },
    }),

    prisma.connectorSyncState.findMany({
      where: { userId: tenantId },
      select: {
        source: true,
        lastSyncedAt: true,
        syncingSince: true,
        lastStatus: true,
        lastError: true,
      },
    }),

    prisma.driftReport.findFirst({
      where: { userId: tenantId, status: "alarm" },
      orderBy: { week: "desc" },
      select: { target: true, week: true, worstPsiFeature: true },
    }),

    Promise.all([
      prisma.gitHubConnection.count({ where: { userId: tenantId } }),
      prisma.gmailConnection.count({ where: { userId: tenantId } }),
      prisma.notionConnection.count({ where: { userId: tenantId } }),
    ]),
  ]);

  const [githubConnections, gmailConnections, notionConnections] = connections;

  const github = syncFor(syncStates, "github");
  const gmail = syncFor(syncStates, "gmail");
  const notion = syncFor(syncStates, "notion");

  const queueDepth = await readQueueDepth();

  const nodes: TelemetryNode[] = [];

  // ── Sources ──────────────────────────────────────────────────────────────
  if (githubConnections > 0 || githubCount > 0) {
    nodes.push({
      id: "engineering",
      state: connectorState({
        hasConnection: githubConnections > 0,
        syncError: github.error,
        syncing: github.syncing,
        recentEvents15m: githubRecent,
        lastActivityAt: newest(github.lastSyncedAt, githubLast?.syncedAt),
      }),
      count: githubCount,
      countLabel: formatCount(githubCount),
      recentEvents15m: githubRecent,
      lastEventAt: iso(newest(github.lastSyncedAt, githubLast?.syncedAt)),
      ...(github.error ? { error: github.error } : {}),
    });
  }

  if (gmailConnections > 0 || emailCount > 0) {
    nodes.push({
      id: "comms",
      state: connectorState({
        hasConnection: gmailConnections > 0,
        syncError: gmail.error,
        syncing: gmail.syncing,
        recentEvents15m: emailRecent,
        lastActivityAt: newest(gmail.lastSyncedAt, emailLast?.syncedAt),
      }),
      count: emailCount,
      countLabel: formatCount(emailCount),
      recentEvents15m: emailRecent,
      lastEventAt: iso(newest(gmail.lastSyncedAt, emailLast?.syncedAt)),
      ...(gmail.error ? { error: gmail.error } : {}),
    });
  }

  const docsCount = notionCount + sourceFileCount;
  const docsRecent = notionRecent + sourceFileRecent;
  if (notionConnections > 0 || docsCount > 0) {
    nodes.push({
      id: "docs",
      state: connectorState({
        // Uploaded files are a source in their own right, so Docs stays alive
        // for a tenant who uploads PDFs without ever connecting Notion.
        hasConnection: notionConnections > 0 || sourceFileCount > 0,
        syncError: notion.error,
        syncing: notion.syncing,
        recentEvents15m: docsRecent,
        lastActivityAt: newest(
          notion.lastSyncedAt,
          notionLast?.syncedAt,
          sourceFileLast?.processedAt
        ),
      }),
      count: docsCount,
      countLabel: formatCount(docsCount),
      recentEvents15m: docsRecent,
      lastEventAt: iso(
        newest(notion.lastSyncedAt, notionLast?.syncedAt, sourceFileLast?.processedAt)
      ),
      ...(notion.error ? { error: notion.error } : {}),
    });
  }

  const hasMeetingRule = meetingTriggerConfigs.some((c: { triggers: string[] }) =>
    c.triggers.some((t: string) => t.toLowerCase().includes("meeting"))
  );
  if (meetingCount > 0 || hasMeetingRule) {
    nodes.push({
      id: "meetings",
      state: meetingRecent > 0 ? "active" : hasMeetingRule ? "live" : "idle",
      count: meetingCount,
      countLabel: `agent · ${formatCount(meetingCount)} attended`,
      recentEvents15m: meetingRecent,
      lastEventAt: null,
    });
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  if (patternCount > 0) {
    nodes.push({
      id: "patterns",
      state: derivedState(patternRecent),
      count: patternCount,
      countLabel: formatCount(patternCount),
      recentEvents15m: patternRecent,
      lastEventAt: null,
    });
  }

  const forecastTargets = await readForecastTargets(tenantId);
  if (forecastTargets.running > 0) {
    nodes.push({
      id: "forecasts",
      state: forecastState({
        driftAlarm: driftAlarm !== null,
        cold: forecastTargets.cold,
        recentEvents15m: forecastBlockRecent,
      }),
      count: forecastTargets.running,
      countLabel: `${forecastTargets.running} running`,
      recentEvents15m: forecastBlockRecent,
      lastEventAt: null,
      ...(driftAlarm
        ? {
            error: `Model drift alarm on ${driftAlarm.target}${
              driftAlarm.worstPsiFeature ? ` (${driftAlarm.worstPsiFeature})` : ""
            }. Forecasts may be stale.`,
          }
        : {}),
    });
  }

  if (factCount > 0) {
    nodes.push({
      id: "facts",
      state: derivedState(factRecent),
      count: factCount,
      countLabel: `${formatCount(factCount)} · ${factNewThisWeek} new`,
      recentEvents15m: factRecent,
      lastEventAt: null,
    });
  }

  if (decisionCount > 0) {
    nodes.push({
      id: "decisions",
      state: derivedState(decisionRecent),
      count: decisionCount,
      countLabel: formatCount(decisionCount),
      recentEvents15m: decisionRecent,
      lastEventAt: null,
    });
  }

  return {
    generatedAt: now.toISOString(),
    brain: {
      totalItems: nodes.reduce((sum, n) => sum + n.count, 0),
      queueDepth,
      processing: queueDepth > 0,
      lastWriteAt: iso(lastBrainWrite?.createdAt),
      activeConfigs,
    },
    nodes,
  };
}

/**
 * Queue depth from Redis.
 *
 * Redis being down must not blank the whole map — the counts and states still
 * come from Postgres and stay true. A missing queue reads as "not processing",
 * which is the honest interpretation of "we cannot see the queue".
 */
async function readQueueDepth(): Promise<number> {
  try {
    return await redis.llen(QUEUE_KEY);
  } catch {
    return 0;
  }
}

/**
 * The tenant's stored forecasts, read from the forecasting service.
 *
 * The forecast store lives with the Python process rather than in Postgres, so
 * this is the one binding that crosses a service boundary. `/api/forecast/
 * targets` is the model catalogue and would report six for a tenant who has
 * never trained, so each target is probed instead: a 404 means "not stored for
 * this tenant" and simply does not count.
 *
 * An unreachable service yields zero, which drops the node entirely under
 * RULE 1-1 — better an absent node than one asserting a forecast count we
 * cannot actually see.
 */
async function readForecastTargets(
  tenantId: string
): Promise<{ running: number; cold: boolean }> {
  const base = process.env.FORECAST_BACKEND_URL || "http://localhost:8100";

  const probes = await Promise.all(
    FORECAST_TARGETS.map(async (target) => {
      try {
        const res = await fetch(`${base}/api/forecast/${target}`, {
          headers: { "X-Tenant-Id": tenantId },
          cache: "no-store",
          signal: AbortSignal.timeout(2_000),
        });
        if (!res.ok) return null;
        const record = (await res.json()) as { observed_weeks?: number };
        return { observedWeeks: record.observed_weeks ?? 0 };
      } catch {
        return null;
      }
    })
  );

  const stored = probes.filter((p): p is { observedWeeks: number } => p !== null);

  return {
    running: stored.length,
    // Thin history is not an error, but it is worth saying out loud: the bands
    // are wide for a reason and the node wears an amber ring to admit it.
    cold:
      stored.length > 0 &&
      stored.every((p) => p.observedWeeks < MIN_WEEKS_REQUIRED),
  };
}

/**
 * The tenant's snapshot, cached for ten seconds.
 *
 * Every open tab polls on its own 12-second timer, so without this a team with
 * the page open on ten screens multiplies the aggregate burst by ten for no
 * extra freshness. The cache key is per tenant; a stale or unreachable Redis
 * degrades to computing the snapshot directly.
 */
export async function getVisualizeTelemetry(tenantId: string): Promise<VisualizeTelemetry> {
  const key = `${tenantId}:viz:snapshot`;

  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as VisualizeTelemetry;
  } catch {
    // Fall through to a live computation.
  }

  const snapshot = await computeSnapshot(tenantId);

  try {
    await redis.set(key, JSON.stringify(snapshot), "EX", SNAPSHOT_TTL_SECONDS);
  } catch {
    // A snapshot that cannot be cached is still a valid snapshot.
  }

  return snapshot;
}

export const TELEMETRY_INTERNALS = { QUEUE_KEY, SNAPSHOT_TTL_SECONDS };

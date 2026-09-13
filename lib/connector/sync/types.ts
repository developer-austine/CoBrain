import type { SyncSource } from "./policy";

/** What a source's sync service reports back to the runner. */
export type SyncResult = {
  source: SyncSource;
  /** Items upserted + enqueued this run. */
  itemCount: number;
  /** Items that errored individually (the run itself still succeeded). */
  skipped?: number;
  /** True when the run only fetched changes since the last cursor. */
  incremental?: boolean;
};

/** Per-connection outcome recorded by the runner. */
export type ConnectionSyncOutcome = {
  source: SyncSource;
  connectionId: string;
  status: "ok" | "error" | "skipped";
  itemCount?: number;
  reason?: string;
};

export type SyncRunSummary = {
  startedAt: string;
  durationMs: number;
  checked: number;
  ran: number;
  outcomes: ConnectionSyncOutcome[];
};

"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
    CheckCircle, Loader2, Circle, ArrowLeft, Clock, Zap, AlertCircle,
} from "lucide-react";

/**
 * Workflow run details.
 *
 * Every number on this page comes from the database. The previous version
 * invented its own phase list — Gmail, GitHub, Drive, Notion, hardcoded — ticked
 * each one "done" on a 1.2s timer, and then redirected to chat. It reported
 * success for connectors the workflow did not contain, claimed completion
 * before the pipeline had read a document, and navigated away from the evidence.
 */

type PhaseStatus = "pending" | "running" | "done" | "failed";

interface Phase {
    number: number;
    name: string;
    taskType: string | null;
    counts: { total: number; done: number; failed: number; pending: number } | null;
    status: PhaseStatus;
}

interface RunData {
    executionId: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    phases: Phase[];
}

/** Fast enough to feel live, slow enough not to hammer the connection pool. */
const POLL_MS = 2000;

export default function RunPage() {
    const params = useParams();
    const router = useRouter();
    const workflowId = params?.workflowId as string;
    // The route segment is [executionId]; the old code read params.runId, which
    // is not a segment here, so the header rendered "Run ID: undefined".
    const executionId = params?.executionId as string;

    const [run, setRun] = useState<RunData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());

    const done = run?.status === "COMPLETED";

    const load = useCallback(async () => {
        try {
            const res = await fetch(
                `/api/workflow/${workflowId}/executions/${executionId}`,
                { cache: "no-store" }
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Could not load this run");
            setRun(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not load this run");
        }
    }, [workflowId, executionId]);

    // One effect owns both the first read and the polling. Polling stops once
    // the run is finished — a completed run cannot change, and a page left open
    // overnight should not keep querying for it.
    useEffect(() => {
        let cancelled = false;
        const tick = () => {
            if (cancelled) return;
            void load();
        };

        // Deferred rather than called inline: load() resolves into setState, and
        // kicking it off in a timeout keeps that out of the effect body.
        const first = setTimeout(tick, 0);
        const id = done ? null : setInterval(tick, POLL_MS);

        return () => {
            cancelled = true;
            clearTimeout(first);
            if (id) clearInterval(id);
        };
    }, [done, load]);

    // Elapsed is DERIVED from a ticking clock rather than stored. Storing it
    // meant writing state from inside the effect on the completed branch, which
    // is a cascading render for a value that was already knowable.
    useEffect(() => {
        if (done) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [done]);

    const elapsed = run?.startedAt
        ? Math.max(
              0,
              Math.floor(
                  ((run.completedAt ? new Date(run.completedAt).getTime() : now) -
                      new Date(run.startedAt).getTime()) /
                      1000
              )
          )
        : 0;

    const formatElapsed = (s: number) => {
        const m = Math.floor(s / 60);
        return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
    };

    const phases = run?.phases ?? [];
    const completedCount = phases.filter((p) => p.status === "done").length;
    const processedDocs = phases.reduce((sum, p) => sum + (p.counts?.done ?? 0), 0);

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col">
            <div className="border-b border-border px-6 py-4 flex items-center gap-4">
                <button
                    onClick={() => router.push(`/connectors/${workflowId}`)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ArrowLeft size={18} />
                </button>
                <div>
                    <h1 className="text-sm font-semibold text-foreground">Workflow run details</h1>
                    <p className="text-xs text-muted-foreground mt-0.5">Run ID: {executionId}</p>
                </div>

                <div className="ml-auto flex items-center gap-1 bg-muted rounded-lg p-1">
                    <button
                        onClick={() => router.push(`/connectors/${workflowId}`)}
                        className="px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md transition-colors"
                    >
                        Editor
                    </button>
                    <button className="px-4 py-1.5 text-xs bg-background text-foreground rounded-md shadow-sm">
                        Runs
                    </button>
                </div>
            </div>

            <div className="flex flex-1">
                <div className="w-72 border-r border-border flex flex-col">
                    <div className="p-5 space-y-4 border-b border-border">
                        <MetaRow
                            icon={<Circle size={14} />}
                            label="Status"
                            value={
                                <span className={`flex items-center gap-1.5 text-xs font-medium ${done ? "text-emerald-500" : "text-amber-500"}`}>
                                    {done ? <CheckCircle size={12} /> : <Loader2 size={12} className="animate-spin" />}
                                    {run?.status ?? "LOADING"}
                                </span>
                            }
                        />
                        <MetaRow
                            icon={<Clock size={14} />}
                            label="Started at"
                            value={
                                <span className="text-xs text-muted-foreground">
                                    {run?.startedAt
                                        ? new Date(run.startedAt).toLocaleTimeString()
                                        : "—"}
                                </span>
                            }
                        />
                        <MetaRow
                            icon={<Clock size={14} />}
                            label="Duration"
                            value={
                                <span className="text-xs text-muted-foreground tabular-nums">
                                    {run?.startedAt ? formatElapsed(elapsed) : "—"}
                                </span>
                            }
                        />
                        <MetaRow
                            icon={<Zap size={14} />}
                            label="Documents processed"
                            value={
                                <span className="text-xs text-muted-foreground tabular-nums">
                                    {processedDocs}
                                </span>
                            }
                        />
                    </div>

                    <div className="p-5 flex-1 overflow-y-auto">
                        <div className="flex items-center gap-2 mb-4">
                            <Zap size={13} className="text-muted-foreground" />
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
                                Phases
                            </span>
                            {phases.length > 0 && (
                                <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                                    {completedCount}/{phases.length}
                                </span>
                            )}
                        </div>

                        <div className="space-y-1">
                            {phases.length === 0 && !error && (
                                <p className="text-xs text-muted-foreground/60">
                                    Loading phases…
                                </p>
                            )}
                            {phases.map((phase) => (
                                <PhaseRow key={phase.number} phase={phase} />
                            ))}
                        </div>
                    </div>
                </div>

                {/* Main area */}
                <div className="flex-1 flex items-center justify-center p-8">
                    {error ? (
                        <div className="text-center space-y-3">
                            <AlertCircle size={26} className="text-destructive mx-auto" />
                            <p className="text-sm text-destructive">{error}</p>
                        </div>
                    ) : done ? (
                        <div className="text-center space-y-4">
                            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto">
                                <CheckCircle size={22} className="text-emerald-500" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-foreground">Run completed</p>
                                <p className="text-xs text-muted-foreground">
                                    {processedDocs} document{processedDocs === 1 ? "" : "s"} are now in
                                    your brain.
                                </p>
                            </div>
                            {/* An explicit link, not an automatic redirect: the run
                                details are the reason the user came here, and
                                navigating away from them is the page throwing out
                                its own result. */}
                            <button
                                onClick={() => router.push("/activity/chat")}
                                className="text-xs font-medium text-emerald-600 underline underline-offset-4 hover:text-emerald-500"
                            >
                                Ask your brain a question →
                            </button>
                        </div>
                    ) : (
                        <div className="text-center space-y-3">
                            <Loader2 size={28} className="animate-spin text-muted-foreground mx-auto" />
                            <p className="text-muted-foreground text-sm">
                                Run is in progress, please wait
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
                {icon}
                <span className="text-xs">{label}</span>
            </div>
            {value}
        </div>
    );
}

function PhaseRow({ phase }: { phase: Phase }) {
    // Sources carry a document count; pipeline stages legitimately do not, and
    // showing "0" against them would read as nothing having happened.
    const detail = phase.counts
        ? `${phase.counts.done}/${phase.counts.total}` +
          (phase.counts.failed > 0 ? ` · ${phase.counts.failed} failed` : "")
        : null;

    return (
        <div className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition-all duration-300 ${
            phase.status === "running" ? "bg-muted border border-border" : ""
        }`}>
            <div className="flex min-w-0 items-center gap-3">
                <span className="text-xs text-muted-foreground w-4 tabular-nums">{phase.number}</span>
                <span className="min-w-0">
                    <span className={`block truncate text-xs transition-colors duration-300 ${
                        phase.status === "done"
                            ? "text-foreground/70"
                            : phase.status === "running"
                            ? "text-foreground"
                            : phase.status === "failed"
                            ? "text-destructive"
                            : "text-muted-foreground/50"
                    }`}>
                        {phase.name}
                    </span>
                    {detail && (
                        <span className="block text-[10px] text-muted-foreground/60 tabular-nums">
                            {detail}
                        </span>
                    )}
                </span>
            </div>

            <div className="ml-2 shrink-0">
                {phase.status === "done" && (
                    <CheckCircle size={15} className="text-emerald-500 animate-in fade-in duration-300" />
                )}
                {phase.status === "running" && (
                    <Loader2 size={15} className="text-amber-500 animate-spin" />
                )}
                {phase.status === "failed" && (
                    <AlertCircle size={15} className="text-destructive" />
                )}
                {phase.status === "pending" && (
                    <Circle size={15} className="text-muted-foreground/30" />
                )}
            </div>
        </div>
    );
}

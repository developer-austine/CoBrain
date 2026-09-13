"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useReactFlow } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppNode } from "@/types/appNode";
import { TaskParam } from "@/types/task";
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  RefreshCw,
  CatIcon,
  Sparkles,
  Search,
} from "lucide-react";
import { useWorkflowId } from "../../WorkflowContext";

interface Props {
  param: TaskParam;
  nodeId: string;
  updateNodeParamValue: (value: string) => void;
}

/**
 * `picking` is its own state, not a sub-mode of `connected`.
 *
 * OAuth grants access to every repo the user can read; it does not say which
 * one this workflow should index. Treating "authorised" as "ready" is what
 * produced the original bug where the connection stored an empty repository and
 * every later sync failed on a blank name.
 */
type Status = "idle" | "picking" | "connected" | "syncing" | "summarising" | "error";

type RepoSummary = {
  id: string;
  fullName: string;
  description: string | null;
  private: boolean;
  language: string | null;
  pushedAt: string | null;
};

export default function GithubConnectButton({
  param,
  nodeId,
  updateNodeParamValue,
}: Props) {
  const { getNode } = useReactFlow();
  const searchParams = useSearchParams();
  const workflowId = useWorkflowId();

  const node = getNode(nodeId) as AppNode | undefined;
  const savedValue: string = node?.data.inputs?.[param.name] ?? "";

  const isAlreadyConnected = savedValue.startsWith("connected:");
  const savedRepo = isAlreadyConnected ? savedValue.replace("connected:", "") : "";

  const [status, setStatus] = useState<Status>(
    isAlreadyConnected && savedRepo ? "connected" : "idle"
  );
  const [repository, setRepository] = useState<string>(savedRepo);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [filter, setFilter] = useState("");
  const [syncMsg, setSyncMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const popupRef = useRef<Window | null>(null);

  /** After OAuth: either the repo is already chosen, or we go and choose one. */
  const afterAuth = useCallback(async () => {
    if (!workflowId) return;
    try {
      const res = await fetch(
        `/api/github/status?workflowId=${workflowId}&nodeId=${nodeId}`
      );
      const data = await res.json();

      if (data.repository) {
        setRepository(data.repository);
        setStatus("connected");
        updateNodeParamValue(`connected:${data.repository}`);
      } else {
        setStatus("picking");
      }
    } catch {
      setStatus("picking");
    }
  }, [workflowId, nodeId, updateNodeParamValue]);

  useEffect(() => {
    const connected = searchParams.get("githubConnected");
    const cbNodeId = searchParams.get("nodeId");
    if (connected === "true" && cbNodeId === nodeId && status === "idle") {
      void afterAuth();
    }
  }, [searchParams, nodeId, status, afterAuth]);

  // Load the repository list the moment we enter the picker.
  useEffect(() => {
    if (status !== "picking" || repos.length > 0 || !workflowId) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/github/repos?workflowId=${workflowId}&nodeId=${nodeId}`
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Could not list repositories");
        setRepos(data.repositories ?? []);
      } catch (err) {
        if (!cancelled) setErrMsg(err instanceof Error ? err.message : "Failed to load repos");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, repos.length, workflowId, nodeId]);

  const handleConnect = useCallback(() => {
    if (!workflowId) return;
    const url = `/api/github/auth?nodeId=${nodeId}&workflowId=${workflowId}`;
    const popup = window.open(url, "githubAuthUrl", "width=520,height=640,left=200,top=100");
    popupRef.current = popup;

    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        void afterAuth();
      }
    }, 800);
  }, [nodeId, workflowId, afterAuth]);

  const handleLink = useCallback(
    async (fullName: string) => {
      if (!workflowId) return;
      setErrMsg("");
      try {
        const res = await fetch("/api/github/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowId, nodeId, repository: fullName }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not link repository");

        setRepository(data.repository);
        setStatus("connected");
        updateNodeParamValue(`connected:${data.repository}`);
        setSyncMsg(
          data.clearedPreviousIndex
            ? "Linked. The previous repository's index was cleared."
            : "Linked. Run a sync to index it."
        );
      } catch (err) {
        setErrMsg(err instanceof Error ? err.message : "Link failed");
      }
    },
    [workflowId, nodeId, updateNodeParamValue]
  );

  const handleSync = useCallback(async () => {
    if (!workflowId) return;
    setStatus("syncing");
    setSyncMsg("");
    setErrMsg("");

    try {
      const res = await fetch("/api/github/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId, nodeId }),
      });
      const data = await res.json();

      if (res.status === 409 && data.needsRepository) {
        setStatus("picking");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Sync failed");

      // Report per-kind so a repo with Discussions disabled reads as a partial
      // success rather than a silent gap.
      const parts = (data.results ?? []).map(
        (r: { kind: string; synced: number }) => `${r.synced} ${r.kind}`
      );
      const failed = (data.failures ?? []).map((f: { kind: string }) => f.kind);
      setSyncMsg(
        parts.join(", ") + (failed.length ? ` — ${failed.join(", ")} failed` : "")
      );
      setStatus("connected");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }, [workflowId, nodeId]);

  const handleSummarise = useCallback(async () => {
    if (!workflowId) return;
    setStatus("summarising");
    setSyncMsg("");
    setErrMsg("");

    try {
      const res = await fetch("/api/github/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId, nodeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Summary failed");

      setSyncMsg(`Wrote "${data.block.title}" to the Brain`);
      setStatus("connected");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "Summary failed");
      setStatus("connected");
    }
  }, [workflowId, nodeId]);

  if (status === "idle" || status === "error") {
    return (
      <div className="flex w-full flex-col gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-full gap-1.5 text-xs"
          onClick={handleConnect}
          disabled={!workflowId}
        >
          <CatIcon size={12} />
          Connect GitHub
        </Button>
        {errMsg && (
          <p className="flex items-center gap-1 text-[10px] text-destructive">
            <AlertCircle size={10} />
            {errMsg}
          </p>
        )}
      </div>
    );
  }

  if (status === "picking") {
    const shown = repos
      .filter((r) => r.fullName.toLowerCase().includes(filter.trim().toLowerCase()))
      .slice(0, 40);

    return (
      <div className="flex w-full flex-col gap-1.5">
        <p className="text-[10px] font-medium text-muted-foreground">
          Choose a repository to index
        </p>

        <div className="relative">
          <Search
            size={11}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter repositories…"
            className="h-7 w-full rounded-md border bg-background pl-6 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {repos.length === 0 && !errMsg ? (
          <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 size={10} className="animate-spin" />
            Loading repositories…
          </p>
        ) : (
          <div className="max-h-44 overflow-y-auto rounded-md border">
            {shown.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => handleLink(r.fullName)}
                className="flex w-full flex-col items-start gap-0.5 border-b px-2 py-1.5 text-left last:border-b-0 hover:bg-accent"
              >
                <span className="flex w-full items-center gap-1">
                  <span className="truncate text-[11px] font-medium">{r.fullName}</span>
                  {r.private && (
                    <Badge variant="secondary" className="h-3.5 shrink-0 px-1 py-0 text-[8px]">
                      private
                    </Badge>
                  )}
                </span>
                {r.description && (
                  <span className="line-clamp-1 text-[9px] text-muted-foreground">
                    {r.description}
                  </span>
                )}
              </button>
            ))}
            {shown.length === 0 && (
              <p className="px-2 py-2 text-[10px] text-muted-foreground">
                No repositories match “{filter}”.
              </p>
            )}
          </div>
        )}

        {errMsg && (
          <p className="flex items-center gap-1 text-[10px] text-destructive">
            <AlertCircle size={10} />
            {errMsg}
          </p>
        )}
      </div>
    );
  }

  if (status === "syncing" || status === "summarising") {
    return (
      <div className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        {status === "syncing"
          ? "Indexing commits, discussions and code…"
          : "Summarising commits…"}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <CheckCircle2 size={12} className="shrink-0 text-green-500" />
        <span className="truncate text-[10px] text-muted-foreground">{repository}</span>
        <button
          type="button"
          onClick={() => {
            setRepos([]);
            setStatus("picking");
          }}
          className="ml-auto shrink-0 text-[9px] text-muted-foreground underline hover:text-foreground"
        >
          change
        </button>
      </div>

      <Button
        size="sm"
        variant="secondary"
        className="h-7 w-full gap-1.5 text-xs"
        onClick={handleSync}
      >
        <RefreshCw size={11} />
        Sync repository
      </Button>

      <Button
        size="sm"
        variant="outline"
        className="h-7 w-full gap-1.5 text-xs"
        onClick={handleSummarise}
      >
        <Sparkles size={11} />
        Summarise commits
      </Button>

      {syncMsg && <p className="text-[10px] text-green-600">{syncMsg}</p>}
      {errMsg && (
        <p className="flex items-center gap-1 text-[10px] text-destructive">
          <AlertCircle size={10} />
          {errMsg}
        </p>
      )}
    </div>
  );
}

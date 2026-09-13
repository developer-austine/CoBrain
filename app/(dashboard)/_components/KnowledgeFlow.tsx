"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRightIcon, FolderOpenIcon, LinkIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { linkWorkflows, unlinkWorkflows, type WorkflowLinkView } from "@/actions/workflows/workflowLinks";
import { resolveUpstreamWorkflows } from "@/lib/workflow/knowledgeScope";

type WorkflowLite = { id: string; name: string };

/**
 * Knowledge flow — how information moves between workflows.
 *
 * Connecting A -> B lets B's chat and Brain search A's ingested knowledge, and
 * it's transitive (A -> B -> C means C reads A too). Uploaded files are a
 * source that every workflow can draw on, so they're shown here as a first-
 * class node rather than hidden away on another page.
 */
export function KnowledgeFlow({
  workflows,
  links,
  uploadCount,
}: {
  workflows: WorkflowLite[];
  links: WorkflowLinkView[];
  uploadCount: number;
}) {
  const [adding, setAdding] = useState(false);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [pending, startTransition] = useTransition();

  const nameOf = useMemo(
    () => new Map(workflows.map((w) => [w.id, w.name])),
    [workflows]
  );

  // For each workflow, everything feeding it (direct + transitive).
  const upstream = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const w of workflows) {
      m.set(w.id, resolveUpstreamWorkflows(w.id, links));
    }
    return m;
  }, [workflows, links]);

  const submit = () => {
    if (!source || !target) {
      toast.error("Pick both a source and a target workflow.");
      return;
    }
    startTransition(async () => {
      const res = await linkWorkflows(source, target);
      if (res.ok) {
        toast.success("Connected — knowledge now flows between them.");
        setAdding(false);
        setSource("");
        setTarget("");
      } else {
        toast.error(res.error);
      }
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const res = await unlinkWorkflows(id);
      if (res.ok) toast.success("Disconnected.");
      else toast.error(res.error);
    });
  };

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <LinkIcon size={15} className="text-emerald-600 dark:text-emerald-400" />
            Knowledge flow
          </h2>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            Connect workflows so one can search another&apos;s knowledge. Flow is
            transitive — if A feeds B and B feeds C, then C can read A too.
          </p>
        </div>
        {workflows.length >= 2 && !adding && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAdding(true)}
            className="gap-1.5"
          >
            <PlusIcon size={14} />
            Connect
          </Button>
        )}
      </div>

      {/* Shared sources — uploads feed every workflow. */}
      <Link
        href="/sources"
        className="mt-4 flex items-center gap-3 rounded-xl border border-border/60 bg-muted/40 px-4 py-3 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/5"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <FolderOpenIcon size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">
            Uploaded files
          </span>
          <span className="block text-xs text-muted-foreground">
            {uploadCount === 0
              ? "No files yet — upload documents to feed every workflow"
              : `${uploadCount} file${uploadCount === 1 ? "" : "s"} · available to all workflows`}
          </span>
        </span>
        <ArrowRightIcon size={15} className="shrink-0 text-muted-foreground" />
      </Link>

      {/* Connect form */}
      {adding && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="h-9 min-w-[9rem] flex-1 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-emerald-500"
          >
            <option value="">Source workflow…</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>

          <ArrowRightIcon size={16} className="shrink-0 text-muted-foreground" />

          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="h-9 min-w-[9rem] flex-1 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-emerald-500"
          >
            <option value="">Target workflow…</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>

          <Button size="sm" onClick={submit} disabled={pending}>
            Connect
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAdding(false)}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Existing links */}
      {links.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {workflows.length < 2
            ? "Create a second workflow to start connecting them."
            : "No connections yet. Each workflow's knowledge is isolated."}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-1.5">
          {links.map((l) => (
            <li
              key={l.id}
              className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm"
            >
              <span className="truncate font-medium text-foreground">
                {nameOf.get(l.sourceWorkflowId) ?? "(deleted)"}
              </span>
              <ArrowRightIcon size={14} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="truncate font-medium text-foreground">
                {nameOf.get(l.targetWorkflowId) ?? "(deleted)"}
              </span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                reads from
              </span>
              <button
                onClick={() => remove(l.id)}
                disabled={pending}
                title="Disconnect"
                aria-label="Disconnect"
                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-600"
              >
                <XIcon size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Effective scope per workflow — makes transitivity visible. */}
      {links.length > 0 && (
        <div className="mt-4 border-t border-border/60 pt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
            Effective knowledge scope
          </p>
          <ul className="flex flex-col gap-1">
            {workflows.map((w) => {
              const up = upstream.get(w.id) ?? [];
              return (
                <li key={w.id} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{w.name}</span>
                  {up.length === 0 ? (
                    <span> — its own knowledge only</span>
                  ) : (
                    <span>
                      {" "}
                      — also reads{" "}
                      {up.map((id) => nameOf.get(id) ?? "(deleted)").join(", ")}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

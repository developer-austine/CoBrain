"use client";

import React, { useMemo, useState } from "react";
import {
  BadgeCheck, Brain, CalendarClock, CheckCheck, FileText, Inbox, LineChart,
  Lightbulb, Pencil, Pin, PinOff, Search, Settings2, Trash2, TrendingUp, X,
} from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/ConfirmDialog";
import { formatRelativeTime } from "@/lib/chat/format";
import {
  approveBrainBlock, confirmBrainBlock, correctBrainBlock, deleteAgentConfig,
  deleteBrainBlock, setAgentConfigEnabled, setBrainBlockPinned,
  type AgentConfigDTO, type BrainBlockDTO,
} from "@/actions/brain/brainBlocks";

/**
 * Three-pane Brain browser: [sections] · [blocks] · [detail + human controls].
 * Every AI-written block is provenanced and reversible — the controls here
 * are the "humans hold final authority" half of the golden rule.
 */

type SectionKey =
  | "all" | "meeting_summary" | "forecast" | "learned_fact" | "pattern"
  | "decision" | "brief" | "note" | "review" | "rules";

const SECTIONS: { key: SectionKey; label: string; icon: React.ElementType }[] = [
  { key: "all", label: "All knowledge", icon: Brain },
  { key: "meeting_summary", label: "Meeting intelligence", icon: CalendarClock },
  { key: "forecast", label: "Forecasts", icon: TrendingUp },
  { key: "learned_fact", label: "Learned facts", icon: Lightbulb },
  { key: "pattern", label: "Patterns & insights", icon: LineChart },
  { key: "decision", label: "Decisions log", icon: CheckCheck },
  { key: "brief", label: "Briefs", icon: FileText },
  { key: "note", label: "Notes", icon: Pencil },
  { key: "review", label: "Review queue", icon: Inbox },
  { key: "rules", label: "Standing rules", icon: Settings2 },
];

const TYPE_LABEL: Record<string, string> = {
  meeting_summary: "Meeting", forecast: "Forecast", learned_fact: "Fact",
  pattern: "Pattern", decision: "Decision", brief: "Brief", note: "Note",
};

export default function BrainClient({
  initialActive,
  initialReviewQueue,
  initialConfigs,
  deepLinkBlockId,
}: {
  initialActive: BrainBlockDTO[];
  initialReviewQueue: BrainBlockDTO[];
  initialConfigs: AgentConfigDTO[];
  deepLinkBlockId: string | null;
}) {
  const [active, setActive] = useState(initialActive);
  const [reviewQueue, setReviewQueue] = useState(initialReviewQueue);
  const [configs, setConfigs] = useState(initialConfigs);
  const [section, setSection] = useState<SectionKey>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(deepLinkBlockId);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pool = section === "review" ? reviewQueue : active;
  const blocks = useMemo(() => {
    let list = pool;
    if (section !== "all" && section !== "review" && section !== "rules") {
      list = list.filter((b) => b.type === section);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (b) => b.title.toLowerCase().includes(q) || b.body.toLowerCase().includes(q)
      );
    }
    return list;
  }, [pool, section, query]);

  const selected =
    active.find((b) => b.id === selectedId) ??
    reviewQueue.find((b) => b.id === selectedId) ??
    null;

  const patchBlock = (id: string, patch: Partial<BrainBlockDTO>) => {
    setActive((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    setReviewQueue((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  // ── Human-in-the-loop controls ─────────────────────────────────────────────
  const doConfirm = async (b: BrainBlockDTO) => {
    if (await confirmBrainBlock(b.id)) {
      patchBlock(b.id, { humanVerified: true, confidence: 1 });
      toast.success("Confirmed — the AI now treats this as verified");
    }
  };

  const doApprove = async (b: BrainBlockDTO) => {
    if (await approveBrainBlock(b.id)) {
      setReviewQueue((prev) => prev.filter((x) => x.id !== b.id));
      setActive((prev) => [{ ...b, status: "active", humanVerified: true }, ...prev]);
      toast.success("Approved — now live on the Brain and citable");
    }
  };

  const doPin = async (b: BrainBlockDTO) => {
    if (await setBrainBlockPinned(b.id, !b.pinned)) {
      patchBlock(b.id, { pinned: !b.pinned });
      toast.success(b.pinned ? "Unpinned" : "Pinned as ground truth");
    }
  };

  const startEdit = (b: BrainBlockDTO) => {
    setEditing(true);
    setEditTitle(b.title);
    setEditBody(b.body);
  };

  const saveEdit = async (b: BrainBlockDTO) => {
    setBusy(true);
    try {
      const next = await correctBrainBlock(b.id, { title: editTitle, body: editBody });
      if (next) {
        setActive((prev) => [next, ...prev.filter((x) => x.id !== b.id)]);
        setReviewQueue((prev) => prev.filter((x) => x.id !== b.id));
        setSelectedId(next.id);
        setEditing(false);
        toast.success("Corrected — previous version kept in history");
      }
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (id: string) => {
    setBusy(true);
    try {
      if (await deleteBrainBlock(id)) {
        setActive((prev) => prev.filter((b) => b.id !== id));
        setReviewQueue((prev) => prev.filter((b) => b.id !== id));
        if (selectedId === id) setSelectedId(null);
        toast.success("Removed from the Brain");
      }
    } finally {
      setBusy(false);
      setConfirmDeleteId(null);
    }
  };

  const toggleRule = async (c: AgentConfigDTO) => {
    if (await setAgentConfigEnabled(c.id, !c.enabled)) {
      setConfigs((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, enabled: !c.enabled } : x))
      );
    }
  };

  const removeRule = async (c: AgentConfigDTO) => {
    if (await deleteAgentConfig(c.id)) {
      setConfigs((prev) => prev.filter((x) => x.id !== c.id));
      toast.success("Standing rule deleted");
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[520px] overflow-hidden rounded-xl border border-stone-100 dark:border-white/[0.06] bg-white dark:bg-[#0c0c0d] text-stone-800 dark:text-white/80">
      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
        title="Remove this from the Brain?"
        description="The block is archived (soft delete) and recoverable from version history."
        confirmLabel="Remove"
        loading={busy}
        onConfirm={() => confirmDeleteId && doDelete(confirmDeleteId)}
      />

      {/* ── Sections rail ─────────────────────────────────────────────────── */}
      <aside className="w-[230px] min-w-[210px] border-r border-stone-100 dark:border-white/[0.06] flex flex-col">
        <div className="px-4 pt-5 pb-3">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-stone-900 dark:text-white">
            <Brain size={18} className="text-[#3a7d2c]" /> Brain
          </h1>
          <p className="text-xs text-stone-400 dark:text-white/30 mt-0.5">
            What your AI has learned & produced
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
          {SECTIONS.map(({ key, label, icon: Icon }) => {
            const count =
              key === "review" ? reviewQueue.length :
              key === "rules" ? configs.length :
              key === "all" ? active.length :
              active.filter((b) => b.type === key).length;
            return (
              <button
                key={key}
                onClick={() => { setSection(key); setEditing(false); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 h-9 text-[13px] font-medium transition-colors ${
                  section === key
                    ? "bg-[#3a7d2c]/10 text-[#3a7d2c]"
                    : "text-stone-600 dark:text-white/55 hover:bg-stone-50 dark:hover:bg-white/[0.04]"
                }`}
              >
                <Icon size={15} className="shrink-0" />
                <span className="flex-1 text-left truncate">{label}</span>
                <span
                  className={`text-[10px] tabular-nums ${
                    key === "review" && count > 0
                      ? "rounded-full bg-amber-400/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 font-bold"
                      : "text-stone-300 dark:text-white/20"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ── Standing rules view ───────────────────────────────────────────── */}
      {section === "rules" ? (
        <section className="flex-1 min-w-0 overflow-y-auto p-6">
          <h2 className="text-sm font-semibold text-stone-900 dark:text-white mb-1">
            Standing rules
          </h2>
          <p className="text-xs text-stone-400 dark:text-white/30 mb-5 max-w-lg">
            Created by CONFIG prompts like “configure yourself as…”. Each rule fires on its
            trigger events and writes to the Brain automatically.
          </p>
          {configs.length === 0 ? (
            <p className="text-xs text-stone-400 dark:text-white/30 border-2 border-dashed border-stone-200 dark:border-white/[0.07] rounded-xl px-6 py-10 text-center max-w-lg">
              No standing rules yet. In chat, try: <br />
              <span className="text-stone-600 dark:text-white/60 font-medium">
                “From now on, summarise every meeting into @brain”
              </span>
            </p>
          ) : (
            <div className="space-y-2 max-w-2xl">
              {configs.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start gap-3 rounded-xl border border-stone-200 dark:border-white/[0.07] px-4 py-3"
                >
                  <button
                    onClick={() => toggleRule(c)}
                    className={`mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${
                      c.enabled ? "bg-[#3a7d2c]" : "bg-stone-200 dark:bg-white/10"
                    }`}
                    title={c.enabled ? "Disable rule" : "Enable rule"}
                  >
                    <span
                      className={`block h-4 w-4 rounded-full bg-white transition-transform ${
                        c.enabled ? "translate-x-4" : ""
                      }`}
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-stone-800 dark:text-white/85 truncate">
                      {c.name}
                    </p>
                    <p className="text-[11px] text-stone-400 dark:text-white/30 mt-0.5">
                      fires on {c.triggers.map((t) => t.replace(/_/g, " ")).join(", ")} → writes to
                      @{c.writeTarget} · created {formatRelativeTime(c.createdAt)}
                    </p>
                  </div>
                  <button
                    onClick={() => removeRule(c)}
                    className="p-1.5 rounded-lg text-stone-300 dark:text-white/20 hover:text-red-500 hover:bg-red-500/10"
                    title="Delete rule"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          {/* ── Block list ──────────────────────────────────────────────────── */}
          <section className="w-[330px] min-w-[280px] border-r border-stone-100 dark:border-white/[0.06] flex flex-col">
            <div className="px-4 pt-5 pb-3">
              <div className="flex items-center gap-2 rounded-lg border border-stone-200 dark:border-white/[0.08] bg-stone-50 dark:bg-white/[0.03] px-3 py-2 focus-within:border-[#3a7d2c]/40">
                <Search size={14} className="shrink-0 text-stone-400 dark:text-white/30" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search the brain…"
                  className="w-full bg-transparent text-xs outline-none placeholder:text-stone-400 dark:placeholder:text-white/25"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-4">
              {blocks.length === 0 ? (
                <p className="px-3 py-10 text-center text-xs text-stone-400 dark:text-white/30">
                  {section === "review"
                    ? "Nothing waiting for review."
                    : "No knowledge here yet — it grows as the AI works and as you write to @brain from chat."}
                </p>
              ) : (
                blocks.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => { setSelectedId(b.id); setEditing(false); }}
                    className={`w-full text-left rounded-xl px-3 py-3 mb-1 transition-colors ${
                      selectedId === b.id
                        ? "bg-[#3a7d2c]/[0.08] dark:bg-[#3a7d2c]/[0.15] border border-[#3a7d2c]/20"
                        : "border border-transparent hover:bg-stone-50 dark:hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        {b.pinned && <Pin size={11} className="shrink-0 text-amber-500" />}
                        <span className="text-[13px] font-semibold text-stone-800 dark:text-white/90 line-clamp-1">
                          {b.title}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-stone-400 dark:text-white/30">
                        {formatRelativeTime(b.updatedAt)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="rounded bg-[#3a7d2c]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#3a7d2c]">
                        {TYPE_LABEL[b.type] ?? b.type}
                      </span>
                      <span className="text-[10px] text-stone-400 dark:text-white/30">
                        {b.createdBy === "ai" ? "AI-derived" : "You"} ·{" "}
                        {Math.round(b.confidence * 100)}%
                      </span>
                      {b.humanVerified && (
                        <BadgeCheck size={12} className="text-[#3a7d2c]" />
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

          {/* ── Detail + controls ──────────────────────────────────────────── */}
          <section className="flex-1 min-w-0 flex flex-col overflow-y-auto">
            {!selected ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
                <div className="w-12 h-12 rounded-2xl bg-[#3a7d2c]/10 flex items-center justify-center">
                  <Brain size={22} className="text-[#3a7d2c]" />
                </div>
                <p className="text-sm font-medium text-stone-600 dark:text-white/60">
                  Select a knowledge block
                </p>
                <p className="text-xs text-stone-400 dark:text-white/30 max-w-xs leading-relaxed">
                  Everything here was derived by your AI — confirm it, correct it, pin it as
                  ground truth, or remove it. You hold final authority.
                </p>
              </div>
            ) : (
              <div className="p-6 max-w-2xl w-full mx-auto">
                {/* Provenance strip */}
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-400 dark:text-white/30 mb-4">
                  <span className="rounded bg-[#3a7d2c]/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#3a7d2c]">
                    {TYPE_LABEL[selected.type] ?? selected.type}
                  </span>
                  <span>{selected.createdBy === "ai" ? "AI-derived" : "Human-written"}</span>
                  <span>· confidence {Math.round(selected.confidence * 100)}%</span>
                  <span>· v{selected.version}</span>
                  <span>· {new Date(selected.createdAt).toLocaleString()}</span>
                  {selected.humanVerified && (
                    <span className="flex items-center gap-1 text-[#3a7d2c] font-medium">
                      <BadgeCheck size={12} /> verified
                    </span>
                  )}
                  {selected.status === "queued_for_review" && (
                    <span className="rounded-full bg-amber-400/20 px-2 py-0.5 font-bold text-amber-600 dark:text-amber-400">
                      awaiting review
                    </span>
                  )}
                </div>

                {editing ? (
                  <div className="space-y-3">
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full rounded-lg border border-stone-200 dark:border-white/10 bg-transparent px-3 py-2 text-lg font-bold outline-none focus:border-[#3a7d2c]/50"
                    />
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={10}
                      className="w-full rounded-lg border border-stone-200 dark:border-white/10 bg-transparent px-3 py-2 text-sm leading-relaxed outline-none focus:border-[#3a7d2c]/50 resize-y"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit(selected)}
                        disabled={busy || !editTitle.trim() || !editBody.trim()}
                        className="rounded-lg bg-[#3a7d2c] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2f6423] disabled:opacity-50"
                      >
                        Save correction
                      </button>
                      <button
                        onClick={() => setEditing(false)}
                        className="rounded-lg border border-stone-200 dark:border-white/10 px-4 py-2 text-xs font-semibold hover:bg-stone-50 dark:hover:bg-white/[0.04]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 className="text-xl font-bold tracking-tight text-stone-900 dark:text-white mb-3">
                      {selected.title}
                    </h2>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700 dark:text-white/70">
                      {selected.body}
                    </p>

                    {/* Controls: confirm · correct · pin · delete (§6.3) */}
                    <div className="mt-8 flex flex-wrap gap-2 border-t border-stone-100 dark:border-white/[0.06] pt-5">
                      {selected.status === "queued_for_review" ? (
                        <button
                          onClick={() => doApprove(selected)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#3a7d2c] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#2f6423]"
                        >
                          <BadgeCheck size={13} /> Approve to Brain
                        </button>
                      ) : (
                        !selected.humanVerified && (
                          <button
                            onClick={() => doConfirm(selected)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#3a7d2c]/10 px-3.5 py-2 text-xs font-semibold text-[#3a7d2c] hover:bg-[#3a7d2c]/20"
                          >
                            <BadgeCheck size={13} /> Confirm
                          </button>
                        )
                      )}
                      <button
                        onClick={() => startEdit(selected)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 dark:border-white/10 px-3.5 py-2 text-xs font-semibold hover:bg-stone-50 dark:hover:bg-white/[0.04]"
                      >
                        <Pencil size={13} /> Correct
                      </button>
                      {selected.status === "active" && (
                        <button
                          onClick={() => doPin(selected)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 dark:border-white/10 px-3.5 py-2 text-xs font-semibold hover:bg-stone-50 dark:hover:bg-white/[0.04]"
                        >
                          {selected.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                          {selected.pinned ? "Unpin" : "Pin as ground truth"}
                        </button>
                      )}
                      <button
                        onClick={() => setConfirmDeleteId(selected.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-500/20 px-3.5 py-2 text-xs font-semibold text-red-600 hover:bg-red-500/10"
                      >
                        <Trash2 size={13} /> Remove
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

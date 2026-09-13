"use client";

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, MessageSquarePlus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { MessageBody } from "@/components/chat/MessageBody";
import { SourceCitations, SOURCE_LABELS } from "@/components/chat/SourceCitations";
import ConfirmDialog from "@/components/ConfirmDialog";
import { getConversation, deleteConversation } from "@/actions/chats/chatHistory";
import { aggregateCitations, formatRelativeTime } from "@/lib/chat/format";
import type { ConversationDetail, ConversationSummary } from "@/lib/chat/types";

/**
 * Three-pane chat history browser:
 *   [conversation list] · [message thread] · [details]
 * List data arrives from the server page; thread details are fetched on
 * selection and cached for the session.
 */
export default function ChatLogsClient({
  initialConversations,
}: {
  initialConversations: ConversationSummary[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailCache] = useState(() => new Map<string, ConversationDetail>());
  const [isLoading, startLoading] = useTransition();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) => c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q)
    );
  }, [conversations, query]);

  const select = (id: string) => {
    setSelectedId(id);
    const cached = detailCache.get(id);
    if (cached) {
      setDetail(cached);
      return;
    }
    setDetail(null);
    startLoading(async () => {
      const d = await getConversation(id);
      if (d) {
        detailCache.set(id, d);
        setDetail(d);
      }
    });
  };

  const remove = async (id: string) => {
    setDeleting(true);
    try {
      const ok = await deleteConversation(id);
      if (!ok) {
        toast.error("Could not delete chat");
        return;
      }
      detailCache.delete(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      toast.success("Chat deleted");
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  const citations = useMemo(
    () => (detail ? aggregateCitations(detail.messages) : []),
    [detail]
  );
  const questionCount = detail?.messages.filter((m) => m.role === "user").length ?? 0;

  return (
    <div className="flex h-full bg-white dark:bg-[#0c0c0d] text-stone-800 dark:text-white/80">
      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
        title="Delete this chat?"
        description="The conversation and all of its messages will be permanently removed."
        confirmLabel="Delete chat"
        loading={deleting}
        onConfirm={() => confirmDeleteId && remove(confirmDeleteId)}
      />
      {/* ── Left: conversation list ─────────────────────────────────────────── */}
      <aside className="w-[320px] min-w-[280px] border-r border-stone-100 dark:border-white/[0.06] flex flex-col">
        <div className="px-4 pt-5 pb-3">
          <div className="flex items-baseline justify-between">
            <h1 className="text-xl font-bold tracking-tight text-stone-900 dark:text-white">
              Chat logs
            </h1>
            <Link
              href="/activity/chat"
              className="text-[#3a7d2c] hover:text-[#2f6423] transition-colors"
              title="New chat"
            >
              <MessageSquarePlus size={18} />
            </Link>
          </div>
          <p className="text-xs text-stone-400 dark:text-white/30 mt-0.5">
            {conversations.length} total {conversations.length === 1 ? "item" : "items"}
          </p>
        </div>

        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 rounded-lg border border-stone-200 dark:border-white/[0.08] bg-stone-50 dark:bg-white/[0.03] px-3 py-2 focus-within:border-[#3a7d2c]/40">
            <Search size={14} className="shrink-0 text-stone-400 dark:text-white/30" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats…"
              className="w-full bg-transparent text-xs outline-none placeholder:text-stone-400 dark:placeholder:text-white/25"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-stone-400 dark:text-white/30">
              {conversations.length === 0
                ? "No chats yet — start one and it will appear here."
                : "No chats match your search."}
            </p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => select(c.id)}
                className={`w-full text-left rounded-xl px-3 py-3 mb-1 transition-colors ${
                  selectedId === c.id
                    ? "bg-[#3a7d2c]/[0.08] dark:bg-[#3a7d2c]/[0.15] border border-[#3a7d2c]/20"
                    : "border border-transparent hover:bg-stone-50 dark:hover:bg-white/[0.04]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-semibold text-stone-800 dark:text-white/90 line-clamp-1">
                    {c.title}
                  </span>
                  <span className="shrink-0 text-[11px] text-stone-400 dark:text-white/30">
                    {formatRelativeTime(c.updatedAt)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-stone-400 dark:text-white/35 line-clamp-1">
                  {c.preview}
                </p>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ── Middle: message thread ──────────────────────────────────────────── */}
      <section className="flex-1 min-w-0 flex flex-col">
        {!selectedId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
            <div className="w-12 h-12 rounded-2xl bg-[#3a7d2c]/10 flex items-center justify-center">
              <img src="/logo.svg" alt="" width={24} height={24} />
            </div>
            <p className="text-sm font-medium text-stone-600 dark:text-white/60">
              Select a chat to review it
            </p>
            <p className="text-xs text-stone-400 dark:text-white/30 max-w-xs">
              Every conversation is saved automatically, with the sources each answer cited.
            </p>
          </div>
        ) : (
          <>
            <header className="flex-shrink-0 flex items-center justify-between gap-3 px-6 h-14 border-b border-stone-100 dark:border-white/[0.06]">
              <h2 className="text-sm font-semibold text-stone-900 dark:text-white truncate">
                {detail?.title ?? "…"}
              </h2>
              <div className="flex items-center gap-2">
                <Link
                  href={`/activity/chat?c=${selectedId}`}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[#3a7d2c] text-white hover:bg-[#2f6423] transition-colors"
                >
                  Continue in chat
                </Link>
                <button
                  onClick={() => setConfirmDeleteId(selectedId)}
                  className="p-1.5 rounded-lg text-stone-400 dark:text-white/30 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                  title="Delete chat"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto">
              {isLoading || !detail ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="animate-spin text-stone-300 dark:text-white/20" size={22} />
                </div>
              ) : (
                <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
                  {detail.messages.map((msg) =>
                    msg.role === "user" ? (
                      <div key={msg.id} className="flex justify-end">
                        <div className="max-w-[80%] bg-[#3a7d2c] text-white text-sm leading-relaxed px-4 py-3 rounded-2xl rounded-br-sm">
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      <div key={msg.id} className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-lg bg-[#3a7d2c]/10 flex items-center justify-center">
                          <img src="/logo.svg" alt="" width={15} height={15} />
                        </div>
                        <div className="flex-1 min-w-0 text-sm text-stone-700 dark:text-white/75 leading-relaxed pt-0.5">
                          <div>
                            <MessageBody text={msg.content} />
                          </div>
                          <SourceCitations citations={msg.citations} />
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── Right: details panel ────────────────────────────────────────────── */}
      <aside className="hidden xl:flex w-[290px] min-w-[260px] border-l border-stone-100 dark:border-white/[0.06] flex-col overflow-y-auto">
        <div className="px-5 pt-5 pb-3">
          <h3 className="text-base font-bold tracking-tight text-stone-900 dark:text-white">
            Details
          </h3>
        </div>

        {!detail ? (
          <p className="px-5 text-xs text-stone-400 dark:text-white/30">
            Chat information appears here.
          </p>
        ) : (
          <div className="px-5 pb-6 space-y-6">
            <section>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 dark:text-white/30 mb-3">
                Chat info
              </h4>
              <dl className="space-y-2.5 text-xs">
                <InfoRow label="Started" value={new Date(detail.createdAt).toLocaleString()} />
                <InfoRow
                  label="Last activity"
                  value={new Date(detail.updatedAt).toLocaleString()}
                />
                <InfoRow label="Messages" value={String(detail.messages.length)} />
                <InfoRow label="Questions" value={String(questionCount)} />
              </dl>
            </section>

            <section>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 dark:text-white/30 mb-3">
                Sources referenced
              </h4>
              {citations.length === 0 ? (
                <p className="text-xs text-stone-400 dark:text-white/30">
                  No sources were cited in this chat.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {citations.map((c, i) => {
                    const label = SOURCE_LABELS[c.source] || c.source;
                    const inner = (
                      <div className="flex items-center gap-2 rounded-lg border border-stone-200 dark:border-white/[0.07] bg-stone-50 dark:bg-white/[0.03] px-2.5 py-2 hover:border-[#3a7d2c]/30 transition-colors">
                        <span className="shrink-0 rounded bg-[#3a7d2c]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#3a7d2c]">
                          {label}
                        </span>
                        <span className="text-xs text-stone-600 dark:text-white/60 truncate">
                          {c.title}
                        </span>
                      </div>
                    );
                    return c.url ? (
                      <a key={i} href={c.url} target="_blank" rel="noopener noreferrer" className="block">
                        {inner}
                      </a>
                    ) : (
                      <div key={i}>{inner}</div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-stone-400 dark:text-white/30 shrink-0">{label}:</dt>
      <dd className="text-right font-medium text-stone-700 dark:text-white/70">{value}</dd>
    </div>
  );
}

"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Send, X } from "lucide-react";
import { toast } from "sonner";
import { suggestedPrompts } from "../chat-data";
import { MessageBody } from "@/components/chat/MessageBody";
import { SourceCitations } from "@/components/chat/SourceCitations";
import { MicButton } from "@/components/chat/MicButton";
import { VoicePill } from "@/components/chat/VoicePill";
import { useSpeechToText } from "@/lib/hooks/useSpeechToText";
import { searchCatalog, type CatalogEntry } from "@/lib/interactive/references";
import { createConversation, appendChatMessage } from "@/actions/chats/chatHistory";
import type { ChatMessageDTO, Citation, ConversationDetail } from "@/lib/chat/types";
import type { PromptReference } from "@/lib/interactive/types";

type UiMessage = Pick<ChatMessageDTO, "id" | "role" | "content" | "citations">;

/** Matches an in-progress "@query" token immediately before the caret. */
const ACTIVE_MENTION_RE = /(?:^|\s)@([\w-]*)$/;

function TypingDots() {
  return (
    <div className="flex items-center gap-[5px] py-1 px-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="block w-[6px] h-[6px] rounded-full bg-stone-400 dark:bg-white/40"
          style={{
            animation: "cobrain-bounce 1.2s ease-in-out infinite",
            animationDelay: `${i * 0.18}s`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Live interactive prompt surface (blueprint: the four subsystems' front-end).
 * Typed or spoken prompts, structured @-mentions, and answers/config/write
 * confirmations streamed from POST /api/prompt. Every exchange persists to
 * chat history.
 */
export default function ChatClient({
  initialConversation,
}: {
  initialConversation: ConversationDetail | null;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<UiMessage[]>(
    () => initialConversation?.messages ?? []
  );
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<"idle" | "thinking" | "streaming">("idle");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [references, setReferences] = useState<PromptReference[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [partialTranscript, setPartialTranscript] = useState("");
  const conversationIdRef = useRef<string | null>(initialConversation?.id ?? null);
  const usedVoiceRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isEmptyState = messages.length === 0;

  const mentionMatches = useMemo(
    () => (mentionQuery !== null ? searchCatalog(mentionQuery) : []),
    [mentionQuery]
  );

  const stt = useSpeechToText({
    onPartial: (text) => setPartialTranscript(text),
    onFinal: (text) => {
      usedVoiceRef.current = true;
      setPartialTranscript("");
      setInput((prev) => (prev ? `${prev.replace(/\s+$/, "")} ${text}` : text));
      autoGrow();
    },
    onError: (message) => {
      setPartialTranscript("");
      toast.error(message);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase]);

  const autoGrow = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "24px";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  };

  // ── @-mention detection at the caret ──────────────────────────────────────
  const refreshMentionState = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const match = before.match(ACTIVE_MENTION_RE);
    setMentionQuery(match ? match[1] : null);
    setMentionIndex(0);
  };

  const selectMention = (entry: CatalogEntry) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? input.length;
    const before = input.slice(0, caret);
    const after = input.slice(caret);
    const replaced = before.replace(ACTIVE_MENTION_RE, (m) =>
      m.startsWith(" ") || m.startsWith("\n") ? `${m[0]}${entry.label} ` : `${entry.label} `
    );
    setInput(replaced + after);
    setMentionQuery(null);
    // Structured token — the reference is data, never re-parsed from text.
    setReferences((prev) =>
      prev.some((r) => r.type === entry.type && r.id === entry.id)
        ? prev
        : [...prev, { type: entry.type, id: entry.id, label: entry.label, pos: replaced.length }]
    );
    requestAnimationFrame(() => {
      el?.focus();
      autoGrow();
    });
  };

  const removeReference = (ref: PromptReference) =>
    setReferences((prev) => prev.filter((r) => !(r.type === ref.type && r.id === ref.id)));

  // ── Submission: POST /api/prompt with the structured contract ─────────────
  const sendMessage = useCallback(
    async (text: string, refs: PromptReference[] = references) => {
      const trimmed = text.trim();
      if (!trimmed || phase !== "idle") return;
      if (stt.state === "listening") stt.stop();

      const userMsg: UiMessage = { id: crypto.randomUUID(), role: "user", content: trimmed };
      const assistantId = crypto.randomUUID();
      const assistantMsg: UiMessage = { id: assistantId, role: "assistant", content: "" };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      setReferences([]);
      setMentionQuery(null);
      setPartialTranscript("");
      if (textareaRef.current) textareaRef.current.style.height = "24px";
      setPhase("thinking");
      setStreamingId(assistantId);

      const patch = (fn: (m: UiMessage) => UiMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

      // Persist the user turn.
      try {
        if (!conversationIdRef.current) {
          const { id } = await createConversation(trimmed);
          conversationIdRef.current = id;
          window.history.replaceState(null, "", `/activity/chat?c=${id}`);
        }
        void appendChatMessage(conversationIdRef.current, "user", trimmed).catch(() => {});
      } catch (err) {
        console.error("[chat] failed to persist conversation:", err);
      }

      let answer = "";
      let citations: Citation[] = [];
      const inputMethod = usedVoiceRef.current ? "voice" : "typed";
      usedVoiceRef.current = false;

      try {
        const res = await fetch("/api/prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: trimmed,
            references: refs,
            inputMethod,
            conversationId: conversationIdRef.current,
          }),
        });
        if (!res.ok || !res.body) throw new Error("Request failed");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let started = false;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() || "";
          for (const frame of frames) {
            const m = frame.match(/^data: ([\s\S]*)$/);
            if (!m) continue;
            let evt: any;
            try {
              evt = JSON.parse(m[1]);
            } catch {
              continue;
            }
            if (evt.type === "token") {
              if (!started) {
                started = true;
                setPhase("streaming");
              }
              answer += evt.text;
              patch((msg) => ({ ...msg, content: msg.content + evt.text }));
            } else if (evt.type === "citations") {
              citations = evt.citations ?? [];
              patch((msg) => ({ ...msg, citations: evt.citations }));
            } else if (evt.type === "config_saved") {
              toast.success("Standing rule saved — see Brain → Standing rules");
            } else if (evt.type === "block_written") {
              toast.success(
                evt.block?.status === "active"
                  ? "Added to your Brain"
                  : "Sent to the Brain review queue"
              );
            } else if (evt.type === "error") {
              patch((msg) => ({
                ...msg,
                content: msg.content || "Sorry — something went wrong answering that.",
              }));
            }
          }
        }
      } catch {
        patch((msg) => ({
          ...msg,
          content:
            msg.content ||
            "Sorry — I couldn't reach the knowledge base. Is the search service running?",
        }));
      } finally {
        if (conversationIdRef.current && answer) {
          void appendChatMessage(conversationIdRef.current, "assistant", answer, citations).catch(
            () => {}
          );
        }
        setPhase("idle");
        setStreamingId(null);
      }
    },
    [phase, references, stt]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectMention(mentionMatches[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleTextarea = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    refreshMentionState(e.target.value, e.target.selectionStart ?? e.target.value.length);
    autoGrow();
  };

  const startNewChat = () => {
    conversationIdRef.current = null;
    setMessages([]);
    setReferences([]);
    router.replace("/activity/chat");
  };

  const canSend = input.trim().length > 0 && phase === "idle";

  return (
    <>
      <style>{`
        @keyframes cobrain-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
        @keyframes cobrain-fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .msg-enter { animation: cobrain-fade-in 0.22s ease forwards; }
        .send-btn-active:active svg {
          transform: translateX(2px) translateY(-2px);
          transition: transform 0.12s ease;
        }
      `}</style>

      <div className="flex flex-col h-full bg-white dark:bg-[#0c0c0d]">
        <div className="flex-shrink-0 flex items-center gap-3 px-6 h-14 border-b border-stone-100 dark:border-white/[0.05] bg-white dark:bg-[#0c0c0d]">
          <div className="flex items-center gap-2 text-[#3a7d2c]">
            <img src="/logo.svg" alt="CoBrain" width={20} height={20} />
            <span className="text-sm font-semibold text-stone-800 dark:text-white tracking-tight">
              CoBrain
            </span>
          </div>
          <span className="text-stone-300 dark:text-white/10 select-none">·</span>
          <span className="text-xs text-stone-400 dark:text-white/30">Chat</span>
          <div className="ml-auto flex items-center gap-3">
            {!isEmptyState && (
              <button
                onClick={startNewChat}
                className="text-xs text-stone-400 dark:text-white/30 hover:text-[#3a7d2c] transition-colors"
              >
                New chat
              </button>
            )}
            <span className="w-1.5 h-1.5 rounded-full bg-[#3a7d2c]" />
            <span className="text-xs text-stone-400 dark:text-white/30">Connected</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isEmptyState ? (
            <div className="flex flex-col items-center justify-center h-full gap-8 px-4 pb-20">
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-[#3a7d2c]/10 flex items-center justify-center text-[#3a7d2c]">
                  <img src="/logo.svg" alt="CoBrain" width={26} height={26} />
                </div>
                <p className="text-xl font-semibold text-stone-800 dark:text-white tracking-tight">
                  Ask CoBrain anything
                </p>
                <p className="text-sm text-stone-400 dark:text-white/35 text-center max-w-xs leading-relaxed">
                  Ask questions, speak with the mic, or type <b>@</b> to reference pages and
                  models — try “add a note to @brain that…”.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 w-full max-w-md">
                {suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt, [])}
                    className="text-left text-xs px-3.5 py-2.5 rounded-xl border border-stone-200 dark:border-white/[0.07] bg-stone-50 dark:bg-white/[0.03] text-stone-600 dark:text-white/50 hover:bg-[#3a7d2c]/5 hover:border-[#3a7d2c]/30 hover:text-[#3a7d2c] dark:hover:text-[#6dba54] transition-all duration-150 leading-snug"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
              {messages.map((msg) => (
                <div key={msg.id} className="msg-enter">
                  {msg.role === "user" ? (
                    <div className="flex justify-end">
                      <div className="max-w-[80%] bg-[#3a7d2c] text-white text-sm leading-relaxed px-4 py-3 rounded-2xl rounded-br-sm">
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-lg bg-[#3a7d2c]/10 flex items-center justify-center text-[#3a7d2c]">
                        <img src="/logo.svg" alt="CoBrain" width={15} height={15} />
                      </div>
                      <div className="flex-1 min-w-0 text-sm text-stone-700 dark:text-white/75 leading-relaxed pt-0.5">
                        <div>
                          <MessageBody text={msg.content} />
                          {streamingId === msg.id && (
                            <span className="ml-0.5 inline-block h-3.5 w-[2px] -mb-0.5 animate-pulse bg-[#3a7d2c]" />
                          )}
                        </div>
                        <SourceCitations citations={msg.citations} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {phase === "thinking" && (
                <div className="msg-enter flex items-start gap-3">
                  <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-[#3a7d2c]/10 flex items-center justify-center text-[#3a7d2c]">
                    <img src="/logo.svg" alt="CoBrain" width={15} height={15} />
                  </div>
                  <div className="pt-0.5">
                    <TypingDots />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* ── Prompt box ──────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 px-4 pb-5 pt-2 bg-white dark:bg-[#0c0c0d]">
          <div className="max-w-2xl mx-auto relative">
            {/* @-mention dropdown */}
            {mentionQuery !== null && mentionMatches.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-2 z-30 overflow-hidden rounded-xl border border-stone-200 dark:border-white/10 bg-white dark:bg-[#161617] shadow-lg">
                {mentionMatches.map((entry, i) => (
                  <button
                    key={`${entry.type}:${entry.id}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectMention(entry);
                    }}
                    onMouseEnter={() => setMentionIndex(i)}
                    className={`flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors ${
                      i === mentionIndex
                        ? "bg-sky-100/70 dark:bg-sky-400/10"
                        : "hover:bg-stone-50 dark:hover:bg-white/[0.04]"
                    }`}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sky-100 dark:bg-sky-400/15 text-sky-600 dark:text-sky-300">
                      <AtSign size={12} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-stone-800 dark:text-white/85">
                        {entry.label}
                        <span className="ml-2 rounded bg-stone-100 dark:bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-stone-400 dark:text-white/35">
                          {entry.type}
                        </span>
                      </span>
                      <span className="block truncate text-[11px] text-stone-400 dark:text-white/35">
                        {entry.description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Active reference chips */}
            {references.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {references.map((ref) => (
                  <span
                    key={`${ref.type}:${ref.id}`}
                    className="inline-flex items-center gap-1 rounded-full bg-sky-100 dark:bg-sky-400/15 border border-sky-300/60 dark:border-sky-400/25 px-2.5 py-1 text-[11px] font-medium text-sky-700 dark:text-sky-300"
                  >
                    {ref.label}
                    <button
                      onClick={() => removeReference(ref)}
                      className="hover:text-sky-900 dark:hover:text-sky-100"
                      aria-label={`Remove ${ref.label}`}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2 bg-stone-50 dark:bg-[#161617] border border-stone-200 dark:border-white/[0.07] rounded-2xl px-4 py-3 focus-within:border-[#3a7d2c]/40 focus-within:ring-2 focus-within:ring-[#3a7d2c]/10 transition-all duration-150">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextarea}
                onKeyDown={handleKeyDown}
                onClick={(e) =>
                  refreshMentionState(input, e.currentTarget.selectionStart ?? input.length)
                }
                placeholder="Ask, speak, or type @ to reference…"
                rows={1}
                disabled={phase !== "idle"}
                className="flex-1 bg-transparent text-sm text-stone-800 dark:text-white placeholder:text-stone-400 dark:placeholder:text-white/25 resize-none outline-none leading-relaxed disabled:opacity-50"
                style={{ minHeight: "24px", maxHeight: "160px" }}
              />

              <MicButton state={stt.state} onStart={stt.start} onStop={stt.stop} />

              <button
                onClick={() => sendMessage(input)}
                disabled={!canSend}
                className="send-btn-active flex-shrink-0 w-8 h-8 rounded-full bg-stone-900 dark:bg-white disabled:bg-stone-200 dark:disabled:bg-white/10 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center group"
              >
                <Send
                  size={14}
                  className="text-white dark:text-stone-900 group-disabled:text-stone-400 dark:group-disabled:text-white/30 transition-transform duration-150"
                />
              </button>
            </div>

            {/* Listening pill — waveform + live transcript, typed out as heard. */}
            <VoicePill
              state={stt.state}
              partial={partialTranscript}
              onStop={stt.stop}
              levelRef={stt.levelRef}
            />

            <p className="text-center text-[11px] text-stone-300 dark:text-white/20 mt-2 select-none">
              Enter to send · Shift+Enter for new line · @ to reference · 🎙 to speak
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

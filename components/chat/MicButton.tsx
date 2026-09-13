"use client";

import { Loader2, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SttState } from "@/lib/hooks/useSpeechToText";

/**
 * Mic control for the prompt box.
 *
 * The "I'm listening" affordance (the dark pill of white dots forming a wave,
 * plus the live transcript) lives in <VoicePill /> below the prompt box — this
 * button only starts/stops, and shows that the mic is hot.
 */
export function MicButton({
  state,
  onStart,
  onStop,
}: {
  state: SttState;
  onStart: () => void;
  onStop: () => void;
}) {
  const listening = state === "listening";

  return (
    <button
      type="button"
      onClick={listening ? onStop : onStart}
      disabled={state === "connecting"}
      title={listening ? "Stop listening" : "Speak your prompt"}
      aria-label={listening ? "Stop listening" : "Speak your prompt"}
      aria-pressed={listening}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-60",
        listening
          ? "bg-stone-900 text-white dark:bg-white dark:text-stone-900 ring-2 ring-[#3a7d2c]/40"
          : "text-stone-400 dark:text-white/40 hover:text-[#3a7d2c] hover:bg-[#3a7d2c]/10"
      )}
    >
      {state === "connecting" ? (
        <Loader2 size={16} className="animate-spin" />
      ) : (
        <Mic size={16} />
      )}
    </button>
  );
}

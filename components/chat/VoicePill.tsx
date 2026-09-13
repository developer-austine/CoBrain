"use client";

import { useRef, type RefObject } from "react";
import { Square } from "lucide-react";
import { useTypewriter } from "@/lib/hooks/useTypewriter";
import { useWaveform } from "@/lib/hooks/useWaveform";
import type { SttState } from "@/lib/hooks/useSpeechToText";

/** Number of bars in the listening waveform. */
const BARS = [0, 1, 2, 3, 4, 5, 6];

/**
 * The listening pill — a dark capsule that appears BELOW the prompt box while
 * the mic is open.
 *
 * Left:   white bars forming a wave that reacts to your actual voice loudness —
 *         the "I'm hearing you" affordance. Falls back to a gentle CSS breathe
 *         while the socket is still connecting (no audio yet).
 * Middle: the live transcript, typed out as the words are recognised.
 * Right:  a stop control.
 *
 * Voice is only an input method: what lands here is appended to the prompt box
 * as normal text and submitted through the identical flow as typing.
 */
export function VoicePill({
  state,
  partial,
  onStop,
  levelRef,
}: {
  state: SttState;
  partial: string;
  onStop: () => void;
  /** Live 0–1 mic loudness from useSpeechToText; drives the waveform. */
  levelRef?: RefObject<number>;
}) {
  const typed = useTypewriter(partial);

  const connecting = state === "connecting";
  const listening = state === "listening";

  // Amplitude-reactive bars while listening (rAF, no re-renders). The hook is
  // always called (rules of hooks); it only animates when active + a level ref
  // is provided.
  const fallbackLevel = useRef(0);
  const setBar = useWaveform(levelRef ?? fallbackLevel, listening && !!levelRef, BARS.length);

  if (!connecting && !listening) return null;

  const reactive = listening && !!levelRef;

  return (
    <div className="mt-2.5 flex justify-center" aria-live="polite">
      <div className="flex max-w-full items-center gap-3 rounded-full bg-stone-900 dark:bg-black px-4 py-2 shadow-lg ring-1 ring-white/10 animate-in fade-in slide-in-from-bottom-1 duration-200">
        {/* Waveform */}
        <span className="flex h-4 shrink-0 items-center gap-[3px]" aria-hidden>
          {BARS.map((i) => (
            <span
              key={i}
              ref={reactive ? setBar(i) : undefined}
              className="block w-[3px] rounded-full bg-white"
              style={{
                height: "5px",
                transformOrigin: "bottom",
                willChange: reactive ? "transform" : undefined,
                // Reactive bars are driven by rAF (transform); connecting bars
                // (or a browser with no audio level) use the CSS breathe.
                animation: reactive
                  ? undefined
                  : listening
                    ? "cobrain-listen 1.1s ease-in-out infinite"
                    : "cobrain-pulse 1.4s ease-in-out infinite",
                animationDelay: reactive ? undefined : `${i * 0.1}s`,
              }}
            />
          ))}
        </span>

        {/* Live transcript, typed out */}
        <span className="min-w-0 max-w-[46ch] truncate text-sm text-white/90">
          {connecting ? (
            <span className="text-white/50">Connecting…</span>
          ) : typed ? (
            <>
              {typed}
              <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-white/70" />
            </>
          ) : (
            <span className="text-white/50">Listening…</span>
          )}
        </span>

        <button
          type="button"
          onClick={onStop}
          title="Stop listening"
          aria-label="Stop listening"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white active:scale-95"
        >
          <Square size={9} className="fill-current" />
        </button>
      </div>
    </div>
  );
}

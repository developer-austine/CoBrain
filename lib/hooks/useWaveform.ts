"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Drive a row of waveform bars from a live audio-level ref.
 *
 * The level updates ~4×/sec off the audio thread; a requestAnimationFrame loop
 * samples it at 60fps and writes each bar's height directly to the DOM (never
 * through React state — that would re-render the whole tree every frame). Each
 * bar carries a phase offset so the row reads as a travelling wave that swells
 * with your voice and settles to a gentle idle breathe in silence.
 *
 * Usage:
 *   const setBar = useWaveform(levelRef, listening, BARS.length);
 *   {BARS.map((_, i) => <span ref={setBar(i)} />)}
 */
export function useWaveform(
  levelRef: RefObject<number>,
  active: boolean,
  barCount: number
) {
  const barsRef = useRef<(HTMLElement | null)[]>([]);

  const setBar = useCallback(
    (i: number) => (el: HTMLElement | null) => {
      barsRef.current[i] = el;
    },
    []
  );

  useEffect(() => {
    if (!active) return;

    let raf = 0;
    const startedAt = performance.now();

    const tick = (now: number) => {
      const t = (now - startedAt) / 1000;
      const level = levelRef.current ?? 0;
      const bars = barsRef.current;

      for (let i = 0; i < bars.length; i++) {
        const el = bars[i];
        if (!el) continue;

        const phase = i * 0.7;
        // Travelling wave (0..1) + a slow idle breathe for silence.
        const wave = 0.5 + 0.5 * Math.sin(t * 7 + phase);
        const idle = 0.22 + 0.12 * Math.sin(t * 2 + phase);
        const amp = Math.max(idle, level * (0.5 + 0.9 * wave));

        // scaleY against a 5px base bar → ~1.5px..15px tall.
        el.style.transform = `scaleY(${(0.3 + amp * 2.9).toFixed(3)})`;
        el.style.opacity = (0.5 + Math.min(0.5, amp)).toFixed(2);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, levelRef, barCount]);

  return setBar;
}

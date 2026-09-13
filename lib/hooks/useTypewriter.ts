"use client";

import { useEffect, useState } from "react";

/**
 * Reveal `target` character-by-character, tracking a target that keeps growing.
 *
 * Speech partials stream in as an ever-lengthening string ("who", "who was",
 * "who was given..."), so a naive typewriter would restart on every update.
 * Instead we only ever catch up to the target: if the new target still starts
 * with what we've shown, we keep typing from there; if the recogniser revised
 * the utterance (the prefix changed), we reset and retype.
 */
export function useTypewriter(
  target: string,
  { charsPerTick = 2, tickMs = 18 }: { charsPerTick?: number; tickMs?: number } = {}
): string {
  const [shown, setShown] = useState("");
  const [lastTarget, setLastTarget] = useState(target);

  // Adjust state during render rather than in an effect — React's recommended
  // pattern for "reset some state when a prop changes". Doing this in an effect
  // would setState synchronously on every partial and cascade re-renders.
  let current = shown;
  if (target !== lastTarget) {
    setLastTarget(target);
    // Keep the revealed prefix when the target merely grew; reset on a revision.
    if (!target || !target.startsWith(shown)) {
      current = "";
      setShown("");
    }
  }

  // Catch up to the target, a few characters per tick.
  useEffect(() => {
    if (shown.length >= target.length) return;
    const id = setTimeout(() => {
      setShown(target.slice(0, Math.min(target.length, shown.length + charsPerTick)));
    }, tickMs);
    return () => clearTimeout(id);
  }, [shown, target, charsPerTick, tickMs]);

  return current;
}

"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/forecast/useChartPalette";

/**
 * The headline number, counted from its previous value (spec §3.5).
 *
 * The point is not decoration: animating from the old value to the new one
 * shows the reader that the number *changed* and by roughly how much, which a
 * silent swap hides. Digits are tabular so the surrounding layout does not
 * twitch on every frame.
 */
export function SigmaTicker({
  value,
  flat,
  className = "",
  style,
}: {
  value: number;
  /** Rendered as "flat" rather than a near-zero number. */
  flat: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(value);
  const previous = useRef(value);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    const from = previous.current;
    const to = value;
    previous.current = value;

    if (reduced || from === to) {
      setShown(to);
      return;
    }

    const DURATION = 600;
    const started = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - started) / DURATION);
      // ease-out cubic: fast enough to feel responsive, settled by the end.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (to - from) * eased);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [value, reduced]);

  if (flat) {
    return <span className={`tnum ${className}`} style={style}>flat</span>;
  }

  return (
    <span className={`tnum ${className}`} style={style}>
      {shown > 0 ? "+" : ""}
      {shown.toFixed(2)}σ
    </span>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VisualizeTelemetry } from "@/lib/brain/telemetry";

/**
 * Telemetry polling for the visualize map (spec §2, §7.3).
 *
 * Twelve seconds, and it stops when nobody is looking: a hidden tab or a
 * scrolled-away card holds an open dashboard at zero cost rather than hammering
 * the aggregate every twelve seconds all afternoon. Coming back into view
 * refetches immediately, so the map is never showing a stale snapshot from an
 * hour ago the moment a user returns to it.
 */

const POLL_MS = 12_000;

export type TelemetryStatus = "loading" | "ready" | "error";

export function useTelemetry(active: boolean) {
  const [data, setData] = useState<VisualizeTelemetry | null>(null);
  const [status, setStatus] = useState<TelemetryStatus>("loading");

  // Held in a ref so the poll effect does not re-subscribe on every snapshot.
  const inFlight = useRef<AbortController | null>(null);
  const hasData = useRef(false);

  const fetchOnce = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    try {
      const res = await fetch("/api/brain/visualize", {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as VisualizeTelemetry;
      setData(json);
      hasData.current = true;
      setStatus("ready");
    } catch {
      if (controller.signal.aborted) return;
      // A failed poll must not blank a map that is already drawn — the last
      // good snapshot stays on screen and the status chrome reports the fault.
      setStatus(hasData.current ? "ready" : "error");
    }
  }, []);

  useEffect(() => {
    if (!active) return;

    let timer: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      if (timer !== undefined) return;
      void fetchOnce();
      timer = setInterval(() => void fetchOnce(), POLL_MS);
    };

    const stop = () => {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    };

    const onVisibility = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      inFlight.current?.abort();
    };
  }, [active, fetchOnce]);

  return { data, status, refresh: fetchOnce };
}

/**
 * True while the element is on screen (§7.2).
 *
 * Off-screen animation is pure battery drain, and a dashboard left open on a
 * second monitor is exactly where this map would otherwise burn CPU forever.
 */
export function useOnScreen<T extends Element>(ref: React.RefObject<T | null>): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.05 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return visible;
}

/**
 * Ease a count from its previous real value to its new one (§2 polling note).
 *
 * The interpolation only ever traverses ground between two measured snapshots
 * — it never runs ahead of the data. That keeps the "no fabricated activity"
 * law intact while still letting the eye register that a number moved.
 */
export function useInterpolatedCount(target: number, animate: boolean): number {
  const [shown, setShown] = useState(target);
  const previous = useRef(target);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    const from = previous.current;
    previous.current = target;

    if (!animate || from === target) {
      setShown(target);
      return;
    }

    const DURATION = 700;
    const started = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - started) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (t < 1) frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [target, animate]);

  return shown;
}

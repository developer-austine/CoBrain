"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plug, TriangleAlert } from "lucide-react";
import { usePrefersReducedMotion } from "@/lib/forecast/useChartPalette";
import { BrainMap } from "./BrainMap";
import { MobileStack } from "./MobileStack";
import { useTelemetry } from "./useTelemetry";

/**
 * The visualize tab's client shell.
 *
 * Its only real decisions are which geometry to use and what to show when
 * there is nothing to draw. Everything else is delegated: the map animates
 * from telemetry, and telemetry comes from the database.
 */

const MOBILE_BREAKPOINT = 720;

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return narrow;
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="grid min-h-[420px] w-full place-items-center rounded-2xl border p-8"
      style={{
        background: "var(--bg-card)",
        borderColor: "var(--border)",
        boxShadow: "var(--card-shadow)",
      }}
    >
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">{children}</div>
    </div>
  );
}

export default function VisualizeClient() {
  const { data, status } = useTelemetry(true);
  const narrow = useIsNarrow();
  const reduced = usePrefersReducedMotion();

  if (status === "loading" && !data) {
    return (
      <Panel>
        <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
          Reading what your brain is doing right now…
        </p>
      </Panel>
    );
  }

  if (status === "error" || !data) {
    return (
      <Panel>
        <TriangleAlert size={22} style={{ color: "var(--coral)" }} />
        <p className="text-[13px]" style={{ color: "var(--text-primary)" }}>
          Could not read the brain telemetry.
        </p>
        <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
          The map only draws from real activity, so it stays blank rather than
          showing a guess. It will fill in on the next poll.
        </p>
      </Panel>
    );
  }

  // RULE 1-1 taken to its conclusion: with nothing connected there is nothing
  // honest to draw, so the tab asks for a source instead of orbiting zeroes.
  if (data.nodes.length === 0) {
    return (
      <Panel>
        <Plug size={22} style={{ color: "var(--text-muted)" }} />
        <p className="text-[13px]" style={{ color: "var(--text-primary)" }}>
          Nothing is flowing yet.
        </p>
        <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
          Connect a source or upload a document, and this map will show it moving
          through the brain in real time.
        </p>
        <div className="mt-1 flex gap-2">
          <Link
            href="/connectors"
            className="rounded-lg px-3 py-1.5 text-[12px] font-medium"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            Connect a source
          </Link>
          <Link
            href="/sources"
            className="rounded-lg border px-3 py-1.5 text-[12px] font-medium"
            style={{ borderColor: "var(--border-strong)", color: "var(--text-secondary)" }}
          >
            Upload a document
          </Link>
        </div>
      </Panel>
    );
  }

  return narrow ? (
    <MobileStack telemetry={data} />
  ) : (
    <BrainMap telemetry={data} reduced={reduced} />
  );
}

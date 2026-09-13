"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { nodeColor, type NodeDef } from "./registry";
import type { NodeState, TelemetryNode } from "@/lib/brain/telemetry";
import { useInterpolatedCount } from "./useTelemetry";

/**
 * One orbiting node (spec §4.3, §6).
 *
 * It is a real button, not a decorated div: every node on this map is a door,
 * so it has to be reachable by keyboard and announce its own state. The
 * aria-label carries the count and the state, because a screen-reader user
 * gets nothing from a pulsing ring.
 *
 * State drives colour, and colour is never the only signal — an errored node
 * also grows an alert badge, and its ring stops entirely.
 */

const CHIP = 38;

function ringColor(state: NodeState, base: string): string {
  if (state === "error") return "var(--coral)";
  if (state === "cold") return "var(--amber)";
  return base;
}

function stateWord(state: NodeState): string {
  switch (state) {
    case "active":
      return "syncing now";
    case "live":
      return "connected";
    case "error":
      return "error";
    case "cold":
      return "limited history";
    default:
      return "idle";
  }
}

export function SourceNode({
  def,
  telemetry,
  index,
  animate,
  onNavigate,
  onHover,
}: {
  def: NodeDef;
  telemetry: TelemetryNode;
  /** Stagger index so the arc breathes instead of strobing in unison. */
  index: number;
  animate: boolean;
  onNavigate: (route: string) => void;
  onHover: (nodeId: string | null) => void;
}) {
  const base = nodeColor(def);
  const accent = ringColor(telemetry.state, base);
  const Icon = def.icon;
  const errored = telemetry.state === "error";

  const shownCount = useInterpolatedCount(telemetry.count, animate);
  // The label is precomputed server-side, so only the numeric part is tweened;
  // anything with extra structure ("214 · 3 new") is left exactly as measured.
  const label =
    telemetry.countLabel === telemetry.count.toLocaleString("en-US")
      ? shownCount.toLocaleString("en-US")
      : telemetry.countLabel;

  return (
    <button
      type="button"
      onClick={() => onNavigate(def.route)}
      onMouseEnter={() => onHover(def.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(def.id)}
      onBlur={() => onHover(null)}
      title={errored ? telemetry.error : undefined}
      aria-label={`${def.label}, ${telemetry.countLabel}, ${stateWord(
        telemetry.state
      )}. Open ${def.destination}.`}
      className="viz-node group flex w-[104px] flex-col items-center gap-1.5 rounded-xl p-1 outline-none focus-visible:ring-2"
      style={
        {
          "--tw-ring-color": accent,
        } as React.CSSProperties
      }
    >
      <span className="relative grid place-items-center" style={{ width: CHIP, height: CHIP }}>
        {/* A stopped ring is itself information: this connector is not running. */}
        {!errored && (
          <span
            aria-hidden
            className="viz-node-ring absolute inset-0 rounded-[12px] border"
            style={
              {
                borderColor: accent,
                "--viz-delay": `${(index * 0.37).toFixed(2)}s`,
              } as React.CSSProperties
            }
          />
        )}

        <span
          className="viz-node-chip grid h-full w-full place-items-center rounded-[12px] border"
          style={{
            background: "var(--bg-inset)",
            borderColor: errored ? "var(--coral)" : "var(--border)",
          }}
        >
          <Icon size={17} strokeWidth={1.75} color={errored ? "var(--coral)" : base} />
        </span>

        {errored && (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 grid h-[15px] w-[15px] place-items-center rounded-full"
            style={{ background: "var(--coral)" }}
          >
            <AlertTriangle size={9} strokeWidth={2.5} color="var(--bg-card)" />
          </span>
        )}
      </span>

      <span className="flex flex-col items-center gap-0.5">
        <span
          className="text-[10.5px] font-medium leading-none"
          style={{ color: errored ? "var(--coral)" : "var(--text-secondary)" }}
        >
          {def.label}
        </span>
        <span
          className="text-[9.5px] leading-none"
          style={{ color: "var(--text-muted)" }}
        >
          {label}
        </span>
      </span>
    </button>
  );
}

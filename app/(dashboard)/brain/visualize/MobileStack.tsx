"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Brain } from "lucide-react";
import { formatRelativeTime } from "@/lib/chat/format";
import type { TelemetryNode, VisualizeTelemetry } from "@/lib/brain/telemetry";
import { NODES, nodeColor } from "./registry";

/**
 * The narrow-screen map (spec §5).
 *
 * A radial layout at 360px would be an unreadable tangle, so below 720px the
 * same telemetry is presented as two columns with activity dots instead of
 * edges. Nothing is dropped: every node keeps its count, its state and its
 * navigation — only the geometry changes.
 */

function ActivityDot({ node, color }: { node: TelemetryNode; color: string }) {
  if (node.state === "error") {
    return <AlertTriangle size={12} color="var(--coral)" strokeWidth={2.2} />;
  }

  const live = node.recentEvents15m > 0;
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{
        background: node.state === "cold" ? "var(--amber)" : color,
        opacity: live ? 1 : 0.35,
      }}
    />
  );
}

function Column({
  title,
  nodes,
  telemetry,
}: {
  title: string;
  nodes: typeof NODES;
  telemetry: Record<string, TelemetryNode>;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-2">
      <p
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {title}
      </p>

      {nodes.map((def) => {
        const node = telemetry[def.id];
        const Icon = def.icon;
        const errored = node.state === "error";

        return (
          <button
            key={def.id}
            type="button"
            onClick={() => router.push(def.route)}
            aria-label={`${def.label}, ${node.countLabel}, ${node.state}. Open ${def.destination}.`}
            className="flex items-center gap-2.5 rounded-xl border p-2.5 text-left outline-none focus-visible:ring-2"
            style={
              {
                background: "var(--bg-card)",
                borderColor: errored ? "var(--coral)" : "var(--border)",
                "--tw-ring-color": nodeColor(def),
              } as React.CSSProperties
            }
          >
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border"
              style={{ background: "var(--bg-inset)", borderColor: "var(--border)" }}
            >
              <Icon
                size={15}
                strokeWidth={1.75}
                color={errored ? "var(--coral)" : nodeColor(def)}
              />
            </span>

            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className="truncate text-[12px] font-medium"
                style={{ color: "var(--text-primary)" }}
              >
                {def.label}
              </span>
              <span
                className="truncate text-[10px]"
                style={{ color: "var(--text-muted)" }}
              >
                {errored ? node.error : node.countLabel}
              </span>
            </span>

            <ActivityDot node={node} color={nodeColor(def)} />
          </button>
        );
      })}
    </div>
  );
}

export function MobileStack({ telemetry }: { telemetry: VisualizeTelemetry }) {
  const router = useRouter();
  const byId = Object.fromEntries(telemetry.nodes.map((n) => [n.id, n]));
  const present = NODES.filter((d) => byId[d.id] !== undefined);

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => router.push("/brain")}
        aria-label={`Company brain, ${telemetry.brain.totalItems} items, ${
          telemetry.brain.processing ? "learning" : "idle"
        }. Open the brain overview.`}
        className="flex items-center gap-3 rounded-xl border p-3 outline-none focus-visible:ring-2"
        style={
          {
            background: "var(--bg-card)",
            borderColor: "var(--border)",
            "--tw-ring-color": "var(--teal)",
          } as React.CSSProperties
        }
      >
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full"
          style={{
            background:
              "radial-gradient(circle at 32% 28%, var(--bg-card), var(--bg-inset))",
            border: "1.5px solid color-mix(in srgb, var(--teal) 45%, transparent)",
          }}
        >
          <Brain size={22} strokeWidth={1.5} stroke="url(#viz-brain-gradient)" />
        </span>
        <span className="flex flex-col text-left">
          <span
            className="text-[14px] font-bold"
            style={{ color: "var(--text-primary)" }}
          >
            {telemetry.brain.totalItems.toLocaleString("en-US")} items
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {telemetry.brain.processing ? "learning" : "idle"}
            {telemetry.brain.lastWriteAt
              ? ` · last write ${formatRelativeTime(telemetry.brain.lastWriteAt)}`
              : ""}
          </span>
        </span>
      </button>

      <div className="grid grid-cols-2 gap-3">
        <Column
          title="In"
          nodes={present.filter((d) => d.nodeClass === "source")}
          telemetry={byId}
        />
        <Column
          title="Out"
          nodes={present.filter((d) => d.nodeClass === "derived")}
          telemetry={byId}
        />
      </div>
    </div>
  );
}

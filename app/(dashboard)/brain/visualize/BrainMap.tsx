"use client";

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRelativeTime } from "@/lib/chat/format";
import type { TelemetryNode, VisualizeTelemetry } from "@/lib/brain/telemetry";
import { BrainCore, BrainGradientDefs, BRAIN_SIZE } from "./BrainCore";
import { ParticleLayer, type EdgeParticles } from "./ParticleLayer";
import { SourceNode } from "./SourceNode";
import { clampParticles, NODE_BY_ID, NODES, nodeColor, particleSpec } from "./registry";
import { useOnScreen } from "./useTelemetry";

/**
 * The radial map (spec §5).
 *
 * Geometry is computed from the registry order and the measured container, not
 * hand-placed — a tenant missing a connector gets an evenly redistributed arc
 * rather than a hole where a node used to be.
 *
 * Sources sweep down the left arc and derived nodes down the right, each in
 * registry order, which lands Meetings and Patterns on the upper diagonals as
 * §5 asks while keeping placement fully derived.
 */

export const NODE_HALF = 26;
export const BRAIN_EDGE = BRAIN_SIZE / 2 + 8;
const MIN_HEIGHT = 560;

type Placed = {
  def: (typeof NODES)[number];
  telemetry: TelemetryNode;
  x: number;
  y: number;
  path: string;
  index: number;
};

/** Evenly distribute `n` nodes across an arc, or centre a lone node on it. */
export function arcAngles(n: number, from: number, to: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [(from + to) / 2];
  const step = (to - from) / (n - 1);
  return Array.from({ length: n }, (_, i) => from + step * i);
}

/**
 * A quadratic curve between the two shapes' edges, bowed off the straight line.
 *
 * Endpoints are inset past each shape's radius so a particle appears to leave
 * the connector and arrive at the brain rather than starting under an icon.
 * Direction is caller-controlled: sources flow inward, derived flow outward.
 */
export function edgePath(
  nodeX: number,
  nodeY: number,
  brainX: number,
  brainY: number,
  outward: boolean
): string {
  const dx = brainX - nodeX;
  const dy = brainY - nodeY;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  const startX = nodeX + ux * NODE_HALF;
  const startY = nodeY + uy * NODE_HALF;
  const endX = brainX - ux * BRAIN_EDGE;
  const endY = brainY - uy * BRAIN_EDGE;

  const bow = dist * 0.13;
  const cx = (startX + endX) / 2 + -uy * bow;
  const cy = (startY + endY) / 2 + ux * bow;

  return outward
    ? `M ${endX.toFixed(1)} ${endY.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(
        1
      )} ${startX.toFixed(1)} ${startY.toFixed(1)}`
    : `M ${startX.toFixed(1)} ${startY.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(
        1
      )} ${endX.toFixed(1)} ${endY.toFixed(1)}`;
}

type RecentItem = { title: string; at: string | null };

export function BrainMap({
  telemetry,
  reduced,
}: {
  telemetry: VisualizeTelemetry;
  reduced: boolean;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(containerRef);
  const [size, setSize] = useState({ width: 0, height: MIN_HEIGHT });
  const [hovered, setHovered] = useState<string | null>(null);
  const [recent, setRecent] = useState<Record<string, RecentItem[]>>({});

  // Layout effect, not a passive one: the first measurement has to land before
  // paint or the card shows an empty frame and then pops the whole map in.
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const measure = () =>
      setSize({ width: node.clientWidth, height: Math.max(node.clientHeight, MIN_HEIGHT) });

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /**
   * Fetch the last three items on hover, once per node.
   *
   * This is the moment the particles stop being decoration, so it reads real
   * rows — but only when asked, and only the first time, because a hover feed
   * firing on every mouse pass would cost more than the map itself.
   */
  const loadRecent = useCallback(
    async (nodeId: string | null) => {
      setHovered(nodeId);
      if (!nodeId || recent[nodeId]) return;
      try {
        const res = await fetch(`/api/brain/visualize/edge/${nodeId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { items: RecentItem[] };
        setRecent((prev) => ({ ...prev, [nodeId]: json.items }));
      } catch {
        // A tooltip that cannot load simply does not appear.
      }
    },
    [recent]
  );

  const byId = useMemo(
    () => Object.fromEntries(telemetry.nodes.map((n) => [n.id, n])),
    [telemetry.nodes]
  );

  // RULE 1-1: a node with no telemetry row is absent, never greyed out.
  const present = useMemo(
    () => NODES.filter((def) => byId[def.id] !== undefined),
    [byId]
  );

  const placed = useMemo<Placed[]>(() => {
    if (size.width === 0) return [];

    const cx = size.width / 2;
    const cy = size.height / 2;

    // Elliptical, not circular. A single radius is capped by whichever axis is
    // tighter — always the height — which parks the nodes near the middle and
    // leaves the panel looking half-empty on a wide screen. Separate radii let
    // the arcs use the width they actually have while staying clear of the top
    // and bottom edges.
    const rx = Math.max(150, Math.min(size.width / 2 - 130, 460));
    const ry = Math.max(120, size.height / 2 - 78);

    const sources = present.filter((d) => d.nodeClass === "source");
    const derived = present.filter((d) => d.nodeClass === "derived");

    // Descending sweeps: the last source lands on the upper-left diagonal and
    // the first derived node on the upper-right, per §5.
    const sourceAngles = arcAngles(sources.length, 225, 135);
    const derivedAngles = arcAngles(derived.length, 45, -45);

    const place = (
      defs: typeof NODES,
      angles: number[],
      outward: boolean,
      offset: number
    ): Placed[] =>
      defs.map((def, i) => {
        const rad = (angles[i] * Math.PI) / 180;
        const x = cx + rx * Math.cos(rad);
        const y = cy - ry * Math.sin(rad);
        return {
          def,
          telemetry: byId[def.id],
          x,
          y,
          path: edgePath(x, y, cx, cy, outward),
          index: offset + i,
        };
      });

    return [
      ...place(sources, sourceAngles, false, 0),
      ...place(derived, derivedAngles, true, sources.length),
    ];
  }, [present, byId, size]);

  /** Particle counts, capped scene-wide with the quiet edges shedding first. */
  const particles = useMemo<EdgeParticles[]>(() => {
    if (reduced) return [];

    const specs = placed.map((p) => ({
      id: p.def.id,
      recentEvents15m: p.telemetry.recentEvents15m,
      spec: particleSpec(p.telemetry.recentEvents15m),
    }));
    const capped = clampParticles(specs);

    return placed
      .map((p) => ({
        edgeId: p.def.id,
        path: p.path,
        color: nodeColor(p.def),
        count: capped[p.def.id].count,
        duration: capped[p.def.id].duration,
      }))
      .filter((e) => e.count > 0);
  }, [placed, reduced]);

  const activeStreams = telemetry.nodes.filter((n) => n.state === "active").length;

  return (
    /* One panel, not three stacked rows. The chrome describes the canvas, so it
       belongs inside the same border — otherwise the legend and the live badge
       read as page furniture that happens to sit near a card. */
    <section
      className="flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border"
      style={{
        background: "var(--bg-card)",
        borderColor: "var(--border)",
        boxShadow: "var(--card-shadow)",
      }}
    >
      <BrainGradientDefs />

      {/* ── §4.4 status chrome ─────────────────────────────────────────────── */}
      <header
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b px-5 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="min-w-0 text-[12px]" style={{ color: "var(--text-secondary)" }}>
          Raw sources flow in on the left. Derived knowledge flows out on the right.
        </p>
        <p
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px]"
          style={{ color: telemetry.brain.processing ? "var(--teal)" : "var(--text-muted)" }}
        >
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{
              background: telemetry.brain.processing ? "var(--teal)" : "var(--text-muted)",
            }}
          />
          {telemetry.brain.processing
            ? `live · processing ${activeStreams} stream${activeStreams === 1 ? "" : "s"}`
            : "idle"}
        </p>
      </header>

      <div
        ref={containerRef}
        className={`relative w-full flex-1 overflow-hidden ${onScreen ? "" : "viz-paused"}`}
        style={{ minHeight: MIN_HEIGHT }}
      >
        <AmbientDots reduced={reduced} />

        <svg
          className="absolute inset-0 h-full w-full"
          width={size.width}
          height={size.height}
          aria-hidden
        >
          {placed.map((p) => {
            const quiet = p.telemetry.recentEvents15m <= 0;
            return (
              <path
                key={p.def.id}
                d={p.path}
                className="viz-edge"
                data-edge={p.def.id}
                data-hovered={hovered === p.def.id ? "true" : "false"}
                fill="none"
                stroke={nodeColor(p.def)}
                // Opacity carries activity, which is what makes the static
                // reduced-motion variant still answer "what is running now".
                strokeOpacity={quiet ? 0.14 : 0.18 + Math.min(0.5, p.telemetry.recentEvents15m / 60)}
                strokeWidth={hovered === p.def.id ? 2 : 1.25}
                strokeLinecap="round"
              />
            );
          })}
        </svg>

        <ParticleLayer edges={particles} paused={!onScreen} />

        {/* Brain, centred. */}
        <div
          className="absolute"
          style={{
            left: size.width / 2,
            top: size.height / 2,
            transform: "translate(-50%, -50%)",
          }}
        >
          <BrainCore
            totalItems={telemetry.brain.totalItems}
            processing={telemetry.brain.processing}
            onOpen={() => router.push("/brain")}
          />
        </div>

        {/* Nodes, in DOM order sources-then-derived so tabbing follows the flow. */}
        {placed.map((p) => (
          <div
            key={p.def.id}
            className="absolute"
            style={{ left: p.x, top: p.y, transform: "translate(-50%, -50%)" }}
          >
            <SourceNode
              def={p.def}
              telemetry={p.telemetry}
              index={p.index}
              animate={!reduced}
              onNavigate={(route) => router.push(route)}
              onHover={loadRecent}
            />

            {hovered === p.def.id && recent[p.def.id]?.length ? (
              <EdgeTooltip items={recent[p.def.id]} label={p.def.label} />
            ) : null}
          </div>
        ))}
      </div>

      {/* ── §4.4 bottom bar ────────────────────────────────────────────────── */}
      <footer
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t px-5 py-3 text-[11px]"
        style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5">
            <span aria-hidden style={{ color: "var(--teal)" }}>
              →
            </span>
            in · raw sources
          </span>
          <span className="flex items-center gap-1.5">
            out
            <span aria-hidden style={{ color: "var(--accent)" }}>
              →
            </span>
            derived knowledge
          </span>
        </span>
        <span className="shrink-0 whitespace-nowrap">
          {telemetry.brain.lastWriteAt
            ? `last brain write ${formatRelativeTime(telemetry.brain.lastWriteAt)}`
            : "no brain writes yet"}
        </span>
      </footer>
    </section>
  );
}

/** The last three real items that travelled this edge (§3). */
function EdgeTooltip({ items, label }: { items: RecentItem[]; label: string }) {
  return (
    <div
      role="tooltip"
      className="absolute left-1/2 top-full z-20 mt-1 w-[210px] -translate-x-1/2 rounded-[10px] p-2.5"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-strong)",
        boxShadow: "0 8px 24px rgba(0,0,0,.18)",
      }}
    >
      <p className="mb-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
        Last through {label}
      </p>
      <ul className="flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={i} className="flex flex-col">
            <span
              className="truncate text-[11px]"
              style={{ color: "var(--text-secondary)" }}
            >
              {item.title}
            </span>
            {item.at && (
              <span className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>
                {formatRelativeTime(item.at)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * §7.5 — the only unbound motion on this screen, and capped at six.
 *
 * Positions are fixed rather than random so the scene does not reshuffle on
 * every re-render.
 */
const AMBIENT = [
  { left: "14%", top: "22%", dx: "10px", dy: "-12px", dur: "17s", delay: "0s" },
  { left: "28%", top: "72%", dx: "-8px", dy: "10px", dur: "21s", delay: "-4s" },
  { left: "46%", top: "16%", dx: "12px", dy: "8px", dur: "19s", delay: "-9s" },
  { left: "63%", top: "80%", dx: "-11px", dy: "-9px", dur: "23s", delay: "-2s" },
  { left: "82%", top: "34%", dx: "9px", dy: "11px", dur: "18s", delay: "-13s" },
  { left: "90%", top: "64%", dx: "-10px", dy: "-8px", dur: "20s", delay: "-6s" },
];

function AmbientDots({ reduced }: { reduced: boolean }) {
  if (reduced) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {AMBIENT.map((dot, i) => (
        <span
          key={i}
          className="viz-ambient absolute h-1 w-1 rounded-full"
          style={
            {
              left: dot.left,
              top: dot.top,
              background: "var(--text-muted)",
              "--viz-dx": dot.dx,
              "--viz-dy": dot.dy,
              "--viz-dur": dot.dur,
              "--viz-delay": dot.delay,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export { NODE_BY_ID };

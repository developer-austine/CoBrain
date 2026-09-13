import {
  FileText,
  GitBranch,
  Gavel,
  Lightbulb,
  MessagesSquare,
  ScatterChart,
  TrendingUp,
  Video,
  type LucideIcon,
} from "lucide-react";

/**
 * The node registry (spec §1) — the single source of truth for what can appear
 * on the map, which side it sits on, what colour it carries and where it goes
 * when clicked.
 *
 * Layout is computed from this order rather than hand-placed, so a tenant
 * missing a connector gets an evenly redistributed arc instead of a gap.
 */

export type NodeClass = "source" | "derived";

export type NodeDef = {
  id: string;
  nodeClass: NodeClass;
  label: string;
  icon: LucideIcon;
  route: string;
  /** CSS token name; resolved through `var(--…)` so both themes work (§0). */
  color: string;
  /** Screen-reader phrase for the destination, used in the aria-label (§6). */
  destination: string;
};

export const NODES: NodeDef[] = [
  {
    id: "engineering",
    nodeClass: "source",
    label: "Engineering",
    icon: GitBranch,
    route: "/connectors?focus=github",
    color: "--teal",
    destination: "the GitHub connector",
  },
  {
    id: "comms",
    nodeClass: "source",
    label: "Comms",
    icon: MessagesSquare,
    route: "/connectors?focus=gmail",
    color: "--teal",
    destination: "the Gmail connector",
  },
  {
    id: "docs",
    nodeClass: "source",
    label: "Docs",
    icon: FileText,
    route: "/sources",
    color: "--teal",
    destination: "sources",
  },
  {
    id: "meetings",
    nodeClass: "source",
    label: "Meetings",
    icon: Video,
    route: "/brain#meetings",
    color: "--teal",
    destination: "meeting intelligence",
  },
  {
    id: "patterns",
    nodeClass: "derived",
    label: "Patterns",
    icon: ScatterChart,
    route: "/brain#patterns",
    color: "--ice",
    destination: "patterns and insights",
  },
  {
    id: "forecasts",
    nodeClass: "derived",
    label: "Forecasts",
    icon: TrendingUp,
    route: "/forecasts",
    color: "--amber",
    destination: "forecasts",
  },
  {
    id: "facts",
    nodeClass: "derived",
    label: "Learned facts",
    icon: Lightbulb,
    route: "/brain#facts",
    color: "--accent",
    destination: "learned facts",
  },
  {
    id: "decisions",
    nodeClass: "derived",
    label: "Decisions",
    icon: Gavel,
    route: "/brain#decisions",
    color: "--accent",
    destination: "the decisions log",
  },
];

export const NODE_BY_ID: Record<string, NodeDef> = Object.fromEntries(
  NODES.map((n) => [n.id, n])
);

/** `var(--teal)` etc. — never a literal, so the map follows the theme (§0). */
export function nodeColor(node: NodeDef): string {
  return `var(${node.color})`;
}

/**
 * Particle behaviour for an edge, mapped from real event volume (§3).
 *
 * A quiet connector must look quiet — that is the whole point of the map, so
 * zero events means zero particles and a dimmed edge, not a slow trickle.
 */
export type ParticleSpec = { count: number; duration: number };

export function particleSpec(recentEvents15m: number): ParticleSpec {
  if (recentEvents15m <= 0) return { count: 0, duration: 0 };
  if (recentEvents15m <= 5) return { count: 1, duration: 3.6 };
  if (recentEvents15m <= 50) return { count: 2, duration: 3.0 };
  return { count: 3, duration: 2.4 };
}

/** Scene-wide particle ceiling (§3). */
export const MAX_PARTICLES = 30;

/**
 * Apply the scene cap, shedding from the least-active edges first.
 *
 * Trimming the busiest edge would misrepresent which part of the system is
 * under load, so the quiet edges lose their single particle before a heavy
 * sync loses one of its three.
 */
export function clampParticles(
  specs: { id: string; recentEvents15m: number; spec: ParticleSpec }[]
): Record<string, ParticleSpec> {
  const result: Record<string, ParticleSpec> = {};
  for (const s of specs) result[s.id] = s.spec;

  let total = specs.reduce((sum, s) => sum + s.spec.count, 0);
  if (total <= MAX_PARTICLES) return result;

  const ascending = [...specs].sort((a, b) => a.recentEvents15m - b.recentEvents15m);
  for (const s of ascending) {
    while (total > MAX_PARTICLES && result[s.id].count > 0) {
      result[s.id] = { ...result[s.id], count: result[s.id].count - 1 };
      total -= 1;
    }
    if (total <= MAX_PARTICLES) break;
  }

  return result;
}

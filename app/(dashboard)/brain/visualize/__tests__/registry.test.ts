import { describe, expect, it } from "vitest";
import {
  clampParticles,
  MAX_PARTICLES,
  NODES,
  particleSpec,
  type ParticleSpec,
} from "../registry";

describe("particleSpec — the §3 rate table", () => {
  it("gives a quiet edge nothing at all", () => {
    // RULE 3-1: watching the map has to tell you what is syncing *now*, which
    // only works if an idle connector genuinely stops moving.
    expect(particleSpec(0)).toEqual({ count: 0, duration: 0 });
  });

  it("maps each band to its specified count and duration", () => {
    expect(particleSpec(1)).toEqual({ count: 1, duration: 3.6 });
    expect(particleSpec(5)).toEqual({ count: 1, duration: 3.6 });
    expect(particleSpec(6)).toEqual({ count: 2, duration: 3.0 });
    expect(particleSpec(50)).toEqual({ count: 2, duration: 3.0 });
    expect(particleSpec(51)).toEqual({ count: 3, duration: 2.4 });
    expect(particleSpec(5000)).toEqual({ count: 3, duration: 2.4 });
  });

  it("speeds up monotonically with volume", () => {
    const durations = [1, 6, 51].map((n) => particleSpec(n).duration);
    expect(durations).toEqual([...durations].sort((a, b) => b - a));
  });
});

describe("clampParticles — the scene cap", () => {
  const spec = (id: string, events: number) => ({
    id,
    recentEvents15m: events,
    spec: particleSpec(events),
  });

  it("leaves an under-cap scene untouched", () => {
    const input = [spec("a", 100), spec("b", 10), spec("c", 1)];
    const out = clampParticles(input);
    expect(out.a.count).toBe(3);
    expect(out.b.count).toBe(2);
    expect(out.c.count).toBe(1);
  });

  it("holds the cap when every edge is saturated", () => {
    const input = Array.from({ length: 20 }, (_, i) => spec(`n${i}`, 500));
    const out = clampParticles(input);
    const total = Object.values(out).reduce((sum, s: ParticleSpec) => sum + s.count, 0);
    expect(total).toBeLessThanOrEqual(MAX_PARTICLES);
  });

  it("sheds from the quietest edges first", () => {
    // Trimming the busiest edge would misreport which part of the system is
    // under load — exactly the lie the map exists to avoid.
    const input = [
      spec("busiest", 900),
      ...Array.from({ length: 15 }, (_, i) => spec(`quiet${i}`, 2)),
    ];
    const out = clampParticles(input);

    expect(out.busiest.count).toBe(3);
    const total = Object.values(out).reduce((sum, s: ParticleSpec) => sum + s.count, 0);
    expect(total).toBeLessThanOrEqual(MAX_PARTICLES);
  });

  it("never produces a negative count", () => {
    const input = Array.from({ length: 40 }, (_, i) => spec(`n${i}`, 999));
    const out = clampParticles(input);
    for (const s of Object.values(out) as ParticleSpec[]) {
      expect(s.count).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("registry", () => {
  it("has unique ids and a route for every node", () => {
    const ids = NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const node of NODES) {
      expect(node.route).toMatch(/^\//);
      expect(node.destination.length).toBeGreaterThan(0);
    }
  });

  it("carries colour as a token, never a literal", () => {
    // Hardcoding a hex here is what breaks one of the two themes (§0).
    for (const node of NODES) {
      expect(node.color).toMatch(/^--[a-z]+$/);
    }
  });
});

import { describe, expect, it } from "vitest";
import { arcAngles, edgePath, NODE_HALF, BRAIN_EDGE } from "../BrainMap";

/**
 * The layout maths (spec §5).
 *
 * These run without a browser, which matters: node placement, edge endpoints
 * and flow direction only exist after the container is measured, so a server
 * render never shows them. Testing the geometry directly is what keeps that
 * half of the map from being unverified.
 */

/** Where a node lands, in the same screen coordinates the component uses. */
function place(angleDeg: number, cx: number, cy: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy - radius * Math.sin(rad) };
}

describe("arcAngles", () => {
  it("centres a lone node on its arc rather than pinning it to an end", () => {
    expect(arcAngles(1, 225, 135)).toEqual([180]);
    expect(arcAngles(1, 45, -45)).toEqual([0]);
  });

  it("spreads nodes evenly across the arc, endpoints included", () => {
    expect(arcAngles(3, 225, 135)).toEqual([225, 180, 135]);
    expect(arcAngles(5, 45, -45)).toEqual([45, 22.5, 0, -22.5, -45]);
  });

  it("redistributes when a node is absent instead of leaving a gap", () => {
    // RULE 1-1: a tenant with no Notion connection should see three evenly
    // spread sources, not four slots with one empty.
    const four = arcAngles(4, 225, 135);
    const three = arcAngles(3, 225, 135);
    expect(four).toHaveLength(4);
    expect(three).toEqual([225, 180, 135]);
    for (const a of [...four, ...three]) {
      expect(a).toBeGreaterThanOrEqual(135);
      expect(a).toBeLessThanOrEqual(225);
    }
  });

  it("returns nothing for an empty side", () => {
    expect(arcAngles(0, 225, 135)).toEqual([]);
  });
});

describe("§5 arc placement", () => {
  const cx = 500;
  const cy = 280;
  const r = 200;

  it("puts sources on the left and derived on the right", () => {
    for (const a of arcAngles(4, 225, 135)) {
      expect(place(a, cx, cy, r).x).toBeLessThan(cx);
    }
    for (const a of arcAngles(4, 45, -45)) {
      expect(place(a, cx, cy, r).x).toBeGreaterThan(cx);
    }
  });

  it("lands Meetings and Patterns on the upper diagonals", () => {
    // §5 names these two positions explicitly, and they fall out of the
    // registry order only because both arcs sweep downward.
    const sources = arcAngles(4, 225, 135);
    const derived = arcAngles(4, 45, -45);

    const meetings = place(sources[sources.length - 1], cx, cy, r);
    const patterns = place(derived[0], cx, cy, r);

    expect(meetings.x).toBeLessThan(cx);
    expect(meetings.y).toBeLessThan(cy);
    expect(patterns.x).toBeGreaterThan(cx);
    expect(patterns.y).toBeLessThan(cy);
  });
});

describe("edgePath", () => {
  const parse = (d: string) => {
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    return {
      start: { x: nums[0], y: nums[1] },
      control: { x: nums[2], y: nums[3] },
      end: { x: nums[4], y: nums[5] },
    };
  };

  it("starts at the node's rim and stops at the brain's, never at the centres", () => {
    // Endpoints inset by each shape's radius are what make a particle look like
    // it leaves the connector rather than emerging from under its icon.
    const d = edgePath(100, 280, 500, 280, false);
    const { start, end } = parse(d);

    expect(start.x).toBeCloseTo(100 + NODE_HALF, 1);
    expect(end.x).toBeCloseTo(500 - BRAIN_EDGE, 1);
  });

  it("reverses direction for derived nodes so flow reads outward", () => {
    const inward = parse(edgePath(100, 280, 500, 280, false));
    const outward = parse(edgePath(100, 280, 500, 280, true));

    expect(outward.start).toEqual(inward.end);
    expect(outward.end).toEqual(inward.start);
  });

  it("bows off the straight line so edges do not overlap into one bar", () => {
    const { start, control, end } = parse(edgePath(100, 280, 500, 280, false));
    const midY = (start.y + end.y) / 2;
    expect(Math.abs(control.y - midY)).toBeGreaterThan(10);
  });

  it("emits a well-formed quadratic path for every arc position", () => {
    const cx = 500;
    const cy = 280;
    for (const angle of [...arcAngles(4, 225, 135), ...arcAngles(4, 45, -45)]) {
      const p = place(angle, cx, cy, 200);
      const d = edgePath(p.x, p.y, cx, cy, angle < 90 && angle > -90);
      expect(d).toMatch(/^M -?[\d.]+ -?[\d.]+ Q -?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+$/);
      expect(d).not.toContain("NaN");
    }
  });

  it("survives a node sitting exactly on the brain without dividing by zero", () => {
    const d = edgePath(500, 280, 500, 280, false);
    expect(d).not.toContain("NaN");
  });
});

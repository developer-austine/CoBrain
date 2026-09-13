"use client";

import React from "react";

/**
 * Documents in flight (spec §3).
 *
 * Each particle follows the exact path string its edge is drawn with, so a dot
 * can never wander off its own curve. Motion is `offset-distance` only — no
 * rAF loop, no canvas — which keeps the whole scene on the compositor and lets
 * a single CSS class freeze it when the card scrolls away.
 *
 * Negative delays are deliberate: they start each particle mid-flight, so the
 * map opens already in motion rather than with everything queued at the source.
 */

export type EdgeParticles = {
  edgeId: string;
  path: string;
  color: string;
  count: number;
  duration: number;
};

export function ParticleLayer({
  edges,
  paused,
}: {
  edges: EdgeParticles[];
  paused: boolean;
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${paused ? "viz-paused" : ""}`}
    >
      {edges.flatMap((edge) =>
        Array.from({ length: edge.count }, (_, i) => {
          const stagger = -(edge.duration / edge.count) * i;
          return (
            <React.Fragment key={`${edge.edgeId}-${i}`}>
              <span
                className="viz-particle absolute left-0 top-0 rounded-full"
                style={
                  {
                    width: 3,
                    height: 3,
                    background: edge.color,
                    offsetPath: `path("${edge.path}")`,
                    "--viz-dur": `${edge.duration}s`,
                    "--viz-delay": `${stagger}s`,
                  } as React.CSSProperties
                }
              />
              {/* A shorter-lagging twin reads as a trail without costing a
                  second animation type. */}
              <span
                className="viz-particle absolute left-0 top-0 rounded-full"
                style={
                  {
                    width: 2,
                    height: 2,
                    background: edge.color,
                    opacity: 0.6,
                    offsetPath: `path("${edge.path}")`,
                    "--viz-dur": `${edge.duration}s`,
                    "--viz-delay": `${stagger - 0.12}s`,
                  } as React.CSSProperties
                }
              />
            </React.Fragment>
          );
        })
      )}
    </div>
  );
}

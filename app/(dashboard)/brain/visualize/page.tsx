import React from "react";
import BrainTabs from "../_components/BrainTabs";
import VisualizeClient from "./VisualizeClient";

export const dynamic = "force-dynamic";

/**
 * The Brain's live map — what the system is doing right now, as opposed to
 * what it has learned.
 *
 * The shell is deliberately thin: it renders no counts of its own, because
 * every number on this screen has to come from the telemetry endpoint so that
 * nothing on the map can drift out of step with the animation bound to it.
 *
 * `min-w-0` on the column matters more than it looks — without it a flex child
 * refuses to shrink below its content, and the status badge and the last-write
 * stamp get pushed off the right edge instead of wrapping.
 */
export default function BrainVisualizePage() {
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1400px] flex-col px-4 pb-8 sm:px-6">
      <BrainTabs />

      <div className="mb-5 mt-1">
        <h1 className="text-[22px] font-bold" style={{ color: "var(--text-primary)" }}>
          The living brain
        </h1>
        <p
          className="mt-1 max-w-[70ch] text-[13px]"
          style={{ color: "var(--text-secondary)" }}
        >
          Everything moving here is real. Particle speed, node state and the
          centre pulse are all read from live activity — nothing on this map is
          decoration.
        </p>
      </div>

      <VisualizeClient />
    </div>
  );
}

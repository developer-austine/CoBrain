"use client";

import React from "react";
import { sigmaTooltip } from "@/lib/interpret/narrative";
import { formatSigma } from "@/lib/forecast/types";

/**
 * A sigma value that can explain itself (spec §9).
 *
 * Every σ on the page goes through this component so the explanation is
 * guaranteed rather than remembered. σ is the one unit here that means nothing
 * to a reader who has not been told what it is, and a number nobody can
 * interpret is decoration.
 *
 * `tnum` keeps the digits tabular so a value ticking on a poll does not shift
 * its neighbours.
 */
export function SigmaValue({
  value,
  signalId,
  className = "",
  style,
}: {
  value: number;
  signalId: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={`tnum ${className}`}
      style={style}
      title={sigmaTooltip(signalId, value)}
    >
      {formatSigma(value)}
    </span>
  );
}

import { describe, expect, it } from "vitest";
import {
  buildNarrative,
  microSummary,
  resolveDrivers,
  sigmaTooltip,
  wordCount,
  type InterpretInput,
} from "../narrative";
import { FEATURE_LABELS, featureLabel, polarityOf } from "../registry";
import {
  bandPhrase,
  magnitudePhrase,
  momentumOf,
  plainMagnitude,
  weeklyDeltas,
} from "../thresholds";
import { nearestWeek } from "../anchor";

/**
 * The narrative engine (spec §12).
 *
 * These matter more than the component tests: every sentence on the page is a
 * pure function of the payload, so a wrong boundary here is a wrong sentence
 * shown confidently to every reader, with no visual glitch to give it away.
 */

const WEEKS = [
  "2026-05-04", "2026-05-11", "2026-05-18", "2026-05-25",
  "2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22",
];

function input(over: Partial<InterpretInput> = {}): InterpretInput {
  return {
    signalId: "burnout_risk",
    observed: WEEKS.map((week, i) => ({ week, value: i * 0.1 })),
    forecast: [
      { week: "2026-08-31", p10: 0.2, p50: 0.9, p90: 1.6 },
    ],
    driverWeights: [
      { featureId: "after_hours_ratio", weight: 0.5 },
      { featureId: "actor_entropy", weight: 0.3 },
    ],
    weeksObserved: 24,
    minWeeksRequired: 12,
    ...over,
  };
}

describe("determinism — the one law", () => {
  it("produces byte-identical output for identical input", () => {
    const a = buildNarrative(input());
    const b = buildNarrative(input());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("orders equal-weight drivers stably", () => {
    // Without a tiebreak, two equal weights could swap between renders and the
    // "strongest push" sentence would move between drivers on a poll.
    const weights = [
      { featureId: "actor_entropy", weight: 0.4 },
      { featureId: "topic_drift", weight: 0.4 },
    ];
    const first = resolveDrivers(weights).map((d) => d.label);
    const second = resolveDrivers([...weights].reverse()).map((d) => d.label);
    expect(first).toEqual(second);
  });
});

describe("magnitude thresholds", () => {
  // Boundaries are inclusive at the lower edge; these pin the exact cut points.
  it.each([
    [0.0, "holding steady"],
    [0.24, "holding steady"],
    [0.25, "drifting up"],
    [-0.25, "drifting down"],
    [0.749, "drifting up"],
    [0.75, "clearly rising"],
    [-0.75, "clearly falling"],
    [1.49, "clearly rising"],
    [1.5, "moving sharply up"],
    [-1.5, "moving sharply down"],
  ])("%s -> %s", (delta, phrase) => {
    expect(magnitudePhrase(delta)).toBe(phrase);
  });
});

describe("plain magnitude carries polarity", () => {
  it("calls a bad week tough and a good week strong", () => {
    expect(plainMagnitude(1.0, "up_bad")).toBe("about one tough week above its normal");
    expect(plainMagnitude(1.0, "up_good")).toBe("about one strong week above its normal");
  });

  it.each([
    [0.24, "about level with its normal"],
    [0.25, "slightly above its normal"],
    [-0.25, "slightly below its normal"],
    [1.5, "well beyond anything in its recent history"],
  ])("%s -> %s", (delta, phrase) => {
    expect(plainMagnitude(delta, "up_bad")).toBe(phrase);
  });
});

describe("band thresholds", () => {
  it.each([
    [0.99, "the model is fairly confident in this range"],
    [1.0, "that's a wide range — read this as a direction, not a promise"],
    [1.99, "that's a wide range — read this as a direction, not a promise"],
    [2.0, "highly uncertain — directional only"],
  ])("width %s", (w, phrase) => {
    expect(bandPhrase(w)).toBe(phrase);
  });
});

describe("polarity", () => {
  it("reads direction from the existing TARGET_META, not a second table", () => {
    expect(polarityOf("burnout_risk")).toBe("up_bad");
    expect(polarityOf("review_latency")).toBe("up_bad");
    expect(polarityOf("delivery_velocity")).toBe("up_good");
    expect(polarityOf("bus_factor")).toBe("up_good");
  });

  it("treats an unknown signal as neutral rather than alarming", () => {
    expect(polarityOf("not_a_signal")).toBe("up_good");
  });

  it("gives a rising good metric a good tone", () => {
    const n = buildNarrative(
      input({
        signalId: "delivery_velocity",
        observed: WEEKS.map((week) => ({ week, value: 0 })),
        forecast: [{ week: "2026-08-31", p10: 0.5, p50: 1.0, p90: 1.5 }],
      })
    );
    expect(n.verdict.tone).toBe("good");
    expect(n.facts.worsening).toBe(false);
  });

  it("gives a rising bad metric a bad tone", () => {
    const n = buildNarrative(
      input({
        observed: WEEKS.map((week) => ({ week, value: 0 })),
        forecast: [{ week: "2026-08-31", p10: 0.5, p50: 1.0, p90: 1.5 }],
      })
    );
    expect(n.verdict.tone).toBe("bad");
    expect(n.facts.worsening).toBe(true);
  });

  it("calls a flat move neutral in either polarity", () => {
    const n = buildNarrative(
      input({
        observed: WEEKS.map((week) => ({ week, value: 0 })),
        forecast: [{ week: "2026-08-31", p10: -0.3, p50: 0.1, p90: 0.5 }],
      })
    );
    expect(n.verdict.tone).toBe("neutral");
  });
});

describe("feature labels", () => {
  it("merges week_sin and week_cos into one concept", () => {
    const drivers = resolveDrivers([
      { featureId: "week_sin", weight: 0.3 },
      { featureId: "week_cos", weight: -0.2 },
    ]);
    expect(drivers).toHaveLength(1);
    expect(drivers[0].label).toBe("seasonal timing");
    // Summed by magnitude: signed addition would cancel a real driver.
    expect(drivers[0].weight).toBeCloseTo(0.5);
  });

  it("never lets a raw feature id reach any output string", () => {
    const n = buildNarrative(
      input({
        driverWeights: Object.keys(FEATURE_LABELS).map((featureId, i) => ({
          featureId,
          weight: 1 - i * 0.01,
        })),
      })
    );

    const text = JSON.stringify(n);
    for (const id of Object.keys(FEATURE_LABELS)) {
      // Underscored ids are the tell; label text never contains one.
      if (id.includes("_")) expect(text).not.toContain(id);
    }
  });

  it("drops an unknown feature rather than printing its id", () => {
    const drivers = resolveDrivers([
      { featureId: "some_new_column", weight: 0.9 },
      { featureId: "actor_entropy", weight: 0.2 },
    ]);
    expect(drivers.map((d) => d.label)).toEqual(["how work is spread across people"]);
  });

  it("labels every feature the model can actually return", () => {
    // Guards against the registry drifting behind MODEL_FEATURES; an unlabelled
    // driver silently disappears from the UI, which is quiet but wrong.
    const real = [
      "after_hours_ratio", "weekend_ratio", "median_cycle_time", "median_review_delay",
      "median_response_delay", "oldest_open_task_age", "completion_ratio", "merge_rate",
      "reopen_rate", "actor_entropy", "top_actor_share", "n_active_actors",
      "sentiment_mean", "sentiment_std", "topic_drift", "weeks_since_last_decision",
      "weeks_since_last_event", "is_holiday_week", "is_quarter_end",
      "is_rate_decision_week", "policy_rate", "inflation_rate", "fx_volatility",
      "observed", "week_sin", "week_cos",
    ];
    const missing = real.filter((id) => featureLabel(id) === null);
    expect(missing).toEqual([]);
  });
});

describe("anchor", () => {
  const observed = [
    { week: "2026-05-04", value: 0.1 },
    { week: "2026-05-11", value: 0.9 },
  ];

  it("anchors to a genuinely similar week", () => {
    expect(nearestWeek(observed, 0.95)?.weekISO).toBe("2026-05-11");
  });

  it("omits the anchor when nothing is close enough", () => {
    // 0.35 is the cut; a week merely closest out of a bad set is not an anchor.
    expect(nearestWeek(observed, 5)).toBeNull();
    expect(nearestWeek(observed, 0.9 + 0.36)).toBeNull();
  });

  it("includes the anchor clause only when one exists", () => {
    const withAnchor = buildNarrative(
      input({
        observed: [{ week: "2026-06-22", value: 0.9 }],
        forecast: [{ week: "2026-08-31", p10: 0.4, p50: 0.9, p90: 1.4 }],
      })
    );
    expect(withAnchor.sentences.join(" ")).toContain("similar to the week of");

    const withoutAnchor = buildNarrative(
      input({
        observed: [{ week: "2026-06-22", value: -4 }],
        forecast: [{ week: "2026-08-31", p10: 3, p50: 4, p90: 5 }],
      })
    );
    expect(withoutAnchor.sentences.join(" ")).not.toContain("similar to");
    expect(withoutAnchor.anchor).toBeUndefined();
  });
});

describe("momentum", () => {
  it("names a run of three or more accelerating weeks", () => {
    const m = momentumOf([0.1, 0.2, 0.3], "up_bad");
    expect(m.streak).toBe(3);
    expect(m.accelerating).toBe(true);
    expect(m.sentence).toBe("3 straight weeks of rising pressure — speeding up");
  });

  it("calls a flat-magnitude run steady", () => {
    expect(momentumOf([0.2, 0.2, 0.2], "up_bad").sentence).toContain("steady trend");
  });

  it("stays silent below three weeks", () => {
    // Two weeks in one direction is noise; naming it teaches distrust.
    expect(momentumOf([0.2, 0.3], "up_bad").sentence).toBeNull();
    expect(momentumOf([], "up_bad").sentence).toBeNull();
  });

  it("reads a falling good metric as rising pressure", () => {
    const m = momentumOf([-0.1, -0.2, -0.3], "up_good");
    expect(m.sentence).toContain("rising pressure");
  });

  it("computes weekly deltas", () => {
    expect(weeklyDeltas([1, 1.5, 1.2])).toEqual([0.5, -0.30000000000000004]);
  });
});

describe("caveats", () => {
  it("fires the cold-start caveat below the minimum history", () => {
    const n = buildNarrative(input({ weeksObserved: 7, minWeeksRequired: 12 }));
    expect(n.sentences.join(" ")).toContain("only 7 weeks of history");
  });

  it("stays silent at exactly the minimum", () => {
    const n = buildNarrative(input({ weeksObserved: 12, minWeeksRequired: 12 }));
    expect(n.sentences.join(" ")).not.toContain("early read");
  });

  it("adds the drift caveat on alarm", () => {
    const n = buildNarrative(input({ driftAlarm: true }));
    expect(n.sentences.join(" ")).toContain("stale model");
  });
});

describe("word budget", () => {
  it("keeps S1–S3 within 60 words across threshold combinations", () => {
    for (const p50 of [0, 0.3, 0.9, 2.0, -2.0]) {
      for (const width of [0.5, 1.5, 3.0]) {
        for (const signalId of ["burnout_risk", "delivery_velocity"]) {
          const n = buildNarrative(
            input({
              signalId,
              observed: WEEKS.map((week) => ({ week, value: 0 })),
              forecast: [
                { week: "2026-08-31", p10: p50 - width / 2, p50, p90: p50 + width / 2 },
              ],
            })
          );
          // S1 is the verdict; S2 and S3 are the first two sentences.
          const budget = [n.verdict.text, ...n.sentences.slice(0, 2)];
          expect(wordCount(budget)).toBeLessThanOrEqual(60);
        }
      }
    }
  });
});

describe("degraded input", () => {
  it("does not throw on an empty forecast", () => {
    const n = buildNarrative(input({ forecast: [], observed: [] }));
    expect(n.verdict.text).toContain("holding steady");
    expect(n.facts.horizonWeek).toBeNull();
  });

  it("omits the accuracy tile when there is no calibration", () => {
    expect(buildNarrative(input()).kpis.accuracy).toBeUndefined();
  });

  it("includes the accuracy tile when calibration exists", () => {
    const n = buildNarrative(input({ calibration: { coverage: 0.78, window: 12 } }));
    expect(n.kpis.accuracy).toBe("78%");
  });
});

describe("shared fragments", () => {
  it("builds the row summary from the same phrases as the verdict", () => {
    expect(microSummary("burnout_risk", 1.0)).toBe(
      "clearly rising · a tough week above normal"
    );
  });

  it("explains sigma in the tooltip", () => {
    expect(sigmaTooltip("burnout_risk", 1.0)).toBe(
      "+1.00σ ≈ about one tough week above its normal for this team"
    );
  });
});

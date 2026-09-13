import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/get-session";
import { writeBrainBlock } from "@/lib/interactive/pageMutation";
import type { BrainBlockDraft } from "@/lib/interactive/types";
import {
  bandWidth,
  formatSigma,
  medianChange,
  TARGET_META,
  type Forecast,
  type ForecastTargetKey,
} from "@/lib/forecast/types";

export const runtime = "nodejs";

const FORECAST_URL = process.env.FORECAST_BACKEND_URL || "http://localhost:8100";

/**
 * POST /api/forecasts/write-to-brain  { target }
 *
 * Records a forecast on the Brain page as a `forecast` block.
 *
 * The block is written from the stored numbers, not from a model summarising
 * them — a forecast is quantitative, and paraphrasing it through a language
 * model would introduce drift between what the Brain says and what the engine
 * predicted. This also means it works with no LLM credit at all.
 */
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  let body: { target?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const target = body.target as ForecastTargetKey | undefined;
  if (!target || !(target in TARGET_META)) {
    return NextResponse.json({ error: "Unknown forecast target" }, { status: 400 });
  }

  let forecast: Forecast;
  try {
    const res = await fetch(`${FORECAST_URL}/api/forecast/${target}`, {
      headers: { "X-Tenant-Id": userId },
      cache: "no-store",
    });
    if (res.status === 404) {
      return NextResponse.json({ error: "No forecast stored for this target" }, { status: 404 });
    }
    if (!res.ok) throw new Error(`forecast service returned ${res.status}`);

    const raw = await res.json();
    forecast = {
      target,
      weeks: raw.weeks ?? [],
      quantiles: {
        "0.1": raw.quantiles?.["0.1"] ?? [],
        "0.5": raw.quantiles?.["0.5"] ?? [],
        "0.9": raw.quantiles?.["0.9"] ?? [],
      },
      lowConfidence: Boolean(raw.low_confidence),
      observedWeeks: raw.observed_weeks ?? 0,
      drivers: raw.drivers ?? [],
      history: raw.history ?? [],
      hasSignal: raw.has_signal !== false,
    };
  } catch {
    return NextResponse.json(
      { error: "The forecasting service is not reachable." },
      { status: 503 }
    );
  }

  if (!forecast.hasSignal) {
    return NextResponse.json(
      {
        error:
          "This signal has no observed data yet, so the forecast is not grounded " +
          "in anything. Connect the source it depends on first.",
      },
      { status: 409 }
    );
  }

  const meta = TARGET_META[target];
  const horizonEnd = forecast.weeks.at(-1) ?? "";
  const p10 = forecast.quantiles["0.1"].at(-1) ?? 0;
  const p50 = forecast.quantiles["0.5"].at(-1) ?? 0;
  const p90 = forecast.quantiles["0.9"].at(-1) ?? 0;
  const change = medianChange(forecast);

  const direction =
    Math.abs(change) < 0.05 ? "holds flat" : change > 0 ? "rises" : "falls";
  const reading =
    Math.abs(change) < 0.05
      ? "no material movement expected"
      : (change > 0) === meta.higherIsWorse
        ? "moving in the wrong direction"
        : "moving in the right direction";

  const drivers = forecast.drivers
    .slice(0, 5)
    .map((d) => `| ${d.feature.replace(/_/g, " ")} | ${d.weight.toFixed(4)} |`)
    .join("\n");

  const body_md =
    `**${meta.label}** ${direction} by ${formatSigma(change)} over the next ` +
    `${forecast.weeks.length} weeks — ${reading}.\n\n` +
    `## Range at ${horizonEnd}\n\n` +
    `| Scenario | Value |\n| --- | --- |\n` +
    `| Bull (P90) | ${formatSigma(p90)} |\n` +
    `| Base (P50) | ${formatSigma(p50)} |\n` +
    `| Bear (P10) | ${formatSigma(p10)} |\n\n` +
    (drivers ? `## What drove it\n\n| Signal | Weight |\n| --- | --- |\n${drivers}\n\n` : "") +
    `_Values are standard deviations from this company's own weekly baseline. ` +
    `Band width ${bandWidth(forecast).toFixed(2)}σ across ${forecast.observedWeeks} ` +
    `weeks of history._` +
    (forecast.lowConfidence
      ? `\n\n> Low confidence: fewer than 12 observed weeks, so this leans on ` +
        `industry and geography priors rather than your own history.`
      : "");

  const draft: BrainBlockDraft = {
    type: "forecast",
    title: `${meta.label} forecast — ${direction} ${formatSigma(change)} by ${horizonEnd}`,
    body: body_md,
    data: {
      target,
      horizon_weeks: forecast.weeks.length,
      weeks: forecast.weeks,
      quantiles: forecast.quantiles,
      median_change: change,
      band_width: bandWidth(forecast),
      observed_weeks: forecast.observedWeeks,
      low_confidence: forecast.lowConfidence,
      drivers: forecast.drivers,
    },
    // A wide band is the model saying it is unsure; the block's confidence
    // should say the same rather than presenting every forecast as equally firm.
    confidence: forecast.lowConfidence ? 0.5 : 0.8,
    createdBy: "ai",
    sourceRefs: [{ kind: "forecast", target, model: "CoBrainTFT", horizon: forecast.weeks.length }],
  };

  const block = await writeBrainBlock(userId, draft);

  return NextResponse.json({
    success: true,
    block: { id: block.id, title: block.title, status: block.status, type: block.type },
  });
}

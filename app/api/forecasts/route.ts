import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/get-session";
import {
  FORECAST_TARGETS,
  type Forecast,
  type ForecastBundle,
  type ForecastTargetKey,
} from "@/lib/forecast/types";

export const runtime = "nodejs";

const FORECAST_URL = process.env.FORECAST_BACKEND_URL || "http://localhost:8100";

type PythonForecast = {
  target: string;
  weeks: string[];
  quantiles: Record<string, number[]>;
  low_confidence: boolean;
  observed_weeks: number;
  drivers: { feature: string; weight: number }[];
  history?: { week: string; value: number }[];
  has_signal?: boolean;
};

function normalise(raw: PythonForecast): Forecast {
  return {
    target: raw.target as ForecastTargetKey,
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
}

/**
 * GET /api/forecasts
 *
 * Reads the tenant's stored forecasts from the Python forecasting service.
 *
 * The service is a separate process that needs both built features and a
 * trained checkpoint, so "not reachable" and "not trained yet" are ordinary
 * states rather than errors — the page renders an explanation for each instead
 * of an empty chart that looks like a flat forecast of zero.
 */
export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const requested = searchParams.getAll("target");
  const targets = (requested.length
    ? requested.filter((t): t is ForecastTargetKey =>
        (FORECAST_TARGETS as readonly string[]).includes(t)
      )
    : FORECAST_TARGETS) as readonly ForecastTargetKey[];

  const forecasts: Forecast[] = [];
  let unreachable = false;

  for (const target of targets) {
    try {
      const res = await fetch(`${FORECAST_URL}/api/forecast/${target}`, {
        headers: { "X-Tenant-Id": userId },
        cache: "no-store",
      });
      if (res.status === 404) continue;
      if (!res.ok) {
        unreachable = true;
        break;
      }
      forecasts.push(normalise((await res.json()) as PythonForecast));
    } catch {
      unreachable = true;
      break;
    }
  }

  if (unreachable) {
    return NextResponse.json(
      {
        error: "The forecasting service is not reachable.",
        hint: "Start it with: python -m m_learning.inference.serve",
        forecasts: [],
      },
      { status: 503 }
    );
  }

  const bundle: ForecastBundle = {
    tenantId: userId,
    generatedAt: new Date().toISOString(),
    modelVersion: null,
    forecasts,
  };

  return NextResponse.json(bundle);
}

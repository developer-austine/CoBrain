import React from "react";
import { headers } from "next/headers";
import { ForecastsClient } from "./_components/ForecastsClient";
import type { ForecastBundle } from "@/lib/forecast/types";

export const dynamic = "force-dynamic";

async function loadBundle(): Promise<{
  bundle: ForecastBundle | null;
  error?: string;
  hint?: string;
}> {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";

  try {
    const res = await fetch(`${proto}://${host}/api/forecasts`, {
      headers: { cookie: h.get("cookie") ?? "" },
      cache: "no-store",
    });
    const data = await res.json();

    if (!res.ok) {
      return { bundle: null, error: data.error, hint: data.hint };
    }
    return { bundle: data as ForecastBundle };
  } catch {
    return { bundle: null, error: "Could not load forecasts." };
  }
}

export default async function ForecastsPage() {
  const { bundle, error, hint } = await loadBundle();

  return (
    <div className="flex flex-col gap-3" style={{ background: "var(--bg-page)" }}>
      {/* Same padded column as the client below, so the heading lines up with
          the cards instead of sitting against the sidenav. */}
      <div className="mx-auto w-full min-w-0 max-w-[1400px] px-4 pt-1 sm:px-6">
        <h1 className="text-[18px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Forecasts
        </h1>
        <p
          className="mt-0.5 max-w-[70ch] text-[12px]"
          style={{ color: "var(--text-secondary)" }}
        >
          Where your organisation is heading over the next quarter, with an honest
          range rather than a single number.
        </p>
      </div>

      <ForecastsClient bundle={bundle} error={error} hint={hint} />
    </div>
  );
}

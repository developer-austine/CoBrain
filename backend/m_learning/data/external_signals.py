"""Tier 3 time-varying channel (FIX 3): country signal ingest and alignment.

These are KNOWN-FUTURE features. Holidays, quarter ends and scheduled rate
decisions are on the calendar before they happen, which is exactly why they can
be fed for the forecast horizon as well as the lookback.
"""

from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from m_learning.config import CFG
from m_learning.registry.tiers import GEO_TIME_FEATURES

WORLD_BANK = "https://api.worldbank.org/v2/country/{country}/indicator/{indicator}"
NAGER_HOLIDAYS = "https://date.nager.at/api/v3/PublicHolidays/{year}/{country}"

INDICATORS = {
    "inflation_rate": "FP.CPI.TOTL.ZG",
    "policy_rate": "FR.INR.RINR",
}

CACHE_DIR = Path(os.getenv("EXTERNAL_SIGNAL_CACHE", "m_learning/.external_cache"))


def _cache_path(name: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / f"{name}.json"


def fetch_world_bank(country: str, indicator: str, timeout: int = 20) -> dict[int, float]:
    """Annual indicator series keyed by year. Cached; network failure returns cache or {}."""
    cache = _cache_path(f"wb_{country}_{indicator}")
    try:
        res = requests.get(
            WORLD_BANK.format(country=country, indicator=indicator),
            params={"format": "json", "per_page": 200},
            timeout=timeout,
        )
        res.raise_for_status()
        payload = res.json()
        rows = payload[1] if isinstance(payload, list) and len(payload) > 1 else []
        series = {
            int(r["date"]): float(r["value"])
            for r in rows
            if r.get("value") is not None and str(r.get("date", "")).isdigit()
        }
        cache.write_text(json.dumps(series), encoding="utf-8")
        return series
    except Exception:
        if cache.exists():
            return {int(k): v for k, v in json.loads(cache.read_text(encoding="utf-8")).items()}
        return {}


def fetch_holidays(country: str, year: int, timeout: int = 20) -> list[date]:
    cache = _cache_path(f"holidays_{country}_{year}")
    try:
        res = requests.get(NAGER_HOLIDAYS.format(year=year, country=country), timeout=timeout)
        res.raise_for_status()
        days = [str(h["date"]) for h in res.json()]
        cache.write_text(json.dumps(days), encoding="utf-8")
    except Exception:
        if not cache.exists():
            return []
        days = json.loads(cache.read_text(encoding="utf-8"))
    return [date.fromisoformat(d) for d in days]


def build_geo_frame(country: str, index: pd.DatetimeIndex) -> pd.DataFrame:
    """Align country signals onto a tenant's weekly grid.

    Annual macro series are held flat across the year rather than interpolated:
    inflation is published as one number per year and inventing a smooth weekly
    path would manufacture precision the source does not have.
    """
    out = pd.DataFrame(index=index, columns=GEO_TIME_FEATURES, dtype=float).fillna(0.0)
    if len(index) == 0:
        return out

    years = sorted({d.year for d in index})

    for feature, indicator in INDICATORS.items():
        series = fetch_world_bank(country, indicator)
        if not series:
            continue
        latest = max(series)
        out[feature] = [series.get(d.year, series.get(latest, 0.0)) for d in index]

    holidays = set()
    for year in years:
        holidays.update(fetch_holidays(country, year))

    week_start = pd.DatetimeIndex(index).tz_localize(None) if index.tz else pd.DatetimeIndex(index)
    out["is_holiday_week"] = [
        1.0 if any(w.date() <= h <= (w + pd.Timedelta(days=6)).date() for h in holidays) else 0.0
        for w in week_start
    ]
    out["is_quarter_end"] = [
        1.0 if (w + pd.Timedelta(days=6)).month in (3, 6, 9, 12)
        and (w + pd.Timedelta(days=6)).is_quarter_end
        else 0.0
        for w in week_start
    ]

    # FX volatility needs a daily series; left at zero until a source is wired,
    # so the column exists and the model input width never changes.
    out["fx_volatility"] = out["fx_volatility"].astype(float)
    out["is_rate_decision_week"] = out["is_rate_decision_week"].astype(float)

    return out.fillna(0.0)


def attach_geo_features(df: pd.DataFrame, country: str) -> pd.DataFrame:
    geo = build_geo_frame(country, pd.DatetimeIndex(df.index))
    out = df.copy()
    for column in GEO_TIME_FEATURES:
        out[column] = geo[column].to_numpy()
    return out

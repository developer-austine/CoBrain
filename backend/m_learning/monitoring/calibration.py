"""Forecast calibration — is the model still honest? (Scaling module A4, signal 1)

For every forecast whose target week has elapsed, check whether the true value
fell inside the P10-P90 band. Expected coverage is about 0.80.

Both directions are drift. Under-coverage means the bands are too tight and the
model is overconfident; over-coverage means they are so wide the forecast says
nothing. A model quietly widening its bands to avoid being wrong is still a
model that has stopped being useful.
"""

from __future__ import annotations

COVERAGE_TARGET = 0.80
COVERAGE_FLOOR = 0.65
COVERAGE_CEILING = 0.95


def coverage(forecasts, actuals):
    """
    forecasts: list of dicts {week, p10, p50, p90} already elapsed
    actuals:   {week: true_value}
    returns fraction of weeks where p10 <= actual <= p90
    """
    hits, n = 0, 0
    for f in forecasts:
        y = actuals.get(f["week"])
        if y is None:
            continue
        n += 1
        if f["p10"] <= y <= f["p90"]:
            hits += 1
    return (hits / n) if n else None


def classify_coverage(value: float | None) -> str:
    """"ok" | "drifting" | "alarm" for a coverage reading."""
    if value is None:
        return "ok"
    if value < COVERAGE_FLOOR or value > COVERAGE_CEILING:
        return "alarm"
    # Outside a comfortable margin of the target but not yet alarming.
    if abs(value - COVERAGE_TARGET) > 0.08:
        return "drifting"
    return "ok"


def trailing_coverage(forecasts, actuals, weeks: int = 12):
    """Coverage over the most recent `weeks` elapsed forecasts.

    Trailing rather than lifetime: a model that was well calibrated for a year
    and broke last month should read as broken, not as fine on average.
    """
    elapsed = [f for f in forecasts if f["week"] in actuals]
    elapsed.sort(key=lambda f: f["week"])
    return coverage(elapsed[-weeks:], actuals)

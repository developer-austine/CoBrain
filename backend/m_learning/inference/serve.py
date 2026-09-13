"""Namespace-scoped forecast API.

The caller's tenant_id must match the requested namespace (Section 10). The
check is in the request path, not in a middleware someone can forget to attach.
"""

from __future__ import annotations

import os

import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from m_learning.config import CFG
from m_learning.data.normalizer import TenantNormalizer
from m_learning.inference.predictor import Predictor
from m_learning.registry.covariates import TenantProfile
from m_learning.registry.tiers import FORECAST_TARGETS
from m_learning.storage.feature_store import FeatureStore, TenantIsolationError
from m_learning.storage.forecast_store import ForecastStore


class ForecastRequest(BaseModel):
    tenant_id: str
    target: str = "delivery_velocity"
    industry: str = "unknown"
    country: str = "unknown"
    size_band: str = "unknown"
    currency: str = "unknown"


def require_caller(x_tenant_id: str | None = Header(default=None)) -> str:
    if not x_tenant_id:
        raise HTTPException(status_code=401, detail="X-Tenant-Id header is required")
    return x_tenant_id


def create_app(
    predictor: Predictor | None = None,
    feature_store: FeatureStore | None = None,
    forecast_store: ForecastStore | None = None,
) -> FastAPI:
    app = FastAPI(title="CoBrain Forecasting")
    features = feature_store or FeatureStore()
    forecasts = forecast_store or ForecastStore()
    # One predictor per target: each target has its own checkpoint, so they
    # cannot share a loaded model.
    _predictors: dict[str, Predictor] = {}

    def get_predictor(target: str) -> Predictor:
        if predictor is not None:
            return predictor
        if target not in _predictors:
            _predictors[target] = Predictor(target=target)
        return _predictors[target]

    @app.get("/api/forecast/targets")
    def targets():
        return {
            "targets": [
                {"key": t.key, "label": t.label, "description": t.description}
                for t in FORECAST_TARGETS.values()
            ]
        }

    @app.post("/api/forecast")
    def forecast(req: ForecastRequest, caller: str = Depends(require_caller)):
        if caller != req.tenant_id:
            raise HTTPException(status_code=403, detail="Tenant mismatch")
        if req.target not in FORECAST_TARGETS:
            raise HTTPException(status_code=400, detail=f"Unknown target: {req.target}")

        try:
            frame = features.read(req.tenant_id)
        except TenantIsolationError as e:
            raise HTTPException(status_code=403, detail=str(e))

        if frame.empty:
            raise HTTPException(status_code=404, detail="No features for this tenant")

        normalised = TenantNormalizer().fit(frame, frame.index[-1]).transform(frame)
        profile = TenantProfile(
            tenant_id=req.tenant_id,
            industry=req.industry,
            country=req.country,
            size_band=req.size_band,
            currency=req.currency,
        )

        try:
            engine = get_predictor(req.target)
        except FileNotFoundError as e:
            raise HTTPException(status_code=503, detail=str(e))

        result = engine.predict(req.tenant_id, normalised, profile, req.target)
        forecasts.write(req.tenant_id, req.target, result.to_dict())
        return result.to_dict()

    @app.get("/api/forecast/{target}")
    def latest(target: str, caller: str = Depends(require_caller)):
        record = forecasts.read(caller, target)
        if record is None:
            raise HTTPException(status_code=404, detail="No forecast stored")
        return record

    return app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(create_app(), host="0.0.0.0", port=int(os.getenv("FORECAST_PORT", "8100")))

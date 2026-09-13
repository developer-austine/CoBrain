"""Load checkpoint, run forecast."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import torch

from m_learning.config import CFG
from m_learning.data.dataset import to_matrix
from m_learning.models.tft import CoBrainTFT
from m_learning.registry.covariates import VOCAB_SIZES, TenantProfile, encode_profile
from m_learning.registry.tiers import MODEL_FEATURES, N_FEATURES
from m_learning.storage.model_registry import ModelRegistry


@dataclass
class Forecast:
    tenant_id: str
    target: str
    quantiles: dict[str, list[float]]
    weeks: list[str]
    low_confidence: bool
    observed_weeks: int
    drivers: list[dict]
    history: list[dict]
    has_signal: bool

    def to_dict(self) -> dict:
        return {
            "tenant_id": self.tenant_id,
            "target": self.target,
            "quantiles": self.quantiles,
            "weeks": self.weeks,
            "low_confidence": self.low_confidence,
            "observed_weeks": self.observed_weeks,
            "drivers": self.drivers,
            "history": self.history,
            "has_signal": self.has_signal,
        }


class Predictor:
    def __init__(
        self,
        target: str = "default",
        version: str | None = None,
        registry: ModelRegistry | None = None,
        cfg=CFG,
    ):
        self.cfg = cfg
        self.target = target
        self.registry = registry or ModelRegistry()
        self.model = CoBrainTFT(N_FEATURES, VOCAB_SIZES, cfg)
        self.meta = self.registry.load(self.model, version, target=target)
        self.model.eval()

    def _window(self, frame: pd.DataFrame) -> np.ndarray:
        matrix = to_matrix(frame)
        need = self.cfg.ENCODER_LENGTH

        # A short series is left-padded with zeros rather than rejected: a new
        # tenant must still get a forecast, leaning on static priors, and the
        # low_confidence flag carries the caveat (Section 10, cold start).
        if len(matrix) >= need:
            return matrix[-need:]
        pad = np.zeros((need - len(matrix), N_FEATURES), dtype=np.float32)
        return np.vstack([pad, matrix])

    def predict(self, tenant_id: str, frame: pd.DataFrame, profile: TenantProfile, target: str) -> Forecast:
        window = self._window(frame)
        static = encode_profile(profile)

        batch = {
            "x": torch.from_numpy(window).unsqueeze(0),
            "static_ids": {k: torch.tensor([v], dtype=torch.long) for k, v in static.items()},
        }

        with torch.no_grad():
            out = self.model(batch)

        quantiles = _monotonic_quantiles(
            {q: out["quantiles"][q].squeeze(0).numpy() for q in self.cfg.QUANTILES}
        )

        observed = int(frame["observed"].sum()) if "observed" in frame else len(frame)
        last_week = pd.Timestamp(frame.index[-1]) if len(frame) else pd.Timestamp.utcnow()
        weeks = [
            (last_week + pd.Timedelta(weeks=i + 1)).date().isoformat()
            for i in range(self.cfg.HORIZON)
        ]

        return Forecast(
            tenant_id=tenant_id,
            target=target,
            quantiles=quantiles,
            weeks=weeks,
            low_confidence=observed < self.cfg.MIN_WEEKS_REQUIRED,
            observed_weeks=observed,
            drivers=self._drivers(out["var_weights"]),
            history=self._history(frame, target),
            has_signal=self._has_signal(frame, target),
        )

    def _has_signal(self, frame: pd.DataFrame, target: str) -> bool:
        """Does this target's source feature actually vary in the tenant's data?

        A connector that was never linked leaves its column absent or flat at
        zero. The model will still emit a forecast for it, and that forecast is
        indistinguishable on screen from one built on real history — so the
        caller has to be told which is which.
        """
        from m_learning.registry.tiers import FORECAST_TARGETS

        column = FORECAST_TARGETS[target].source_feature
        if column not in frame.columns:
            return False
        values = frame[column].to_numpy(dtype=float)
        return bool(np.isfinite(values).any() and np.nanstd(values) > 1e-9)

    def _history(self, frame: pd.DataFrame, target: str, weeks: int = 26) -> list[dict]:
        """Recent observed values of the target, for chart context."""
        from m_learning.registry.tiers import FORECAST_TARGETS

        column = FORECAST_TARGETS[target].source_feature
        if column not in frame.columns:
            return []

        tail = frame.tail(weeks)
        return [
            {"week": pd.Timestamp(idx).date().isoformat(), "value": float(value)}
            for idx, value in zip(tail.index, tail[column].to_numpy())
        ]

    def _drivers(self, var_weights: torch.Tensor, top: int = 8) -> list[dict]:
        """Which variables drove the forecast, averaged over the lookback."""
        mean = var_weights.squeeze(0).mean(dim=0)
        values, indices = torch.topk(mean, k=min(top, mean.numel()))
        return [
            {"feature": MODEL_FEATURES[i], "weight": round(float(v), 5)}
            for v, i in zip(values.tolist(), indices.tolist())
        ]


def _monotonic_quantiles(raw: dict[float, np.ndarray]) -> dict[str, list[float]]:
    """Enforce P10 <= P50 <= P90 at every horizon step.

    The heads are independent linear layers, so nothing in the architecture stops
    them crossing — and they do, most often early in training or where the band
    is narrow. A crossed band is not a wide forecast, it is an impossible one:
    it would render as an inverted ribbon and put the "bear" case above the
    "bull" case in the table.

    Sorting the predictions across quantile levels is the standard rearrangement
    fix (Chernozhukov et al.); it never increases pinball loss, because any
    crossed pair costs at least as much as its sorted counterpart.
    """
    levels = sorted(raw)
    stacked = np.stack([np.asarray(raw[q], dtype=float) for q in levels])
    stacked.sort(axis=0)
    return {str(q): stacked[i].tolist() for i, q in enumerate(levels)}

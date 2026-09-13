"""torch Dataset producing model tensors.

Batches mix MANY tenants — that is what produces cross-tenant learning
(Section 9). Each sample carries its own static ids, so one global model stays
conditioned per tenant.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset

from m_learning.config import CFG
from m_learning.registry.covariates import TenantProfile, encode_profile
from m_learning.registry.tiers import MODEL_FEATURES, N_FEATURES, target_index
from m_learning.training.rolling_window import make_windows


@dataclass
class TenantSeries:
    tenant_id: str
    frame: pd.DataFrame
    profile: TenantProfile


def to_matrix(df: pd.DataFrame) -> np.ndarray:
    """Frame -> [T, F] in MODEL_FEATURES order, missing columns zero-filled."""
    out = np.zeros((len(df), N_FEATURES), dtype=np.float32)
    for i, name in enumerate(MODEL_FEATURES):
        if name in df.columns:
            out[:, i] = pd.to_numeric(df[name], errors="coerce").fillna(0.0).to_numpy(dtype=np.float32)
    return out


class ForecastDataset(Dataset):
    def __init__(
        self,
        series: list[TenantSeries],
        target: str = "delivery_velocity",
        encoder_length: int = CFG.ENCODER_LENGTH,
        horizon: int = CFG.HORIZON,
    ):
        self.target_col = target_index(target)
        self.encoder_length = encoder_length
        self.horizon = horizon
        self.samples: list[tuple[np.ndarray, np.ndarray, dict[str, int], str]] = []

        for s in series:
            matrix = to_matrix(s.frame)
            static = encode_profile(s.profile)
            for x, y in make_windows(matrix, encoder_length, horizon):
                self.samples.append((x, y[:, self.target_col], static, s.tenant_id))

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int):
        x, y, static, tenant_id = self.samples[index]
        return {
            "x": torch.from_numpy(np.ascontiguousarray(x)),
            "y": torch.from_numpy(np.ascontiguousarray(y)),
            "static_ids": {k: torch.tensor(v, dtype=torch.long) for k, v in static.items()},
            "tenant_id": tenant_id,
        }


def collate(batch: list[dict]) -> dict:
    keys = batch[0]["static_ids"].keys()
    return {
        "x": torch.stack([b["x"] for b in batch]),
        "y": torch.stack([b["y"] for b in batch]),
        "static_ids": {k: torch.stack([b["static_ids"][k] for b in batch]) for k in keys},
        "tenant_ids": [b["tenant_id"] for b in batch],
    }

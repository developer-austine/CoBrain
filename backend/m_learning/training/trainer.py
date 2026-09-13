"""Train loop, validation, checkpointing.

Validation split is TEMPORAL, never random: a random split puts future weeks in
the training set and makes the backtest meaningless.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import torch
from torch.optim import AdamW
from torch.optim.lr_scheduler import ReduceLROnPlateau
from torch.utils.data import DataLoader

from m_learning.config import CFG
from m_learning.data.dataset import ForecastDataset, TenantSeries, collate
from m_learning.storage.model_registry import ModelRegistry
from m_learning.training.losses import per_quantile_loss, quantile_loss

logger = logging.getLogger(__name__)


@dataclass
class EpochReport:
    epoch: int
    train_loss: float
    val_loss: float
    per_quantile: dict = field(default_factory=dict)


def temporal_split(
    series: list[TenantSeries], holdout_weeks: int
) -> tuple[list[TenantSeries], list[TenantSeries]]:
    """Hold out the LAST `holdout_weeks` of every tenant's series."""
    train, val = [], []
    for s in series:
        if len(s.frame) <= holdout_weeks:
            train.append(s)
            continue
        train.append(TenantSeries(s.tenant_id, s.frame.iloc[:-holdout_weeks], s.profile))
        val.append(TenantSeries(s.tenant_id, s.frame.iloc[-(holdout_weeks + CFG.ENCODER_LENGTH):], s.profile))
    return train, val


class Trainer:
    def __init__(
        self,
        model: torch.nn.Module,
        cfg=CFG,
        device: str | None = None,
        registry: ModelRegistry | None = None,
    ):
        self.cfg = cfg
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.model = model.to(self.device)
        self.optimizer = AdamW(self.model.parameters(), lr=cfg.LR)
        self.scheduler = ReduceLROnPlateau(self.optimizer, mode="min", patience=max(cfg.PATIENCE // 3, 1))
        self.registry = registry or ModelRegistry()
        self.history: list[EpochReport] = []

    def _to_device(self, batch: dict) -> dict:
        return {
            "x": batch["x"].to(self.device),
            "y": batch["y"].to(self.device),
            "static_ids": {k: v.to(self.device) for k, v in batch["static_ids"].items()},
        }

    def _run_epoch(self, loader: DataLoader, train: bool) -> tuple[float, dict]:
        self.model.train(train)
        total, batches = 0.0, 0
        quantile_totals: dict = {}

        for raw in loader:
            batch = self._to_device(raw)
            with torch.set_grad_enabled(train):
                out = self.model(batch)
                loss = quantile_loss(out["quantiles"], batch["y"])

            if train:
                self.optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), self.cfg.GRAD_CLIP)
                self.optimizer.step()

            total += loss.item()
            batches += 1
            for q, value in per_quantile_loss(out["quantiles"], batch["y"]).items():
                quantile_totals[q] = quantile_totals.get(q, 0.0) + value

        if batches == 0:
            return float("nan"), {}
        return total / batches, {q: v / batches for q, v in quantile_totals.items()}

    def fit(
        self,
        series: list[TenantSeries],
        target: str = "delivery_velocity",
        holdout_weeks: int | None = None,
        max_epochs: int | None = None,
    ) -> list[EpochReport]:
        holdout_weeks = holdout_weeks or self.cfg.HORIZON
        max_epochs = max_epochs or self.cfg.MAX_EPOCHS

        train_series, val_series = temporal_split(series, holdout_weeks)
        train_set = ForecastDataset(train_series, target=target)
        val_set = ForecastDataset(val_series, target=target)

        if len(train_set) == 0:
            raise ValueError("No training windows — tenants need more history than encoder+horizon")

        # Shuffling mixes tenants within a batch, which is what produces
        # cross-tenant learning (Section 9).
        train_loader = DataLoader(
            train_set, batch_size=self.cfg.BATCH_SIZE, shuffle=True, collate_fn=collate
        )
        val_loader = (
            DataLoader(val_set, batch_size=self.cfg.BATCH_SIZE, shuffle=False, collate_fn=collate)
            if len(val_set)
            else None
        )

        best = float("inf")
        stale = 0

        for epoch in range(1, max_epochs + 1):
            train_loss, _ = self._run_epoch(train_loader, train=True)

            if val_loader is not None:
                val_loss, per_q = self._run_epoch(val_loader, train=False)
            else:
                val_loss, per_q = train_loss, {}

            self.scheduler.step(val_loss)
            report = EpochReport(epoch, train_loss, val_loss, per_q)
            self.history.append(report)
            logger.info(
                "[trainer] epoch %d train=%.4f val=%.4f per_quantile=%s",
                epoch, train_loss, val_loss,
                {q: round(v, 4) for q, v in per_q.items()},
            )

            if val_loss < best - 1e-6:
                best = val_loss
                stale = 0
                self.registry.save(
                    self.model,
                    {
                        "epoch": epoch,
                        "val_loss": val_loss,
                        "target": target,
                        "per_quantile": per_q,
                        "tenants": sorted({s.tenant_id for s in series}),
                    },
                )
            else:
                stale += 1
                if stale >= self.cfg.PATIENCE:
                    logger.info("[trainer] early stop at epoch %d", epoch)
                    break

        return self.history

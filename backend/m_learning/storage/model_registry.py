"""Checkpoint versioning.

Model weights are SHARED across tenants (Decision 1), so checkpoints are the one
store that is deliberately NOT namespaced.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import torch

from m_learning.config import CFG


class ModelRegistry:
    def __init__(self, root: str | os.PathLike[str] | None = None):
        self.root = Path(root or CFG.CHECKPOINT_DIR)
        self.root.mkdir(parents=True, exist_ok=True)

    def save(
        self,
        model: torch.nn.Module,
        meta: dict,
        version: str | None = None,
    ) -> Path:
        # Checkpoints are keyed by forecast target. One network predicts one
        # series — the target selects the label column at dataset construction —
        # so a single shared "latest" pointer would serve the burnout model's
        # weights for a velocity request and silently answer the wrong question.
        target = meta.get("target", "default")
        version = version or time.strftime("%Y%m%d-%H%M%S")
        path = self.root / f"{target}-{version}.pt"

        torch.save(
            {
                "version": version,
                "state_dict": model.state_dict(),
                "meta": meta,
            },
            path,
        )
        (self.root / f"latest-{target}.json").write_text(
            json.dumps({"version": version, "target": target, "path": str(path), "meta": meta}, indent=2),
            encoding="utf-8",
        )
        return path

    def latest_version(self, target: str = "default") -> str | None:
        pointer = self.root / f"latest-{target}.json"
        if not pointer.exists():
            return None
        return json.loads(pointer.read_text(encoding="utf-8")).get("version")

    def load(
        self,
        model: torch.nn.Module,
        version: str | None = None,
        target: str = "default",
    ) -> dict:
        version = version or self.latest_version(target)
        if not version:
            raise FileNotFoundError(
                f"No checkpoint trained for target {target!r}. "
                f"Train it: python -m m_learning.training.train --target {target}"
            )

        path = self.root / f"{target}-{version}.pt"
        if not path.exists():
            raise FileNotFoundError(f"No checkpoint {target}-{version} in {self.root}")

        blob = torch.load(path, map_location="cpu", weights_only=False)
        model.load_state_dict(blob["state_dict"])
        return blob.get("meta", {})

    def list_versions(self, target: str | None = None) -> list[str]:
        pattern = f"{target}-*.pt" if target else "*.pt"
        return sorted(p.stem for p in self.root.glob(pattern))

    def trained_targets(self) -> list[str]:
        return sorted(p.stem.removeprefix("latest-") for p in self.root.glob("latest-*.json"))

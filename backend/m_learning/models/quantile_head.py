import torch
import torch.nn as nn


class QuantileHead(nn.Module):
    """One linear head per quantile. Uses the LAST timestep — never Flatten."""
    def __init__(self, d_hidden, horizon, quantiles=(0.1, 0.5, 0.9)):
        super().__init__()
        self.quantiles = tuple(quantiles)
        self.heads = nn.ModuleList(
            [nn.Linear(d_hidden, horizon) for _ in self.quantiles]
        )

    def forward(self, h):                      # h: [B, T, d]
        last = h[:, -1, :]                     # FIX 6
        return {q: head(last) for q, head in zip(self.quantiles, self.heads)}

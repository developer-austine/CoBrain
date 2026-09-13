import torch
import torch.nn as nn


class IndustryMask(nn.Module):
    """
    Tier 2. Produces a SOFT feature mask in [0,1] from the industry ID.
    Applied to the ENCODER INPUT (FIX 2), never to its output.
    """
    def __init__(self, n_industries: int, n_features: int, emb_dim: int = 16):
        super().__init__()
        self.embed = nn.Embedding(n_industries, emb_dim)
        self.proj  = nn.Linear(emb_dim, n_features)

    def forward(self, industry_id):          # [B]
        return torch.sigmoid(self.proj(self.embed(industry_id)))  # [B, n_feat]

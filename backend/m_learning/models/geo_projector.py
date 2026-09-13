import torch
import torch.nn as nn
import torch.nn.functional as F


class GeoProjector(nn.Module):
    """
    Tier 3 static half. L2-normalised so no country dominates by magnitude —
    only its learned direction carries information.
    NOTE: the time-varying half (g_t) is NOT here — it is concatenated into the
    encoder input as a known-future channel (FIX 3).
    """
    def __init__(self, n_regions: int, latent: int = 32, emb_dim: int = 16):
        super().__init__()
        self.embed = nn.Embedding(n_regions, emb_dim)
        self.proj  = nn.Linear(emb_dim, latent)

    def forward(self, geo_code):             # [B]
        return F.normalize(self.proj(self.embed(geo_code)), dim=-1)  # [B, latent]

import torch
import torch.nn as nn
from m_learning.config import CFG
from m_learning.models.static_encoder import StaticCovariateEncoder
from m_learning.models.industry_mask import IndustryMask
from m_learning.models.geo_projector import GeoProjector
from m_learning.models.encoder import UniversalEncoder
from m_learning.models.fusion import FusionEngine
from m_learning.models.quantile_head import QuantileHead


class CoBrainTFT(nn.Module):
    def __init__(self, n_features, vocab_sizes, cfg=CFG):
        super().__init__()
        self.static_enc = StaticCovariateEncoder(
            vocab_sizes, cfg.STATIC_EMB, cfg.HIDDEN, cfg.DROPOUT)
        self.industry_mask = IndustryMask(
            vocab_sizes["industry"], n_features, cfg.STATIC_EMB)
        self.geo = GeoProjector(
            vocab_sizes["country"], cfg.GEO_LATENT, cfg.STATIC_EMB)
        self.encoder = UniversalEncoder(
            n_features, cfg.HIDDEN, cfg.ATTN_HEADS, cfg.DROPOUT)
        self.fusion = FusionEngine(
            cfg.HIDDEN, cfg.GEO_LATENT, cfg.HIDDEN, cfg.DROPOUT)
        self.head = QuantileHead(cfg.HIDDEN, cfg.HORIZON, cfg.QUANTILES)

    def forward(self, batch):
        """
        batch:
          x          [B, T, F]  observed + known-future (g_t already concatenated)
          static_ids dict of [B] long tensors: industry, country, size_band,
                     currency
        returns dict with quantile predictions and interpretability weights.
        """
        x = batch["x"]
        sid = batch["static_ids"]

        c_h, c_c, c_sel, c_enrich = self.static_enc(sid)
        m_ind = self.industry_mask(sid["industry"])
        e_geo = self.geo(sid["country"])

        z, var_w, attn_w = self.encoder(x, m_ind, c_h, c_c, c_sel, c_enrich)
        h, alpha = self.fusion(z, e_geo, c_enrich)
        preds = self.head(h)

        return {
            "quantiles": preds,          # {q: [B, horizon]}
            "var_weights": var_w,        # [B, T, F]
            "attn_weights": attn_w,      # [B, T, T]
            "fusion_weights": alpha,     # [B, T, d]
        }

import torch
import torch.nn as nn
from m_learning.models.layers import GRN

# Handling of static covariates is a key part of the TFT model. The static covariates are used to condition the model on tenant identity, which allows the model to learn tenant-specific patterns and improve its predictions. The StaticCovariateEncoder class is responsible for encoding the static covariates into context vectors that can be used by the rest of the model. The context vectors are generated using embedding layers and GRN layers, which allow the model to learn complex relationships between the static covariates and the target variable.


class StaticCovariateEncoder(nn.Module):
    """
    Turns {industry, country, size_band, currency} into FOUR context vectors.
    This is the mechanism that conditions the whole model on tenant identity.
    """
    def __init__(self, vocab_sizes: dict, emb_dim: int, d_hidden: int,
                 dropout: float = 0.1):
        super().__init__()
        self.embeds = nn.ModuleDict({
            k: nn.Embedding(v, emb_dim) for k, v in vocab_sizes.items()
        })
        d_in = emb_dim * len(vocab_sizes)
        self.grn_h      = GRN(d_in, d_hidden, d_hidden, dropout)  # LSTM h0
        self.grn_c      = GRN(d_in, d_hidden, d_hidden, dropout)  # LSTM c0
        self.grn_sel    = GRN(d_in, d_hidden, d_hidden, dropout)  # var selection
        self.grn_enrich = GRN(d_in, d_hidden, d_hidden, dropout)  # attn enrich

    def forward(self, static_ids: dict):
        parts = [self.embeds[k](static_ids[k]) for k in self.embeds]
        s = torch.cat(parts, dim=-1)                              # [B, d_in]
        return (self.grn_h(s), self.grn_c(s),
                self.grn_sel(s), self.grn_enrich(s))

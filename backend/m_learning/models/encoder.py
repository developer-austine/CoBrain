import torch
import torch.nn as nn
from m_learning.models.layers import GRN, VariableSelectionNetwork


class UniversalEncoder(nn.Module):
    """
    Tier 1. LSTM for LOCAL structure, interpretable attention for LONG-RANGE.
    Output z is a PER-TIMESTEP SEQUENCE [B, T, d] (FIX 1).
    """
    def __init__(self, n_features, d_hidden, n_heads=4, dropout=0.2):
        super().__init__()
        self.n_features = n_features
        self.var_embed = nn.Linear(1, d_hidden)
        self.vsn = VariableSelectionNetwork(n_features, d_hidden, dropout,
                                            d_context=d_hidden)
        self.lstm = nn.LSTM(d_hidden, d_hidden, batch_first=True)
        self.gate_norm = nn.LayerNorm(d_hidden)
        self.enrich = GRN(d_hidden, d_hidden, d_hidden, dropout,
                          d_context=d_hidden)
        self.attn = nn.MultiheadAttention(d_hidden, n_heads,
                                          dropout=dropout, batch_first=True)
        self.post_norm = nn.LayerNorm(d_hidden)

    def forward(self, x, m_ind, c_h, c_c, c_sel, c_enrich):
        """
        x       : [B, T, F]  observed + known-future features (g_t already concat)
        m_ind   : [B, F]     industry mask
        c_*     : [B, d]     static context vectors
        returns : z [B,T,d], var_weights [B,T,F], attn_weights [B,T,T]
        """
        B, T, F = x.shape
        assert F == self.n_features, f"expected {self.n_features} features, got {F}"

        # FIX 2 — gate the INPUT
        x = x * m_ind.unsqueeze(1)                       # [B, T, F]

        v = self.var_embed(x.unsqueeze(-1))              # [B, T, F, d]
        sel, var_w = self.vsn(v, c_sel)                  # [B,T,d], [B,T,F]

        h0 = c_h.unsqueeze(0).contiguous()
        c0 = c_c.unsqueeze(0).contiguous()
        lstm_out, _ = self.lstm(sel, (h0, c0))           # FIX 7
        z = self.gate_norm(lstm_out + sel)               # residual + norm

        z = self.enrich(z, c_enrich)                     # static enrichment
        attn_out, attn_w = self.attn(z, z, z, need_weights=True)
        z = self.post_norm(z + attn_out)                 # residual THEN norm

        assert z.shape == (B, T, z.size(-1))             # FIX 1
        return z, var_w, attn_w

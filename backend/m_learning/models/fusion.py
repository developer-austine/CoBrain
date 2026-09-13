import torch
import torch.nn as nn

# I linearlize the input features and then use a variable selection network to select the most relevant features for the task at hand. The selected features are then passed through an LSTM layer to capture the temporal dependencies in the data. The output of the LSTM is then enriched with static context vectors and passed through a multi-head attention mechanism to capture long-range dependencies. Finally, the output is normalized and returned along with the variable weights and attention weights for interpretability.

class FusionEngine(nn.Module):
    """
    Broadcasts static signals across every timestep and fuses.
    Emits TWO outputs: the fused representation AND interpretability weights.
    """
    def __init__(self, d_hidden, geo_dim, static_dim, dropout=0.2):
        super().__init__()
        self.ff = nn.Linear(d_hidden + geo_dim + static_dim, d_hidden)
        self.act = nn.GELU()
        self.drop = nn.Dropout(dropout)
        self.norm = nn.LayerNorm(d_hidden)
        self.interp = nn.Linear(d_hidden, d_hidden)

    def forward(self, z, e_geo, c_static):
        """
        z        : [B, T, d]
        e_geo    : [B, geo_dim]
        c_static : [B, static_dim]
        returns  : h [B,T,d], alpha [B,T,d]
        """
        T = z.size(1)
        eg = e_geo.unsqueeze(1).expand(-1, T, -1)
        cs = c_static.unsqueeze(1).expand(-1, T, -1)
        h = self.drop(self.act(self.ff(torch.cat([z, eg, cs], dim=-1))))
        h = self.norm(z + h)
        alpha = torch.softmax(self.interp(h), dim=-1)
        return h, alpha

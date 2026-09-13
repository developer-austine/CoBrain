import torch
import torch.nn as nn


class GLU(nn.Module):
    """Gated Linear Unit — lets the network suppress components toward zero."""
    def __init__(self, d_in, d_out):
        super().__init__()
        self.fc = nn.Linear(d_in, d_out)
        self.gate = nn.Linear(d_in, d_out)

    def forward(self, x):
        return torch.sigmoid(self.gate(x)) * self.fc(x)


class GRN(nn.Module):
    """
    Gated Residual Network.
    GRN(a) = LayerNorm(a + GLU(W3 * ELU(W4*a + W5*c + b4) + b3))
    Optional context c conditions the transform (used by static enrichment).
    """
    def __init__(self, d_in, d_hidden, d_out, dropout=0.1, d_context=None):
        super().__init__()
        self.skip = nn.Linear(d_in, d_out) if d_in != d_out else nn.Identity()
        self.fc1 = nn.Linear(d_in, d_hidden)
        self.ctx = nn.Linear(d_context, d_hidden, bias=False) if d_context else None
        self.elu = nn.ELU()
        self.fc2 = nn.Linear(d_hidden, d_hidden)
        self.drop = nn.Dropout(dropout)
        self.glu = GLU(d_hidden, d_out)
        self.norm = nn.LayerNorm(d_out)

    def forward(self, a, c=None):
        h = self.fc1(a)
        if self.ctx is not None and c is not None:
            if c.dim() == 2 and h.dim() == 3:
                c = c.unsqueeze(1).expand(-1, h.size(1), -1)
            h = h + self.ctx(c)
        h = self.fc2(self.elu(h))
        h = self.drop(h)
        return self.norm(self.skip(a) + self.glu(h))


class VariableSelectionNetwork(nn.Module):
    """
    Learns which input variables matter, per timestep, conditioned on static ctx.
    Returns the weighted combination AND the selection weights (interpretability).
    """
    def __init__(self, n_vars, d_hidden, dropout=0.1, d_context=None):
        super().__init__()
        self.n_vars = n_vars
        self.flat_grn = GRN(n_vars * d_hidden, d_hidden, n_vars,
                            dropout, d_context)
        self.var_grns = nn.ModuleList(
            [GRN(d_hidden, d_hidden, d_hidden, dropout) for _ in range(n_vars)]
        )

    def forward(self, x, context=None):
        # x: [B, T, n_vars, d_hidden]
        B, T, V, D = x.shape
        flat = x.reshape(B, T, V * D)
        weights = torch.softmax(self.flat_grn(flat, context), dim=-1)  # [B,T,V]
        processed = torch.stack(
            [self.var_grns[i](x[:, :, i, :]) for i in range(V)], dim=2
        )                                                              # [B,T,V,D]
        combined = (processed * weights.unsqueeze(-1)).sum(dim=2)       # [B,T,D]
        return combined, weights

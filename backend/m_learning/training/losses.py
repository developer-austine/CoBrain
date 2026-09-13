import torch


def quantile_loss(preds: dict, target: torch.Tensor) -> torch.Tensor:
    """
    Pinball loss.  QL(y, yhat, q) = q*max(y-yhat,0) + (1-q)*max(yhat-y,0)
    For q=0.9, under-prediction is penalised 9x more than over-prediction,
    which pushes P90 upward until it genuinely covers the high tail.
    preds : {q: [B, H]}   target : [B, H]
    """
    total = 0.0
    for q, yhat in preds.items():
        err = target - yhat
        total = total + torch.max(q * err, (q - 1.0) * err).mean()
    return total


def per_quantile_loss(preds: dict, target: torch.Tensor) -> dict:
    """Same loss, reported per quantile so P10/P90 calibration stays visible."""
    out = {}
    for q, yhat in preds.items():
        err = target - yhat
        out[q] = torch.max(q * err, (q - 1.0) * err).mean().item()
    return out

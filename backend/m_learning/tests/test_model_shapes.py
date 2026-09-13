import numpy as np
import pytest
import torch

from m_learning.config import CFG
from m_learning.models.encoder import UniversalEncoder
from m_learning.models.fusion import FusionEngine
from m_learning.models.geo_projector import GeoProjector
from m_learning.models.industry_mask import IndustryMask
from m_learning.models.layers import GLU, GRN, VariableSelectionNetwork
from m_learning.models.quantile_head import QuantileHead
from m_learning.models.static_encoder import StaticCovariateEncoder
from m_learning.models.tft import CoBrainTFT
from m_learning.registry.covariates import VOCAB_SIZES
from m_learning.registry.tiers import N_FEATURES
from m_learning.training.losses import quantile_loss

B, T, F, D = 4, CFG.ENCODER_LENGTH, N_FEATURES, CFG.HIDDEN


def static_ids(batch=B):
    return {
        "industry": torch.randint(0, VOCAB_SIZES["industry"], (batch,)),
        "country": torch.randint(0, VOCAB_SIZES["country"], (batch,)),
        "size_band": torch.randint(0, VOCAB_SIZES["size_band"], (batch,)),
        "currency": torch.randint(0, VOCAB_SIZES["currency"], (batch,)),
    }


def batch(size=B, steps=T):
    return {"x": torch.randn(size, steps, F), "static_ids": static_ids(size)}


def test_glu_and_grn_shapes():
    assert GLU(8, 16)(torch.randn(B, 8)).shape == (B, 16)
    assert GRN(8, 16, 32)(torch.randn(B, 8)).shape == (B, 32)
    assert GRN(8, 16, 8, d_context=D)(torch.randn(B, T, 8), torch.randn(B, D)).shape == (B, T, 8)


def test_variable_selection_returns_weights_over_variables():
    vsn = VariableSelectionNetwork(F, D, d_context=D)
    combined, weights = vsn(torch.randn(B, T, F, D), torch.randn(B, D))

    assert combined.shape == (B, T, D)
    assert weights.shape == (B, T, F)
    torch.testing.assert_close(weights.sum(-1), torch.ones(B, T), atol=1e-5, rtol=1e-5)


def test_static_encoder_emits_four_context_vectors():
    # FIX 7: without these four the tiers are just extra input columns.
    enc = StaticCovariateEncoder(VOCAB_SIZES, CFG.STATIC_EMB, D)
    c_h, c_c, c_sel, c_enrich = enc(static_ids())

    for c in (c_h, c_c, c_sel, c_enrich):
        assert c.shape == (B, D)


def test_industry_mask_is_a_soft_gate_over_features():
    mask = IndustryMask(VOCAB_SIZES["industry"], F, CFG.STATIC_EMB)
    m = mask(torch.randint(0, VOCAB_SIZES["industry"], (B,)))

    assert m.shape == (B, F)
    assert ((m >= 0) & (m <= 1)).all()


def test_geo_latent_is_l2_normalised():
    geo = GeoProjector(VOCAB_SIZES["country"], CFG.GEO_LATENT, CFG.STATIC_EMB)
    e = geo(torch.randint(0, VOCAB_SIZES["country"], (B,)))

    assert e.shape == (B, CFG.GEO_LATENT)
    torch.testing.assert_close(e.norm(dim=-1), torch.ones(B), atol=1e-5, rtol=1e-5)


def test_encoder_output_is_a_per_timestep_sequence():
    # FIX 1: never pooled or flattened before fusion.
    enc = UniversalEncoder(F, D, CFG.ATTN_HEADS, CFG.DROPOUT)
    z, var_w, attn_w = enc(
        torch.randn(B, T, F), torch.rand(B, F),
        torch.randn(B, D), torch.randn(B, D), torch.randn(B, D), torch.randn(B, D),
    )

    assert z.shape == (B, T, D)
    assert var_w.shape == (B, T, F)
    assert attn_w.shape == (B, T, T)


def test_industry_mask_gates_the_encoder_input_not_its_output():
    # FIX 2: a zero mask must starve the encoder of features, so its output
    # cannot depend on x at all.
    torch.manual_seed(0)
    enc = UniversalEncoder(F, D, CFG.ATTN_HEADS, CFG.DROPOUT).eval()
    ctx = [torch.randn(B, D) for _ in range(4)]
    zero = torch.zeros(B, F)

    with torch.no_grad():
        a, _, _ = enc(torch.randn(B, T, F), zero, *ctx)
        b, _, _ = enc(torch.randn(B, T, F) * 1000, zero, *ctx)

    torch.testing.assert_close(a, b)


def test_static_encoder_initialises_the_lstm_hidden_state():
    # FIX 7 wiring: different static context must change the encoder output
    # even with identical inputs.
    torch.manual_seed(0)
    enc = UniversalEncoder(F, D, CFG.ATTN_HEADS, CFG.DROPOUT).eval()
    x = torch.randn(B, T, F)
    m = torch.ones(B, F)

    with torch.no_grad():
        a, _, _ = enc(x, m, torch.zeros(B, D), torch.zeros(B, D), torch.zeros(B, D), torch.zeros(B, D))
        b, _, _ = enc(x, m, torch.ones(B, D), torch.ones(B, D), torch.zeros(B, D), torch.zeros(B, D))

    assert not torch.allclose(a, b)


def test_fusion_emits_representation_and_interpretability_weights():
    # FIX 5.
    fusion = FusionEngine(D, CFG.GEO_LATENT, D, CFG.DROPOUT)
    h, alpha = fusion(torch.randn(B, T, D), torch.randn(B, CFG.GEO_LATENT), torch.randn(B, D))

    assert h.shape == (B, T, D)
    assert alpha.shape == (B, T, D)


def test_quantile_head_uses_the_last_timestep_not_a_flatten():
    # FIX 6: parameter count must not scale with sequence length.
    head = QuantileHead(D, CFG.HORIZON, CFG.QUANTILES)
    preds = head(torch.randn(B, T, D))

    assert set(preds) == set(CFG.QUANTILES)
    for q in CFG.QUANTILES:
        assert preds[q].shape == (B, CFG.HORIZON)

    params = sum(p.numel() for p in head.parameters())
    assert params == len(CFG.QUANTILES) * (D * CFG.HORIZON + CFG.HORIZON)


def test_quantile_head_accepts_any_sequence_length():
    head = QuantileHead(D, CFG.HORIZON, CFG.QUANTILES)
    for steps in (8, 52, 104):
        preds = head(torch.randn(B, steps, D))
        assert preds[0.5].shape == (B, CFG.HORIZON)


def test_full_model_forward_shapes():
    model = CoBrainTFT(F, VOCAB_SIZES)
    out = model(batch())

    assert set(out) == {"quantiles", "var_weights", "attn_weights", "fusion_weights"}
    for q in CFG.QUANTILES:
        assert out["quantiles"][q].shape == (B, CFG.HORIZON)
    assert out["var_weights"].shape == (B, T, F)
    assert out["attn_weights"].shape == (B, T, T)
    assert out["fusion_weights"].shape == (B, T, D)


def test_model_is_sequence_length_agnostic():
    model = CoBrainTFT(F, VOCAB_SIZES)
    out = model(batch(steps=26))
    assert out["quantiles"][0.5].shape == (B, CFG.HORIZON)


def test_quantile_loss_penalises_asymmetrically():
    # P90 under-prediction must cost 9x an over-prediction of equal size.
    target = torch.zeros(1, 1)
    under = quantile_loss({0.9: torch.full((1, 1), -1.0)}, target)
    over = quantile_loss({0.9: torch.full((1, 1), 1.0)}, target)

    assert under.item() == pytest.approx(9 * over.item(), rel=1e-5)


def test_gradients_reach_every_component_on_the_prediction_path():
    model = CoBrainTFT(F, VOCAB_SIZES)
    out = model(batch())
    quantile_loss(out["quantiles"], torch.randn(B, CFG.HORIZON)).backward()

    missing = [
        n
        for n, p in model.named_parameters()
        if p.requires_grad and p.grad is None and not n.startswith("fusion.interp")
    ]
    assert missing == []


def test_interpretability_head_is_auxiliary_and_receives_no_gradient():
    # fusion.interp produces `fusion_weights` (FIX 5), which are an explanation
    # output rather than a prediction input, so the quantile loss never reaches
    # it. Asserted rather than assumed: if a future loss term starts training
    # this head, that is a design change and should fail here first.
    model = CoBrainTFT(F, VOCAB_SIZES)
    out = model(batch())
    quantile_loss(out["quantiles"], torch.randn(B, CFG.HORIZON)).backward()

    assert model.fusion.interp.weight.grad is None
    assert model.fusion.interp.bias.grad is None


def test_quantiles_never_cross_after_rearrangement():
    # Independent heads can predict P10 above P50; the band would render
    # inverted and the table would put the bear case above the bull case.
    from m_learning.inference.predictor import _monotonic_quantiles

    crossed = {0.1: np.array([0.9, 0.2]), 0.5: np.array([0.1, 0.5]), 0.9: np.array([0.5, 0.1])}
    out = _monotonic_quantiles(crossed)

    for step in range(2):
        assert out["0.1"][step] <= out["0.5"][step] <= out["0.9"][step]

    # Rearrangement is a permutation per step: the same values, reordered.
    for step in range(2):
        assert sorted(v[step] for v in crossed.values()) == pytest.approx(
            [out["0.1"][step], out["0.5"][step], out["0.9"][step]]
        )

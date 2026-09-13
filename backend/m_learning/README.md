# CoBrain Forecasting Engine

One global Temporal Fusion Transformer forecasting organisational trajectories
(burnout risk, delivery velocity, cash-flow, churn) for many tenant companies.
Outputs three quantiles per future week — Bear (P10), Base (P50), Bull (P90) —
plus interpretability weights.

## Quickstart

```bash
pip install -r m_learning/requirements.txt

# `m_learning` is imported as a top-level package, so run from backend/
cd backend
export PYTHONPATH=$PWD
```

```bash
python -m m_learning.scripts.build_features --country KE   # events -> weekly grid
python -m m_learning.training.train --target delivery_velocity
python -m m_learning.inference.serve                       # forecast API on :8100
```

```bash
python -m pytest m_learning/tests -q
```

## Architecture

Three tiers, three distinct mechanisms:

| Tier | Mechanism | Produces |
|---|---|---|
| 1 Universal | sequence encoder (LSTM + interpretable attention) | base trajectory `z_t` |
| 2 Industry | soft feature mask on the encoder **input** | gate `m_ind` |
| 3 Geography | static latent + time-varying known-future channel | `e_geo` and `g_t` |

Tenant identity enters through static covariates, never through separate models
per tenant. That is what produces cross-tenant learning: patterns learned from
the whole fleet improve every tenant's forecast.

## Layout

```
config.py              all hyperparameters, single source
registry/              static covariate schema, tier + forecast-target registry
data/                  event loader, weekly feature builder, text features,
                       external signals, per-tenant normaliser, torch Dataset
models/                GLU/GRN/VSN, static encoder, industry mask, geo projector,
                       universal encoder, fusion engine, quantile head, assembly
training/              pinball loss, rolling-window self-labelling, trainer, CLI
inference/             predictor, namespace-scoped forecast API
storage/               namespaced feature + forecast stores, model registry
scripts/               build_features, sync_external, backfill
tests/                 features, normalisation, model shapes, tenant isolation
```

## Invariants the tests enforce

- `z_t` is a per-timestep sequence `[B, T, d]`, never pooled or flattened.
- The industry mask gates the encoder **input**; a zero mask makes the output
  independent of `x`.
- The static encoder initialises the LSTM hidden and cell state — different
  static context must change the encoder output for identical inputs.
- The geo latent is L2-normalised to unit length.
- The output head reads `h[:, -1, :]`, so parameter count does not scale with
  sequence length and any lookback works.
- Quantile loss is asymmetric: P90 under-prediction costs 9x over-prediction.
- Missing weeks are an explicit `observed` mask plus `weeks_since_last_event`.
- Normalisation is per tenant, log1p on counts, statistics fitted on the
  training window only.
- Every store access requires a `tenant_id`; cross-tenant access raises.

## Cold start

A tenant with less than `MIN_WEEKS_REQUIRED` observed weeks still receives a
forecast — the fusion engine leans on industry and geography priors, the
quantile bands widen on their own, and the response is tagged
`low_confidence: true` for the UI to label.

## Notes

- `fusion.interp` produces `fusion_weights` as an explanation output. It sits
  off the prediction path, so the quantile loss does not train it; a test
  asserts this so it is a documented property rather than an accident.
- `external_signals.fx_volatility` and `is_rate_decision_week` are wired as
  columns but not yet sourced. They stay in the schema so the model input width
  never changes when a source is added.

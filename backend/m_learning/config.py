import os
from dataclasses import dataclass, field


@dataclass
class Config:
    # --- temporal ---
    BUCKET             : str = "W-MON"   # weekly, Monday start
    ENCODER_LENGTH     : int = 52        # 1 year lookback
    HORIZON            : int = 13        # 1 quarter forecast

    # --- model dims ---
    HIDDEN             : int = 64
    ATTN_HEADS         : int = 4
    DROPOUT            : float = 0.2
    STATIC_EMB         : int = 16
    GEO_LATENT         : int = 32

    # --- quantiles ---
    QUANTILES          : tuple = (0.1, 0.5, 0.9)

    # --- training ---
    BATCH_SIZE         : int = 64
    LR                 : float = 1e-3
    MAX_EPOCHS         : int = 100
    PATIENCE           : int = 10
    GRAD_CLIP          : float = 1.0

    # --- cold start ---
    MIN_WEEKS_REQUIRED : int = 12        # below this, flag low-confidence

    # --- paths ---
    CHECKPOINT_DIR     : str = os.getenv("CHECKPOINT_DIR", "m_learning/checkpoints")
    FEATURE_NAMESPACE  : str = "{tenant_id}:features"
    FORECAST_NAMESPACE : str = "{tenant_id}:forecasts"


CFG = Config()

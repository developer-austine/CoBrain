"""
Central configuration for the Company Brain backend.
All environment variables, constants, and settings are defined here.
Every other module imports from this file — never hardcode values elsewhere.
"""

import os
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../../.env"))

# ==================== DATABASE & INFRASTRUCTURE ====================

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/company_brain")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", None)  # Optional, for cloud Qdrant

# Normalize the URL scheme for SQLAlchemy 2.x: the "postgres://" dialect alias
# was removed — SQLAlchemy only accepts "postgresql://".
DB_CONN_STR = DATABASE_URL
if DB_CONN_STR and DB_CONN_STR.startswith("postgres://"):
    DB_CONN_STR = DB_CONN_STR.replace("postgres://", "postgresql://", 1)

# ==================== QUEUE CONFIGURATION ====================

QUEUE_KEY = os.getenv("QUEUE_KEY", "company_brain:ingest")
QUEUE_TIMEOUT = int(os.getenv("QUEUE_TIMEOUT", "300"))  # 5 minutes

# ==================== EMBEDDING PIPELINE ====================

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "384"))
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "64"))

# ==================== CHUNKING CONFIGURATION ====================

CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "512"))  # tokens
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "102"))  # tokens
MIN_CHUNK_SIZE = int(os.getenv("MIN_CHUNK_SIZE", "64"))  # minimum tokens

# ==================== DEDUPLICATION ====================

DEDUP_THRESHOLD = float(os.getenv("DEDUP_THRESHOLD", "0.85"))  # Jaccard similarity
MINHASH_NUM_HASHES = int(os.getenv("MINHASH_NUM_HASHES", "128"))
LSH_NUM_BANDS = int(os.getenv("LSH_NUM_BANDS", "8"))  # Number of LSH bands
LSH_ROWS_PER_BAND = int(os.getenv("LSH_ROWS_PER_BAND", "16"))  # Rows per band

# ==================== QDRANT COLLECTION ====================

QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "company_brain")
QDRANT_VECTOR_SIZE = EMBEDDING_DIM  # Must match embedding model dimension
QDRANT_DISTANCE_METRIC = "Cosine"

# HNSW index parameters for Qdrant
HNSW_EF_CONSTRUCT = int(os.getenv("HNSW_EF_CONSTRUCT", "128"))
HNSW_M = int(os.getenv("HNSW_M", "16"))

# ==================== CELERY / WORKERS ====================

CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TIMEZONE = "UTC"
CELERY_ENABLE_UTC = True
CELERY_TASK_TRACK_STARTED = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1  # One task at a time per worker

# ==================== PII & SECURITY ====================

PII_DETECTION_MODE = os.getenv("PII_DETECTION_MODE", "pseudonymise")  # or "redact"
PII_PSEUDONYM_PREFIX = "[REDACTED_"
PII_PSEUDONYM_SUFFIX = "]"

# ==================== LOGGING ====================

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_FORMAT = "json"  # or "text"

# ==================== FEATURE FLAGS ====================

ENABLE_DEDUP = os.getenv("ENABLE_DEDUP", "true").lower() == "true"
ENABLE_PII_SCRUB = os.getenv("ENABLE_PII_SCRUB", "true").lower() == "true"

# ==================== TIMEOUTS & RETRIES ====================

DOCUMENT_PROCESSING_TIMEOUT = int(os.getenv("DOCUMENT_PROCESSING_TIMEOUT", "600"))  # 10 minutes
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
RETRY_BACKOFF_FACTOR = float(os.getenv("RETRY_BACKOFF_FACTOR", "2.0"))
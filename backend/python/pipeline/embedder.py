from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    PointStruct,
    VectorParams,
    Filter,
    FieldCondition,
    MatchValue,
)

from chunker import Chunk

logger = logging.getLogger(__name__)


# Configuration


EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"

VECTOR_DIM: int = 384

EMBED_BATCH_SIZE: int = 64

# Qdrant collection name. One collection for the entire corpus;
# RBAC is enforced via the `namespace` payload filter, not separate collections.
QDRANT_COLLECTION: str = "company_brain"

QDRANT_HOST: str = "localhost"
QDRANT_PORT: int = 6333
# In Docker the service hostname is "qdrant" — always prefer the env URL.
QDRANT_URL: str = os.getenv("QDRANT_URL", f"http://{QDRANT_HOST}:{QDRANT_PORT}")


HNSW_EF_CONSTRUCT: int = 128
HNSW_M: int = 16  # number of connections per node — 16 is Qdrant's default


@dataclass
class EmbedResult:
    
    upserted_ids: list[str] = field(default_factory=list)
    failed_ids: list[str] = field(default_factory=list)
    duration_secs: float = 0.0
    model: str = EMBEDDING_MODEL
    vector_dim: int = VECTOR_DIM

class _EmbedderState:
    """
    Holds the sentence-transformers model and Qdrant client as
    module-level singletons. Initialised lazily on first use so that
    importing this module in tests doesn't trigger GPU/network calls.
    """
    _model: Optional[SentenceTransformer] = None
    _client: Optional[QdrantClient] = None

    @classmethod
    def model(cls) -> SentenceTransformer:
        if cls._model is None:
            logger.info("[embedder] Loading model: %s", EMBEDDING_MODEL)
            cls._model = SentenceTransformer(EMBEDDING_MODEL)
            logger.info("[embedder] Model loaded (dim=%d)", VECTOR_DIM)
        return cls._model

    @classmethod
    def client(cls) -> QdrantClient:
        if cls._client is None:
            logger.info("[embedder] Connecting to Qdrant at %s", QDRANT_URL)
            cls._client = QdrantClient(url=QDRANT_URL)
        return cls._client

# Collection management
def ensure_collection(client: Optional[QdrantClient] = None) -> None:

    qdrant = client or _EmbedderState.client()

    existing = [c.name for c in qdrant.get_collections().collections]
    if QDRANT_COLLECTION in existing:
        logger.debug("[embedder] Collection '%s' already exists", QDRANT_COLLECTION)
        return

    logger.info("[embedder] Creating collection '%s'", QDRANT_COLLECTION)
    qdrant.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=VectorParams(
            size=VECTOR_DIM,
            distance=Distance.COSINE,
            hnsw_config={
                "ef_construct": HNSW_EF_CONSTRUCT,
                "m": HNSW_M,
                "on_disk": False,
            },
        ),
    )
    logger.info("[embedder] Collection created")



# L2 normalisation (mirrors normalizer.py for consistency)


def _l2_normalise_batch(matrix: np.ndarray) -> np.ndarray:
    """
    L2-normalise a batch of vectors.

        For matrix V of shape (N, D):
            norms = ‖vᵢ‖₂  for each row i     (shape: N,)
            V̂    = V / norms[:, np.newaxis]    (broadcast division)

    Near-zero vectors (‖v‖₂ < 1e-10) are left unchanged to avoid
    division by zero — they will score poorly in cosine search anyway.

    This is intentionally duplicated from normalizer.py rather than
    imported, so that this module has zero dependency on the normaliser
    and can be used standalone (e.g. in the RAG query path).
    """
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms = np.where(norms < 1e-10, 1.0, norms)
    return matrix / norms


def embed_chunks(
    chunks: list[Chunk],
    client: Optional[QdrantClient] = None,
    model: Optional[SentenceTransformer] = None,
) -> EmbedResult:

    if not chunks:
        logger.debug("[embedder] embed_chunks called with empty list — no-op")
        return EmbedResult()

    t0 = time.perf_counter()
    st_model = model or _EmbedderState.model()
    qdrant = client or _EmbedderState.client()

    ensure_collection(qdrant)

    texts = [c.text for c in chunks]
    result = EmbedResult(model=EMBEDDING_MODEL, vector_dim=VECTOR_DIM)

    all_vectors: list[np.ndarray] = []

    for batch_start in range(0, len(texts), EMBED_BATCH_SIZE):
        batch_texts = texts[batch_start:batch_start + EMBED_BATCH_SIZE]
        logger.debug(
            "[embedder] Embedding batch %d–%d of %d",
            batch_start, batch_start + len(batch_texts) - 1, len(texts)
        )
        # encode() returns numpy array of shape (batch_size, VECTOR_DIM)
        batch_vectors = st_model.encode(
            batch_texts,
            batch_size=EMBED_BATCH_SIZE,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=False,  # we L2-normalise ourselves below
        )
        all_vectors.append(batch_vectors)

    #  L2 normalise full matrix 
    matrix = np.vstack(all_vectors)  # shape: (N, VECTOR_DIM)
    matrix = _l2_normalise_batch(matrix)

    logger.debug("[embedder] Embedded %d chunks, matrix shape %s", len(chunks), matrix.shape)

    #  Build Qdrant points 
    points: list[PointStruct] = []
    for i, chunk in enumerate(chunks):
        payload = {
            "doc_id":        chunk.doc_id,
            "chunk_id":      chunk.chunk_id,
            "chunk_index":   chunk.chunk_index,
            "total_chunks":  chunk.total_chunks,
            "word_count":    chunk.word_count,
            "text":          chunk.text,
            # Metadata from NormalisedDocument (source, author, timestamp, namespace)
            **chunk.metadata,
        }
        points.append(PointStruct(
            id=chunk.chunk_id,
            vector=matrix[i].tolist(),
            payload=payload,
        ))

    #  Upsert in batches 
    UPSERT_BATCH = 100  # Qdrant recommended max per upsert call
    for batch_start in range(0, len(points), UPSERT_BATCH):
        batch = points[batch_start:batch_start + UPSERT_BATCH]
        try:
            qdrant.upsert(
                collection_name=QDRANT_COLLECTION,
                points=batch,
                wait=True,  # wait for indexing — set False for fire-and-forget
            )
            result.upserted_ids.extend(p.id for p in batch)
            logger.debug("[embedder] Upserted batch of %d points", len(batch))
        except Exception as exc:  # noqa: BLE001
            failed = [p.id for p in batch]
            result.failed_ids.extend(failed)
            logger.error(
                "[embedder] Upsert failed for %d points: %s — ids: %s",
                len(batch), exc, failed[:5]
            )

    result.duration_secs = time.perf_counter() - t0
    logger.info(
        "[embedder] Done: %d upserted, %d failed, %.2fs",
        len(result.upserted_ids), len(result.failed_ids), result.duration_secs,
    )
    return result



# RAG query helper — embed a single query string for retrieval


def embed_query(query: str, model: Optional[SentenceTransformer] = None) -> list[float]:

    st_model = model or _EmbedderState.model()
    vector = st_model.encode(
        [query],
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=False,
    )  # shape: (1, VECTOR_DIM)
    normalised = _l2_normalise_batch(vector)
    return normalised[0].tolist()

def search(
    query_vector: list[float],
    namespace: str,
    top_k: int = 20,
    client: Optional[QdrantClient] = None,
) -> list[dict]:

    qdrant = client or _EmbedderState.client()

    namespace_filter = Filter(
        must=[
            FieldCondition(
                key="namespace",
                match=MatchValue(value=namespace),
            )
        ]
    )

    hits = qdrant.search(
        collection_name=QDRANT_COLLECTION,
        query_vector=query_vector,
        query_filter=namespace_filter,
        limit=top_k,
        with_payload=True,
    )

    results = []
    for hit in hits:
        payload = dict(hit.payload or {})
        payload["_score"] = hit.score
        results.append(payload)

    logger.debug(
        "[embedder] search: namespace=%s top_k=%d → %d results",
        namespace, top_k, len(results),
    )
    return results

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    # from chunker import chunk

    # SAMPLE_TEXT = """
    # The Company Brain is a Retrieval-Augmented Intelligence platform that
    # continuously ingests company data from Slack, Notion, Gmail, Google Drive,
    # and Jira. It transforms that data into vector embeddings stored in Qdrant,
    # then runs a multi-agent AI layer for conversational Q&A, pattern analysis,
    # and predictive forecasting.

    # The ingestion pipeline has five stages: encoding normalisation, OCR repair,
    # temporal normalisation, surface cleaning, and BM25 scoring. After that,
    # the PII scrubber detects and masks personal information before the text
    # reaches the chunker and embedder.

    # Security is zero-trust and defence-in-depth. Every vector search is scoped
    # to the requesting user's RBAC namespace, enforced as a hard Qdrant filter.
    # Connector OAuth tokens are encrypted at field level in Postgres using AES-256
    # with envelope keys managed by AWS KMS.
    # """

    # chunks = chunk(
    #     SAMPLE_TEXT,
    #     doc_id="smoke-test-001",
    #     metadata={
    #         "source": "notion",
    #         "author": "PERSON_001234",
    #         "timestamp_iso": "2025-06-01T10:00:00",
    #         "namespace": "org_test:analyst",
    #     },
    # )

    # print(f"\n=== {len(chunks)} chunks to embed ===")
    # for c in chunks:
    #     print(f"  [{c.chunk_index}] {len(c.text)} chars — {c.text[:80]}…")

    # print("\n=== Embedding query vector ===")
    # try:
    #     qvec = embed_query("What security controls does Company Brain use?")
    #     print(f"  Query vector: dim={len(qvec)}, norm={sum(x**2 for x in qvec)**0.5:.4f}")
    # except Exception as e:
    #     print(f"  (skipped — model not loaded: {e})")

    # print("\n=== Embedding & upserting chunks (requires Qdrant running) ===")
    # try:
    #     res = embed_chunks(chunks)
    #     print(f"  Upserted: {len(res.upserted_ids)}")
    #     print(f"  Failed:   {len(res.failed_ids)}")
    #     print(f"  Duration: {res.duration_secs:.2f}s")
    #     print(f"  Model:    {res.model} (dim={res.vector_dim})")
    # except Exception as e:
    #     print(f"  (skipped — Qdrant not running: {e})")
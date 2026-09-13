"""
Qdrant vector database client and collection management.
Handles collection creation, vector index setup, and point upserts.
"""

import logging
import uuid
from typing import Optional

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    PointStruct,
    VectorParams,
)

from backend.python.config import (
    QDRANT_URL,
    QDRANT_API_KEY,
    QDRANT_COLLECTION,
    QDRANT_VECTOR_SIZE,
    QDRANT_DISTANCE_METRIC,
    HNSW_M,
    HNSW_EF_CONSTRUCT,
)

logger = logging.getLogger(__name__)

# Singleton Qdrant client
_qdrant_client: Optional[QdrantClient] = None


def get_qdrant_client() -> QdrantClient:
    """Get or create the Qdrant client (singleton)."""
    global _qdrant_client
    if _qdrant_client is None:
        logger.info(f"[Qdrant] Connecting to {QDRANT_URL}")
        try:
            # Support both cloud (with API key) and local Qdrant. The default
            # 5s timeout is too tight for a cold filtered search on a large
            # collection — the first query after boot would otherwise fail.
            if QDRANT_API_KEY:
                _qdrant_client = QdrantClient(
                    url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=30
                )
            else:
                _qdrant_client = QdrantClient(url=QDRANT_URL, timeout=30)

            # Health check
            info = _qdrant_client.get_collections()
            logger.info(f"[Qdrant] Connected successfully. Collections: {len(info.collections)}")
        except Exception as e:
            logger.error(f"[Qdrant] Connection failed: {e}")
            raise
    return _qdrant_client


# Payload fields we filter on. Without a keyword index Qdrant falls back to a
# full scan for every filtered search, which is slow enough to time out the
# search-api on a cold collection. These are the RBAC boundary (namespace) and
# the source scoping used by keyword/@-mention retrieval (source).
INDEXED_PAYLOAD_FIELDS = ("namespace", "source")


def ensure_payload_indexes() -> None:
    """
    Create keyword payload indexes for the fields we filter on.
    Idempotent: Qdrant errors if the index already exists, which we swallow.
    """
    client = get_qdrant_client()

    for field in INDEXED_PAYLOAD_FIELDS:
        try:
            client.create_payload_index(
                collection_name=QDRANT_COLLECTION,
                field_name=field,
                field_schema="keyword",
            )
            logger.info(f"[Qdrant] Created payload index on '{field}'")
        except Exception as e:
            # Already indexed (the common case) — not an error.
            logger.debug(f"[Qdrant] Payload index on '{field}' not created: {e}")


def ensure_collection() -> None:
    """
    Create the main collection if it doesn't exist.
    Configures vector parameters, distance metric, and HNSW index.
    Idempotent: safe to call multiple times.
    """
    client = get_qdrant_client()

    try:
        # Check if collection exists
        client.get_collection(QDRANT_COLLECTION)
        logger.info(f"[Qdrant] Collection '{QDRANT_COLLECTION}' already exists")
        ensure_payload_indexes()
        return
    except Exception:
        # Collection doesn't exist, create it
        logger.info(f"[Qdrant] Creating collection '{QDRANT_COLLECTION}'")
        try:
            client.create_collection(
                collection_name=QDRANT_COLLECTION,
                vectors_config=VectorParams(
                    size=QDRANT_VECTOR_SIZE,
                    distance=Distance.COSINE,  # Match QDRANT_DISTANCE_METRIC
                ),
                # HNSW index parameters
                hnsw_config={
                    "m": HNSW_M,
                    "ef_construct": HNSW_EF_CONSTRUCT,
                },
            )
            logger.info(
                f"[Qdrant] Collection created with {QDRANT_VECTOR_SIZE}-dim vectors, "
                f"Cosine distance, HNSW(m={HNSW_M}, ef_construct={HNSW_EF_CONSTRUCT})"
            )
            ensure_payload_indexes()
        except Exception as e:
            logger.error(f"[Qdrant] Failed to create collection: {e}")
            raise


def upsert_to_qdrant(
    chunk_id: str,
    vector: list[float],
    payload: dict,
    namespace: str,
) -> str:
    """
    Upsert a (vector, payload) point into Qdrant.
    The namespace field is the RBAC boundary — it MUST flow through from QueuePayload.

    Args:
        chunk_id: unique identifier for this chunk
        vector: embedding vector (384-dim for all-MiniLM-L6-v2)
        payload: full metadata (text, source, author, timestamp, offsets, namespace, etc.)
        namespace: RBAC boundary (set server-side, never from client)

    Returns:
        The point ID that was upserted.
    """
    client = get_qdrant_client()

    try:
        # Ensure namespace is in the payload (SACRED: never drop this)
        if "namespace" not in payload:
            payload["namespace"] = namespace
        elif payload["namespace"] != namespace:
            logger.warning(
                f"[Qdrant] Namespace mismatch: payload has '{payload['namespace']}' "
                f"but received '{namespace}'. Using received namespace."
            )
            payload["namespace"] = namespace

        # Create point
        point = PointStruct(
            id=chunk_id,  # Use chunk ID as the point ID
            vector=vector,
            payload=payload,
        )

        # Upsert (insert or update)
        client.upsert(
            collection_name=QDRANT_COLLECTION,
            points=[point],
        )

        logger.debug(
            f"[Qdrant] Upserted point {chunk_id} with namespace '{namespace}' "
            f"and {len(vector)}-dim vector"
        )
        return chunk_id

    except Exception as e:
        logger.error(f"[Qdrant] Upsert failed for {chunk_id}: {e}")
        raise


def search_qdrant(
    query_vector: list[float],
    namespace: str,
    limit: int = 10,
    score_threshold: Optional[float] = None,
    sources: Optional[list[str]] = None,
) -> list[dict]:
    """
    Search Qdrant for semantically similar documents.
    CRITICAL: namespace filter is MANDATORY (RBAC boundary).

    Args:
        query_vector: query embedding vector
        namespace: requesting user's namespace (must match Qdrant payload namespace)
        limit: max results to return
        score_threshold: optional minimum score threshold
        sources: optional list of source keys (e.g. ["notion", "github"]). When
            provided, only chunks whose payload `source` is in this list are
            returned — used for keyword-triggered, source-scoped retrieval.

    Returns:
        List of search results with payloads.
    """
    client = get_qdrant_client()

    try:
        # Build the namespace filter (RBAC boundary). A wildcard ("*" or a
        # "prefix:*" form) means "search the whole collection" — used by the
        # single-user chat where every namespace belongs to the same user.
        # NOTE: relax this before going multi-tenant (filter by a user_id field).
        is_wildcard = (not namespace) or namespace == "*" or namespace.endswith(":*")

        must: list[dict] = []
        if not is_wildcard:
            must.append({"key": "namespace", "match": {"value": namespace}})
        if sources:
            # Match any of the requested sources (Qdrant `match: {any: [...]}`).
            must.append({"key": "source", "match": {"any": list(sources)}})

        search_filter = {"must": must} if must else None

        # qdrant-client >= 1.10 removed .search(); query_points() is the
        # unified query API (returns QueryResponse with .points).
        response = client.query_points(
            collection_name=QDRANT_COLLECTION,
            query=query_vector,
            query_filter=search_filter,
            limit=limit,
            score_threshold=score_threshold,
            with_payload=True,
        )

        # Return results as dicts
        return [
            {
                "id": r.id,
                "score": r.score,
                "payload": r.payload,
            }
            for r in response.points
        ]

    except Exception as e:
        logger.error(f"[Qdrant] Search failed: {e}")
        raise


def delete_from_qdrant(point_id: str) -> None:
    """Delete a point from Qdrant by ID (rarely needed)."""
    client = get_qdrant_client()
    try:
        client.delete(
            collection_name=QDRANT_COLLECTION,
            points_selector=[point_id],
        )
        logger.debug(f"[Qdrant] Deleted point {point_id}")
    except Exception as e:
        logger.error(f"[Qdrant] Delete failed for {point_id}: {e}")
        raise

"""
Redis connection and queue/LSH dedup index management.
Used by:
  - workers/ingest.py: BRPOP for the ingest queue
  - pipeline/deduplicator.py: LSH index queries and updates
"""

import logging
import redis
from typing import Optional

from backend.python.config import REDIS_URL

logger = logging.getLogger(__name__)

# Singleton Redis connection
_redis_client: Optional[redis.Redis] = None


def get_redis_client() -> redis.Redis:
    """
    Get or create the Redis client (singleton).
    Used for both queue consumption and LSH dedup index.
    """
    global _redis_client
    if _redis_client is None:
        logger.info(f"[Redis] Connecting to {REDIS_URL}")
        try:
            _redis_client = redis.from_url(REDIS_URL, decode_responses=True)
            # Test the connection
            _redis_client.ping()
            logger.info("[Redis] Connection successful")
        except Exception as e:
            logger.error(f"[Redis] Connection failed: {e}")
            raise
    return _redis_client


def queue_lpush(key: str, payload: str) -> int:
    """LPUSH a JSON payload onto the queue. Returns the new queue length."""
    client = get_redis_client()
    return client.lpush(key, payload)


def queue_brpop(key: str, timeout: int = 0) -> Optional[tuple[str, str]]:
    """
    Blocking BRPOP from the queue.
    Returns (key, payload) tuple or None if timeout expires.

    redis-py races its socket read timeout against the server-side BRPOP
    timeout, so an idle BRPOP frequently raises TimeoutError instead of
    returning None — treat that as "no work" rather than an error.
    """
    client = get_redis_client()
    try:
        return client.brpop(key, timeout=timeout)
    except redis.exceptions.TimeoutError:
        return None


def lsh_add_signature(band_idx: int, bucket_hash: str, doc_id: str) -> None:
    """
    Add a document's MinHash signature to the LSH index.
    Called by deduplicator.py after checking the document is not a duplicate.
    """
    client = get_redis_client()
    lsh_key = f"lsh:band:{band_idx}:{bucket_hash}"
    client.sadd(lsh_key, doc_id)
    # Optional: set TTL on LSH index entries for periodic cleanup
    client.expire(lsh_key, 86400 * 30)  # 30 days


def lsh_get_bucket(band_idx: int, bucket_hash: str) -> set[str]:
    """
    Retrieve all document IDs in an LSH bucket.
    Used by deduplicator.py to find potential duplicates.
    """
    client = get_redis_client()
    lsh_key = f"lsh:band:{band_idx}:{bucket_hash}"
    return client.smembers(lsh_key)


def lsh_flush_index() -> None:
    """
    Flush the entire LSH index (careful — loses all dedup state).
    Use only for testing or explicit cleanup.
    """
    client = get_redis_client()
    # Scan and delete all LSH keys
    cursor = 0
    while True:
        cursor, keys = client.scan(cursor, match="lsh:band:*", count=100)
        if keys:
            client.delete(*keys)
        if cursor == 0:
            break
    logger.info("[Redis] LSH index flushed")


def publish_queue_payload(payload_json: str, queue_key: str = "company_brain:ingest") -> int:
    """
    Publish a QueuePayload JSON string to the ingest queue.
    Called by sync routes AFTER upserting document to Postgres.
    Returns the new queue length.
    """
    length = queue_lpush(queue_key, payload_json)
    logger.debug(f"[Queue] Published payload to {queue_key}. Queue length: {length}")
    return length

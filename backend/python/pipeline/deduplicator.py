"""
MinHash LSH near-duplicate detection.
Takes a NormalisedDocument's MinHash signature, checks it against a Redis-backed LSH index.
If Jaccard >= DEDUP_THRESHOLD to an existing doc, returns True (skip).
Otherwise adds the signature to the index and returns False (proceed).

This replaces the is_near_duplicate() stub left in normaliser.py.
Uses the datasketch library's MinHashLSH backed by Redis.
"""

import logging
from typing import Optional
from base64 import b64encode, b64decode

from datasketch import MinHash, MinHashLSH
from backend.python.config import (
    DEDUP_THRESHOLD,
    MINHASH_NUM_HASHES,
    LSH_NUM_BANDS,
    LSH_ROWS_PER_BAND,
)
from backend.python.schemas import NormalisedDocument
from backend.python.db.redis_client import (
    get_redis_client,
    lsh_add_signature,
    lsh_get_bucket,
)

logger = logging.getLogger(__name__)


def _minhash_from_signature(sig: list[int]) -> MinHash:
    """Reconstruct a MinHash object from a signature (list of integers)."""
    m = MinHash(num_perm=len(sig))
    m.hashvalues = sig
    return m


def is_near_duplicate(doc: NormalisedDocument) -> tuple[bool, Optional[str]]:
    """
    Check if a document is a near-duplicate of an existing one.

    Args:
        doc: NormalisedDocument with minhash_sig already computed by normaliser

    Returns:
        (is_duplicate, duplicate_doc_id)
        is_duplicate: True if Jaccard >= DEDUP_THRESHOLD
        duplicate_doc_id: the ID of the matched document (if is_duplicate=True)
    """
    if not doc.minhash_sig or len(doc.minhash_sig) == 0:
        logger.warning("[Deduplicator] Document has no MinHash signature")
        return False, None

    try:
        # Reconstruct the MinHash from the signature
        minhash = _minhash_from_signature(doc.minhash_sig)

        # Compute LSH band signatures
        # Each band is a hash of a subset of the MinHash values
        for band_idx in range(LSH_NUM_BANDS):
            # Extract rows for this band
            start_idx = band_idx * LSH_ROWS_PER_BAND
            end_idx = min(start_idx + LSH_ROWS_PER_BAND, len(doc.minhash_sig))

            if end_idx <= start_idx:
                continue

            band_values = doc.minhash_sig[start_idx:end_idx]
            # Hash the band values to get a bucket hash
            bucket_hash = _hash_band(band_values)

            # Check if any documents are already in this bucket
            matching_docs = lsh_get_bucket(band_idx, bucket_hash)

            if matching_docs:
                # Found documents in the same LSH bucket
                # Now compute Jaccard similarity to confirm they're actually duplicates
                for candidate_sig_b64 in matching_docs:
                    try:
                        candidate_sig = _b64_to_signature(candidate_sig_b64)
                        candidate_minhash = _minhash_from_signature(candidate_sig)
                        jaccard = minhash.jaccard(candidate_minhash)

                        logger.debug(
                            f"[Deduplicator] Document {doc.content_hash[:8]}... "
                            f"vs {candidate_sig_b64[:8]}...: Jaccard={jaccard:.3f}"
                        )

                        if jaccard >= DEDUP_THRESHOLD:
                            logger.info(
                                f"[Deduplicator] DUPLICATE DETECTED: "
                                f"{doc.content_hash[:8]}... is {jaccard:.1%} similar to {candidate_sig_b64[:8]}..."
                            )
                            return True, candidate_sig_b64
                    except Exception as e:
                        logger.warning(f"[Deduplicator] Failed to compare with candidate: {e}")
                        continue

        # Not a duplicate; add to index
        _add_to_lsh_index(doc)
        return False, None

    except Exception as e:
        logger.error(f"[Deduplicator] Error checking duplicates: {e}")
        # On error, skip dedup and proceed (fail open)
        return False, None


def _hash_band(band_values: list[int]) -> str:
    """Hash a band of MinHash values to get a bucket hash."""
    import hashlib
    band_str = "|".join(str(v) for v in band_values)
    return hashlib.sha256(band_str.encode()).hexdigest()[:16]


def _add_to_lsh_index(doc: NormalisedDocument) -> None:
    """Add a document's MinHash signature to the Redis-backed LSH index."""
    try:
        # Encode the signature as base64 for storage
        sig_b64 = _signature_to_b64(doc.minhash_sig)

        # Add to each LSH band bucket
        for band_idx in range(LSH_NUM_BANDS):
            start_idx = band_idx * LSH_ROWS_PER_BAND
            end_idx = min(start_idx + LSH_ROWS_PER_BAND, len(doc.minhash_sig))

            if end_idx <= start_idx:
                continue

            band_values = doc.minhash_sig[start_idx:end_idx]
            bucket_hash = _hash_band(band_values)

            # Add signature to this bucket (Redis set)
            lsh_add_signature(band_idx, bucket_hash, sig_b64)

        logger.debug(
            f"[Deduplicator] Added {doc.content_hash[:8]}... to LSH index "
            f"({LSH_NUM_BANDS} bands)"
        )
    except Exception as e:
        logger.warning(f"[Deduplicator] Failed to add to LSH index: {e}")
        # Don't crash; this is indexing for future dedup


def _signature_to_b64(sig: list[int]) -> str:
    """Encode a MinHash signature as base64."""
    import base64
    sig_bytes = bytes(sig)
    return base64.b64encode(sig_bytes).decode("ascii")


def _b64_to_signature(sig_b64: str) -> list[int]:
    """Decode a base64 MinHash signature back to a list of ints."""
    import base64
    sig_bytes = base64.b64decode(sig_b64.encode("ascii"))
    return list(sig_bytes)

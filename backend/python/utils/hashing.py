"""
Hashing utilities: SHA-256 content hashing and MinHash signature generation.
"""

import hashlib
from datasketch import MinHash

from backend.python.config import MINHASH_NUM_HASHES


def sha256_hash(text: str) -> str:
    """Compute SHA-256 hash of text content."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def minhash_from_text(text: str, num_perm: int = MINHASH_NUM_HASHES) -> list[int]:
    """
    Generate MinHash signature from text for deduplication.

    Args:
        text: the input text
        num_perm: number of hash permutations (default 128)

    Returns:
        List of hash values representing the document's signature
    """
    # Create MinHash object
    minhash = MinHash(num_perm=num_perm)

    # Tokenise the text and add to MinHash
    # Simple word-level tokenisation (can be improved with linguistic tokenisation)
    tokens = text.lower().split()
    for token in tokens:
        minhash.update(token.encode("utf-8"))

    # Return the signature as a list of integers
    return list(minhash.hashvalues)

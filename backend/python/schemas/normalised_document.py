"""
NormalisedDocument: the output of the normaliser stage.
Result after the 8-stage normalisation pipeline (encoding, OCR, temporal, surface, BM25, etc.).
Ready for chunking and embedding.
"""

from dataclasses import dataclass, field


@dataclass
class NormalisedDocument:
    """
    Clean, consistent document after 8-stage normalisation.

    Produced by: normaliser.py (Step 5 in data flow)
    Consumed by: pii.py -> deduplicator.py -> chunker.py
    """

    content: str  # Clean UTF-8 text
    source: str  # "gmail" | "notion" | "github" | "custom"
    author: str  # Person/entity that created the document
    timestamp_iso: str  # ISO 8601 UTC: "2025-01-15T09:00:00Z"
    timestamp_epoch: int  # Seconds since Unix epoch
    word_count: int  # Number of words in cleaned content
    content_hash: str  # SHA-256 of cleaned content (for dedup)
    minhash_sig: list[int]  # MinHash signature (128 values)
    bm25_lengths: dict = field(default_factory=dict)  # {token: bm25_weight}
    metadata: dict = field(default_factory=dict)  # Provider-specific extras

    def __post_init__(self) -> None:
        """Validate basic invariants."""
        if not self.content or not self.content.strip():
            raise ValueError("content must be non-empty")
        if not self.source:
            raise ValueError("source must be non-empty")
        if not self.author:
            raise ValueError("author must be non-empty")
        if not self.content_hash:
            raise ValueError("content_hash must be set")
        if len(self.minhash_sig) != 128:
            raise ValueError("minhash_sig must have 128 values")

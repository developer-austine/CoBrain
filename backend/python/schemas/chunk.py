"""
Chunk: the output of the chunker stage.
A document split into overlapping 512-token windows, ready for embedding.
"""

from dataclasses import dataclass, field


@dataclass
class Chunk:
    """
    A chunk of text with full metadata and position information.

    Produced by: chunker.py (Step 7 in data flow)
    Consumed by: embedder.py (which embeds and stores to Qdrant)
    """

    text: str  # The chunk text
    chunk_index: int  # Position in the sequence of chunks (0-indexed)
    total_chunks: int  # Total number of chunks from this document
    char_start: int  # Character offset in parent document
    char_end: int  # Character offset in parent document
    token_count: int  # Approximate token count
    parent_doc_id: str  # ID of the original document (Postgres staging row ID)
    source: str  # "gmail" | "notion" | "github" | "custom"
    author: str  # Original document author
    timestamp_iso: str  # ISO 8601 UTC: "2025-01-15T09:00:00Z"
    timestamp_epoch: int  # Seconds since Unix epoch
    namespace: str  # RBAC boundary: "userId:scope" or "orgId:teamScope"
    content_hash: str  # SHA-256 of parent document (for reference)
    metadata: dict = field(default_factory=dict)  # Additional context

    def __post_init__(self) -> None:
        """Validate basic invariants."""
        if not self.text or not self.text.strip():
            raise ValueError("text must be non-empty")
        if self.chunk_index < 0:
            raise ValueError("chunk_index must be >= 0")
        if self.total_chunks < 1:
            raise ValueError("total_chunks must be >= 1")
        if self.chunk_index >= self.total_chunks:
            raise ValueError("chunk_index must be < total_chunks")
        if self.token_count < 1:
            raise ValueError("token_count must be >= 1")
        if self.char_end < self.char_start:
            raise ValueError("char_end must be >= char_start")
        if not self.parent_doc_id:
            raise ValueError("parent_doc_id must be non-empty")
        if not self.namespace:
            raise ValueError("namespace must be non-empty (RBAC boundary)")

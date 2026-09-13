"""
QueuePayload: the message contract between Next.js and Python.
Next.js publishes this to Redis; Python consumers parse and process it.
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class QueuePayload:
    """
    The exact shape that Next.js LPUSH onto the Redis queue.
    Python BRPOP and parse this before mapping -> normalising -> embedding.

    Produced by: Next.js (app/api/{connector}/sync routes)
    Consumed by: Python workers/ingest.py (Step 3-4 in data flow)
    """

    raw_document_id: str  # Postgres staging row ID (Email, NotionPage, GitHubItem, CustomDocument, SourceFile)
    source: str  # "gmail" | "notion" | "github" | "custom" | "upload" | "brain"
    external_id: str  # Provider's native ID (email UID, Notion page ID, GitHub issue ID, etc.)
    author: str = ""  # Person/entity that created it — genuinely absent for uploaded files
    subject: Optional[str] = None  # Optional: email subject, document title
    content: str = ""  # Full raw text body
    timestamp: str = ""  # ISO 8601 UTC
    metadata: dict = field(default_factory=dict)  # Provider-specific extras
    connector_id: str = ""  # Which connection this came from
    namespace: str = ""  # "userId:scope" — RBAC boundary (SACRED: never drop this)

    def __post_init__(self) -> None:
        """Validate that the contract is complete."""
        if not self.raw_document_id:
            raise ValueError("raw_document_id (Postgres row ID) is required")
        if not self.source:
            raise ValueError("source must be non-empty")
        if not self.external_id:
            raise ValueError("external_id (provider's ID) is required")
        # `author` is deliberately NOT required. An uploaded PDF has no author,
        # and a Notion page whose creator the integration cannot resolve has no
        # name — rejecting those dropped every upload on the floor. Mappers fall
        # back to "Unknown" via BaseMapper._extract_author.
        if not self.content or not self.content.strip():
            raise ValueError("content must be non-empty")
        if not self.timestamp:
            raise ValueError("timestamp must be ISO 8601 UTC")
        if not self.namespace:
            raise ValueError("namespace (RBAC boundary) is required — never default to shared value")

    @classmethod
    def from_dict(cls, data: dict) -> "QueuePayload":
        """
        Construct from a JSON dict (deserialized from Redis).
        Ensures all required fields are present.
        """
        try:
            return cls(
                raw_document_id=data["raw_document_id"],
                source=data["source"],
                external_id=data["external_id"],
                author=data.get("author", ""),
                subject=data.get("subject"),
                content=data.get("content", ""),
                timestamp=data.get("timestamp", ""),
                metadata=data.get("metadata", {}),
                connector_id=data.get("connector_id", ""),
                namespace=data.get("namespace", ""),
            )
        except KeyError as e:
            raise ValueError(f"QueuePayload missing required field: {e}")

"""
RawDocument: the unified input shape that mappers produce.
This is what every connector (Gmail, Notion, GitHub, Custom) is converted into.
Mappers translate source-specific JSON into this consistent shape.
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class RawDocument:
    """
    Unified document shape after mapping from a source-specific payload.

    Produced by: mappers (gmail.py, notion.py, github.py, custom.py)
    Consumed by: normaliser.py (Step 5 in data flow)
    """

    content: bytes | str  # Raw text or bytes (may need encoding detection)
    source: str  # "gmail" | "notion" | "github" | "custom"
    author: str  # Person/entity that created the document
    timestamp: str  # ISO 8601 UTC or epoch timestamp
    metadata: dict = field(default_factory=dict)  # Provider-specific extras

    def __post_init__(self) -> None:
        """Validate basic invariants."""
        if not self.source:
            raise ValueError("source must be non-empty")
        if not self.author:
            raise ValueError("author must be non-empty")
        if not self.timestamp:
            raise ValueError("timestamp must be non-empty")
        if not self.content:
            raise ValueError("content must be non-empty")

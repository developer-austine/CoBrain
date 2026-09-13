"""
BrainMapper: convert a BrainBlock dual-write payload -> RawDocument.

Brain blocks are the AI's own derived knowledge (meeting summaries, learned
facts, decisions...). They are dual-written: persisted to Postgres by the
Next.js layer AND pushed onto the ingest queue so they get chunked/embedded
into Qdrant with source="brain" — which is what lets the RAG engine cite the
Brain's own conclusions later (blueprint §6.1 step 7).

Status lifecycle note: BrainBlock rows live in the business schema and their
status is managed by the Next.js layer, so update_document_status skips the
"brain" source entirely.
"""

import logging

from backend.python.schemas import RawDocument, QueuePayload
from .base import BaseMapper

logger = logging.getLogger(__name__)


class BrainMapper(BaseMapper):
    """Convert a Brain dual-write payload into RawDocument."""

    def map(self, payload: QueuePayload) -> RawDocument:
        content = self._extract_content(payload.content)

        metadata = dict(payload.metadata or {})
        metadata.setdefault("subject", payload.subject or "")
        metadata.setdefault("block_id", payload.raw_document_id)
        metadata.setdefault("block_type", metadata.get("block_type", "note"))

        return RawDocument(
            content=content,
            source="brain",
            author=payload.author or "ai",
            timestamp=self._parse_timestamp(payload.timestamp),
            metadata=metadata,
        )

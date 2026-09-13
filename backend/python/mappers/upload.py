"""
UploadMapper: convert an uploaded-file QueuePayload -> RawDocument.

Uploaded files (PDF, DOCX, TXT, ...) are just a new source type feeding the
existing pipeline (blueprint §9.3). The Next.js upload route already extracted
plain text and pushed it with source="upload", so this mapper is thin — it
carries the file name/mime through as metadata for provenance.

Status lifecycle mirrors connectors (PENDING -> QUEUED -> PROCESSED / FAILED)
against the SourceFile table.
"""

import logging

from backend.python.schemas import RawDocument, QueuePayload
from .base import BaseMapper

logger = logging.getLogger(__name__)


class UploadMapper(BaseMapper):
    """Convert an uploaded-file payload into RawDocument."""

    def map(self, payload: QueuePayload) -> RawDocument:
        content = self._extract_content(payload.content)

        metadata = dict(payload.metadata or {})
        metadata.setdefault("file_name", payload.subject or "")
        if payload.subject:
            metadata.setdefault("title", payload.subject[:512])

        logger.debug(
            "[UploadMapper] Mapped uploaded file %s (%s)",
            payload.raw_document_id,
            metadata.get("file_name", ""),
        )

        return RawDocument(
            content=content,
            source="upload",
            author=self._extract_author(payload.author),
            timestamp=self._parse_timestamp(payload.timestamp),
            metadata=metadata,
        )

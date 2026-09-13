"""
DriveMapper: convert a DriveFile queue payload -> RawDocument.

The text arrives already extracted — Google-native docs were exported to plain
text and binaries were run through the same parsers that read uploads — so this
mapper does no parsing of its own. Its job is to preserve the provenance that
makes a citation useful: the file's name as the title and its webViewLink, so an
answer can point at the document a reader can actually open.
"""

import logging

from backend.python.schemas import RawDocument, QueuePayload
from .base import BaseMapper

logger = logging.getLogger(__name__)


class DriveMapper(BaseMapper):
    """Convert Google Drive file payloads into RawDocument."""

    def map(self, payload: QueuePayload) -> RawDocument:
        """
        Expected payload fields:
          - content: extracted plain text
          - author: file owner's display name
          - timestamp: file modifiedTime, ISO 8601
          - subject: file name
          - metadata: mime_type, url, size_bytes
        """
        try:
            content = self._extract_content(payload.content)
            author = self._extract_author(payload.author)
            timestamp = self._parse_timestamp(payload.timestamp)

            metadata = {
                **(payload.metadata or {}),
                "connector_id": payload.connector_id,
                "external_id": payload.external_id,
            }

            if payload.subject:
                metadata["title"] = payload.subject[:512]

            logger.debug(
                f"[DriveMapper] Mapped file {payload.raw_document_id} "
                f"({payload.subject}) owned by {author}"
            )

            return RawDocument(
                content=content,
                source="drive",
                author=author,
                timestamp=timestamp,
                metadata=metadata,
            )
        except Exception as e:
            logger.error(f"[DriveMapper] Failed to map payload: {e}")
            raise

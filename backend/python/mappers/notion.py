"""
NotionMapper: convert NotionPage staging row / QueuePayload -> RawDocument.
Maps Notion-specific fields (page properties, created/edited times) into metadata.
"""

import logging
from typing import Optional

from backend.python.schemas import RawDocument, QueuePayload
from .base import BaseMapper

logger = logging.getLogger(__name__)


class NotionMapper(BaseMapper):
    """Convert Notion page payloads into RawDocument."""

    def map(self, payload: QueuePayload) -> RawDocument:
        """
        Convert a Notion QueuePayload into RawDocument.

        Expected payload fields:
          - content: the page body/plaintext content
          - author: page creator or last editor
          - timestamp: page created or last edited time (ISO 8601 or Unix timestamp)
          - subject: page title (optional)
          - metadata: provider-specific fields (properties, created_time, last_edited_time, url, etc.)
        """
        try:
            # Extract core fields
            content = self._extract_content(payload.content)
            author = self._extract_author(payload.author)
            timestamp = self._parse_timestamp(payload.timestamp)

            # Build metadata with Notion-specific fields
            metadata = {
                **(payload.metadata or {}),
                "connector_id": payload.connector_id,
                "external_id": payload.external_id,
            }

            # Add title if present
            if payload.subject:
                metadata["title"] = payload.subject[:512]

            logger.debug(
                f"[NotionMapper] Mapped Notion page {payload.raw_document_id} "
                f"by {author} at {timestamp}"
            )

            return RawDocument(
                content=content,
                source="notion",
                author=author,
                timestamp=timestamp,
                metadata=metadata,
            )
        except Exception as e:
            logger.error(f"[NotionMapper] Failed to map payload: {e}")
            raise

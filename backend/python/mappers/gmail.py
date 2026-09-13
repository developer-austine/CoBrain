"""
GmailMapper: convert Email staging row / QueuePayload -> RawDocument.
Maps Gmail-specific fields (labels, thread ID, etc.) into metadata.
"""

import logging
from typing import Optional

from backend.python.schemas import RawDocument, QueuePayload
from .base import BaseMapper

logger = logging.getLogger(__name__)


class GmailMapper(BaseMapper):
    """Convert Gmail email payloads into RawDocument."""

    def map(self, payload: QueuePayload) -> RawDocument:
        """
        Convert a Gmail QueuePayload into RawDocument.

        Expected payload fields:
          - content: the email body text
          - author: the sender's email address or name
          - timestamp: email sent date (ISO 8601 or Unix timestamp)
          - subject: email subject (optional)
          - metadata: provider-specific fields (labels, thread_id, message_id, etc.)
        """
        try:
            # Extract core fields
            content = self._extract_content(payload.content)
            author = self._extract_author(payload.author)
            timestamp = self._parse_timestamp(payload.timestamp)

            # Build metadata with Gmail-specific fields
            metadata = {
                **(payload.metadata or {}),
                "connector_id": payload.connector_id,
                "external_id": payload.external_id,
            }

            # Add subject if present
            if payload.subject:
                metadata["subject"] = payload.subject[:512]

            logger.debug(
                f"[GmailMapper] Mapped email {payload.raw_document_id} "
                f"from {author} at {timestamp}"
            )

            return RawDocument(
                content=content,
                source="gmail",
                author=author,
                timestamp=timestamp,
                metadata=metadata,
            )
        except Exception as e:
            logger.error(f"[GmailMapper] Failed to map payload: {e}")
            raise

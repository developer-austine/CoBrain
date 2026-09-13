"""
CustomMapper: convert CustomDocument staging row / QueuePayload -> RawDocument.
Maps custom connector payloads into metadata.
"""

import logging
import json
from typing import Optional

from backend.python.schemas import RawDocument, QueuePayload
from .base import BaseMapper

logger = logging.getLogger(__name__)


class CustomMapper(BaseMapper):
    """Convert custom connector payloads into RawDocument."""

    def map(self, payload: QueuePayload) -> RawDocument:
        """
        Convert a Custom QueuePayload into RawDocument.

        Expected payload fields:
          - content: the document body (may be JSON, plain text, etc.)
          - author: document creator
          - timestamp: created or ingested date
          - subject: document title (optional)
          - metadata: provider-specific fields (content_type, file_type, etc.)
        """
        try:
            # Extract core fields
            content = self._extract_content(payload.content)

            # If content is a JSON string (from custom webhook), try to parse it
            if isinstance(content, str) and content.strip().startswith("{"):
                try:
                    parsed = json.loads(content)
                    # If it has a 'body' or 'text' field, use that as content
                    if isinstance(parsed, dict):
                        content = (
                            parsed.get("body")
                            or parsed.get("text")
                            or json.dumps(parsed, indent=2)
                        )
                except json.JSONDecodeError:
                    # Not valid JSON, keep as-is
                    pass

            author = self._extract_author(payload.author)
            timestamp = self._parse_timestamp(payload.timestamp)

            # Build metadata with custom-specific fields
            metadata = {
                **(payload.metadata or {}),
                "connector_id": payload.connector_id,
                "external_id": payload.external_id,
            }

            # Add title if present
            if payload.subject:
                metadata["title"] = payload.subject[:512]

            logger.debug(
                f"[CustomMapper] Mapped custom document {payload.raw_document_id} "
                f"by {author} at {timestamp}"
            )

            return RawDocument(
                content=content,
                source="custom",
                author=author,
                timestamp=timestamp,
                metadata=metadata,
            )
        except Exception as e:
            logger.error(f"[CustomMapper] Failed to map payload: {e}")
            raise

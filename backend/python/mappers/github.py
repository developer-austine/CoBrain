"""
GitHubMapper: convert GitHubItem staging row / QueuePayload -> RawDocument.
Maps GitHub-specific fields (repo, issue number, labels, PR status) into metadata.
"""

import logging
from typing import Optional

from backend.python.schemas import RawDocument, QueuePayload
from .base import BaseMapper

logger = logging.getLogger(__name__)


class GitHubMapper(BaseMapper):
    """Convert GitHub issue/PR payloads into RawDocument."""

    def map(self, payload: QueuePayload) -> RawDocument:
        """
        Convert a GitHub QueuePayload into RawDocument.

        Expected payload fields:
          - content: the issue/PR body and comments
          - author: the issue/PR creator
          - timestamp: created or last updated date
          - subject: issue/PR title (optional)
          - metadata: provider-specific fields (repo, issue_number, state, labels, pull_request, etc.)
        """
        try:
            # Extract core fields
            content = self._extract_content(payload.content)
            author = self._extract_author(payload.author)
            timestamp = self._parse_timestamp(payload.timestamp)

            # Build metadata with GitHub-specific fields
            metadata = {
                **(payload.metadata or {}),
                "connector_id": payload.connector_id,
                "external_id": payload.external_id,
            }

            # Add title if present
            if payload.subject:
                metadata["title"] = payload.subject[:512]

            logger.debug(
                f"[GitHubMapper] Mapped GitHub item {payload.raw_document_id} "
                f"by {author} at {timestamp}"
            )

            return RawDocument(
                content=content,
                source="github",
                author=author,
                timestamp=timestamp,
                metadata=metadata,
            )
        except Exception as e:
            logger.error(f"[GitHubMapper] Failed to map payload: {e}")
            raise

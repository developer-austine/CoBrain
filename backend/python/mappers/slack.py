"""
SlackMapper: convert a SlackMessage queue payload -> RawDocument.

Slack has no subject line, so the connector sends the channel as `subject`
("#engineering"). That is carried into metadata as the title because it is what
makes a retrieved snippet locatable — a message body alone rarely says where it
was said.

Thread position is preserved rather than flattened: `thread_ts` and `is_reply`
travel with the document so a retrieved answer can still be traced back to the
question it answered.
"""

import logging

from backend.python.schemas import RawDocument, QueuePayload
from .base import BaseMapper

logger = logging.getLogger(__name__)


class SlackMapper(BaseMapper):
    """Convert Slack message payloads into RawDocument."""

    def map(self, payload: QueuePayload) -> RawDocument:
        """
        Expected payload fields:
          - content: the message text
          - author: resolved display name (never the raw U0123 id)
          - timestamp: message post time, ISO 8601
          - subject: "#channel-name"
          - metadata: channel_id, channel_name, thread_ts, is_reply
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
                f"[SlackMapper] Mapped message {payload.raw_document_id} "
                f"by {author} in {payload.subject}"
            )

            return RawDocument(
                content=content,
                source="slack",
                author=author,
                timestamp=timestamp,
                metadata=metadata,
            )
        except Exception as e:
            logger.error(f"[SlackMapper] Failed to map payload: {e}")
            raise

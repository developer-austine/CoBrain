"""
BaseMapper: abstract base class for all source-specific mappers.
Defines the interface and shared helper functions.
"""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional
import logging

from backend.python.schemas import RawDocument, QueuePayload

logger = logging.getLogger(__name__)


class BaseMapper(ABC):
    """
    Abstract base for converting source-specific payloads into RawDocument.

    Every concrete mapper inherits from this and implements map(payload).
    This isolation means adding a new connector = adding one new mapper file,
    nothing else changes in the pipeline.
    """

    @abstractmethod
    def map(self, payload: QueuePayload) -> RawDocument:
        """
        Convert a QueuePayload (source-specific JSON) into a unified RawDocument.

        Args:
            payload: QueuePayload from the Redis queue

        Returns:
            RawDocument with consistent shape regardless of source
        """
        pass

    def _parse_timestamp(self, ts: Optional[str | int]) -> str:
        """
        Parse a timestamp from various formats into ISO 8601 UTC.

        Handles:
          - ISO 8601 strings: "2025-01-15T09:00:00Z"
          - Unix timestamps (seconds): 1705315200
          - Unix timestamps (milliseconds): 1705315200000
          - Other date strings: passed through (normaliser will clean up)
        """
        if not ts:
            return datetime.utcnow().isoformat() + "Z"

        if isinstance(ts, int):
            # Unix timestamp (detect seconds vs milliseconds)
            if ts > 1e11:  # > year 5138 in milliseconds = probably milliseconds
                ts_sec = ts / 1000
            else:
                ts_sec = ts
            return datetime.utcfromtimestamp(ts_sec).isoformat() + "Z"

        if isinstance(ts, str):
            # Already a string, assume it's ISO 8601 or close enough
            # Normaliser will clean it up
            if not ts.endswith("Z"):
                ts = ts + "Z"
            return ts

        return datetime.utcnow().isoformat() + "Z"

    def _extract_author(self, author: Optional[str]) -> str:
        """
        Extract a safe author name from various formats.
        Falls back to "Unknown" if not provided.
        """
        if not author or not author.strip():
            return "Unknown"
        # Simple cleanup: strip whitespace, cap at 256 chars
        return author.strip()[:256]

    def _extract_content(self, content: Optional[str | bytes]) -> str | bytes:
        """
        Extract content, ensuring it's non-empty.
        Returns string or bytes (normaliser will handle encoding detection).
        """
        if isinstance(content, bytes):
            return content
        if isinstance(content, str):
            return content
        if content is None:
            return ""
        return str(content)

    def _build_namespace(
        self,
        user_id: str,
        scope: Optional[str] = None,
    ) -> str:
        """
        Build the RBAC namespace from user ID and optional scope.
        Format: "userId:scope" or "userId" if no scope.

        This is SACRED — it flows all the way to Qdrant and is the RBAC boundary.
        """
        if not user_id:
            raise ValueError("user_id is required for namespace")
        if scope:
            return f"{user_id}:{scope}"
        return user_id

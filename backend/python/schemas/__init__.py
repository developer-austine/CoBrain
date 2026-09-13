"""
Data contract schemas for the Company Brain pipeline.
These are the interfaces that connect all pipeline components.
"""

from .raw_document import RawDocument
from .normalised_document import NormalisedDocument
from .chunk import Chunk
from .queue_payload import QueuePayload

__all__ = [
    "RawDocument",
    "NormalisedDocument",
    "Chunk",
    "QueuePayload",
]

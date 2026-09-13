"""
Mappers: convert source-specific payloads into the unified RawDocument shape.
Each source (Gmail, Notion, GitHub, Slack, Drive, Custom, Brain) has its own mapper.
"""

from .base import BaseMapper
from .gmail import GmailMapper
from .notion import NotionMapper
from .github import GitHubMapper
from .custom import CustomMapper
from .brain import BrainMapper
from .upload import UploadMapper
from .slack import SlackMapper
from .drive import DriveMapper

MAPPER_REGISTRY = {
    "gmail": GmailMapper(),
    "notion": NotionMapper(),
    "github": GitHubMapper(),
    "custom": CustomMapper(),
    "brain": BrainMapper(),
    "upload": UploadMapper(),
    "slack": SlackMapper(),
    "drive": DriveMapper(),
}


def get_mapper(source: str) -> BaseMapper:
    """Get the mapper for a given source."""
    mapper = MAPPER_REGISTRY.get(source)
    if mapper is None:
        raise ValueError(f"No mapper registered for source: {source}")
    return mapper


__all__ = [
    "BaseMapper",
    "GmailMapper",
    "NotionMapper",
    "GitHubMapper",
    "CustomMapper",
    "BrainMapper",
    "UploadMapper",
    "SlackMapper",
    "DriveMapper",
    "get_mapper",
    "MAPPER_REGISTRY",
]

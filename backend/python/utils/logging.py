"""
Structured logging configuration (used everywhere).
Supports both JSON and text formats.
"""

import logging
import json

from backend.python.config import LOG_LEVEL, LOG_FORMAT

try:
    from pythonjsonlogger import jsonlogger
    HAS_JSON_LOGGER = True
except ImportError:
    HAS_JSON_LOGGER = False


def setup_logging():
    """Configure structured logging for the entire backend."""
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))

    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Create console handler
    handler = logging.StreamHandler()

    if LOG_FORMAT == "json" and HAS_JSON_LOGGER:
        # JSON format for structured logging
        formatter = jsonlogger.JsonFormatter(
            "%(timestamp)s %(level)s %(name)s %(message)s %(exc_info)s"
        )
    else:
        # Simple text format (fallback if JSON logger not available)
        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
        )

    handler.setFormatter(formatter)
    root_logger.addHandler(handler)


def get_logger(name: str) -> logging.Logger:
    """Get a logger instance with a given name."""
    return logging.getLogger(name)

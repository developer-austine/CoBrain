"""
Small shared text utilities for the pipeline.
"""

import re


def normalize_whitespace(text: str) -> str:
    """
    Normalise whitespace: collapse multiple spaces, trim lines.
    """
    # Collapse multiple spaces into single space
    text = re.sub(r" +", " ", text)
    # Collapse multiple newlines into double newline
    text = re.sub(r"\n\n+", "\n\n", text)
    # Trim each line
    lines = text.split("\n")
    lines = [line.strip() for line in lines]
    return "\n".join(lines).strip()


def truncate(text: str, max_length: int = 256, suffix: str = "...") -> str:
    """
    Truncate text to max_length, adding suffix if truncated.
    """
    if len(text) <= max_length:
        return text
    return text[:max_length - len(suffix)] + suffix

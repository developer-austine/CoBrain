from __future__ import annotations

import re
import hashlib
import uuid
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# Configuration Layer

CHUNK_CHARS: int = 2048
OVERLAP_CHARS: int = int(CHUNK_CHARS * 0.20) # 409
MIN_CHUNK_CHARS: int = 64
_SEPARATORS: list[str] = [
    "\n\n",
    "\n",
    ". ",
    "? ",
    "! ",
    "; ",
    ", ",
    " ",
    "",
]

# DataClasses Dcaration 

@dataclass
class Chunk:
    chunk_id: str
    doc_id: str
    chunk_index: int
    total_chunks: int
    text: str
    char_start: int
    char_end: int
    word_count: int
    metadata: dict = field(default_factory=dict)

# Core Recursive Splitter

def _split_text(text: str, separators: list[str]) -> list[str]:
    if len(text) <= CHUNK_CHARS:
        return [text] if text.strip() else []
    
    chosen_sep = ""
    remaining_seps = []
    for i, sep in enumerate(separators):
        if sep == "" or sep in text:
            chosen_sep = sep
            remaining_seps = separators[i + 1:]
            break  # take the FIRST (coarsest) separator present, not the last

    if chosen_sep:
        raw_parts = text.split(chosen_sep)
        parts = []
        for j, part in enumerate(raw_parts):
            if j < len(raw_parts) - 1 and chosen_sep.strip():
                parts.append(part + chosen_sep)
            else:
                parts.append(part)
    else:
        # character level fallback: hard split at CHUNK_CHARS
        parts = [text[i:i + CHUNK_CHARS] for i in range(0, len(text), CHUNK_CHARS)]

    # Greedy packing: merge adjacent parts until adding the next would exceed limit
    segements: list[str] = []
    current = ""

    for part in parts:
        if not part.strip():
            continue

        if len(part) > CHUNK_CHARS:
            if current.strip():
                segements.append(current.strip())
                current = ""
            sub_segments = _split_text(part, remaining_seps)
            segements.extend(sub_segments)
            continue

        candidate = (current + chosen_sep + part) if current else part
        if len(candidate) <= CHUNK_CHARS:
            current = candidate
        else:
            if current.strip():
                segements.append(current.strip())
            current = part

    if current.strip():
        segements.append(current.strip())

    return segements


def _add_overlap(segments: list[str]) -> list[str]:
    if len(segments) <= 1:
        return segments
    
    overlapped: list[str] = [segments[0]]
    for i in range(1, len(segments)):
        prev_tail = segments[i - 1][-OVERLAP_CHARS:]  # slice, not single-char index
        if not segments[i].startswith(prev_tail.strip()):
            overlapped.append(prev_tail + "\n...\n" + segments[i])
        else:
            overlapped.append(segments[i])

    return overlapped


def _chunk_id(doc_id: str, chunk_index: int) -> str:
    # Deterministic UUID (uuid5) — Qdrant point IDs must be a UUID or an
    # unsigned int, and determinism keeps re-ingestion idempotent.
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{doc_id}:{chunk_index}"))


# Public API

def chunk(
        text: str,
        doc_id: str,
        metadata: Optional[dict] = None,
) -> list[Chunk]:
    if not doc_id:
        raise ValueError("doc_id mut be a non_empty string")
    
    text = text.strip()
    if not text:
        logger.warning("[Chunker] Empty text for doc_id=%s - returning no chunks", doc_id)
        return []
    
    meta = metadata or {}

    # Revursive Split
    segments = _split_text(text, _SEPARATORS)

    # Drop underized segments (merge into the previous)
    merged: list[str] = []
    carry = ""
    for seg in segments:
        combined =(carry + " " + seg).strip() if carry else seg
        if len(combined) < MIN_CHUNK_CHARS and seg != segments[-1]:
            carry = combined
        else:
            if carry:
                combined = (carry + " " + seg).strip()
                carry = ""
            merged.append(combined)
    if carry:
        if merged:
            merged[-1] = (merged[-1] + " " + carry).strip()
        else:
            merged.append(carry)

    # Adding Overlap
    overlapped = _add_overlap(merged)

    # Build the chunking object
    total = len(overlapped)
    chunks: list[chunk] = []
    search_from = 0

    for idx, chunk_text in enumerate(overlapped):
        core = chunk_text.split("\n...\n")[-1] if "\n...\n" in chunk_text else chunk_text
        core_start_in_original = text.find(core[:64].strip(), search_from)
        if core_start_in_original == -1:
            core_start_in_original = search_from

        char_start = core_start_in_original
        char_end = min(char_start + len(chunk_text), len(text))
        search_from = char_start + len(core) // 2 # Advance for next search

        chunks.append(Chunk(
            chunk_id=_chunk_id(doc_id, idx),
            doc_id=doc_id,
            chunk_index=idx,
            total_chunks=total,
            text=chunk_text,
            char_start=char_start,
            char_end=char_end,
            word_count=len(chunk_text.split()),
            metadata={**meta, "chunk_index": idx, "total_chunks": total},
        ))

    logger.info(
        "[chunker] doc_id=%s -> %d chunks (avg %.0f chars)",
        doc_id,
        len(chunks),
        sum(len(c.text) for c in chunks) / max(len(chunks), 1),
    )

    return chunks

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    # SAMPLE = """
    # The Company Brain ingestion pipeline is responsible for transforming raw,
    # unstructured company data into clean, semantically indexed knowledge.
 
    # Every connector agent authenticates with its source system using OAuth 2.0,
    # fetches new or changed documents incrementally using a cursor stored in
    # Postgres, and pushes raw documents onto a Redis queue for the normalisation
    # worker.
 
    # The normalisation worker runs five sequential stages. First, it detects and
    # converts the document encoding to clean UTF-8 using chardet. Second, it
    # repairs common OCR artefacts — zero/O confusion, rn/m substitution, pipe
    # characters used as I. Third, it normalises all dates to ISO-8601 format and
    # computes an epoch-days integer for range filtering in the vector store.
    # Fourth, it strips control characters, collapses whitespace, and validates
    # minimum length. Fifth, it computes BM25 term weights for hybrid search.
 
    # After normalisation, the document passes through PII scrubbing. spaCy NER
    # detects person names, locations, and organisations. Presidio detects email
    # addresses, phone numbers, credit card numbers, social security numbers, and
    # IBAN codes. Custom regex patterns catch API keys, bearer tokens, and password
    # values. All detected entities are replaced with stable pseudonymisation
    # tokens, and the token-to-original mapping is written to a restricted Postgres
    # table inaccessible to the AI layer.
 
    # The chunker then splits the cleaned, masked text into overlapping windows of
    # approximately 512 tokens with 20% overlap. Each chunk becomes a point in the
    # Qdrant vector store, with its metadata payload carrying the source, author,
    # timestamp, and RBAC namespace for filtered retrieval.
    # """ * 3


    # result = chunk(SAMPLE, doc_id="test-doc-001", metadata={
    #     "source": "notion",
    #     "author": "user_001",
    #     "timestamp_iso": "2025-01-15T09:00:00",
    #     "namespace": "org_1:analyst",
    # })
 
    # print(f"\n=== {len(result)} chunks ===\n")
    # for c in result:
    #     print(f"[{c.chunk_index}/{c.total_chunks - 1}] id={c.chunk_id} "
    #           f"chars={c.char_start}–{c.char_end} words={c.word_count}")
    #     print(f"  preview: {c.text[:120].replace(chr(10), ' ')}…")
    #     print()
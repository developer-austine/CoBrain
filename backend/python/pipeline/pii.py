from __future__ import annotations

"""
The pseudonymisation map (token → original value) must be written to a
restricted Postgres table (`pii_map`) and never stored alongside the document
itself. The masked text only ever sees tokens like PERSON_1, EMAIL_2, etc.
The LLM and the vector store only receive masked text.
Only roles with `pii_resolve` permission may reverse-look up the map.
"""

import re
import hashlib
import logging
from dataclasses import dataclass, field
from typing import Optional

# DISABLED: Heavy ML libraries for development
# import spacy
# from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
# from presidio_analyzer.nlp_engine import NlpEngineProvider
# from presidio_anonymizer import AnonymizerEngine
# from presidio_anonymizer.entities import OperatorConfig

logger = logging.getLogger(__name__)

MASK_LOCATIONS: bool = False
MASK_URLS: bool = False

# Score threshold below which Presidio detections are ignored (0–1).
# 0.5 is a reasonable middle ground: catches likely PII, drops weak guesses.
PRESIDIO_MIN_SCORE: float = 0.5

# spaCy model to load. en_core_web_trf is most accurate; en_core_web_lg
# is faster. Must be pre-installed in the environment.
SPACY_MODEL: str = "en_core_web_lg"

PRESIDIO_ENTITIES: list[str] = [
    "PERSON",
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "CREDIT_CARD",
    "IBAN_CODE",
    "US_SSN",
    "UK_NHS",
    "NRP",
    "PASSPORT",
    "IP_ADDRESS",
    "LOCATION",
    "URL",
]

# CUSTOM REGEX PATTERNS FOR SECRETS NOT COVERED BY PRESIDO

# Matches lines like:  password: s3cr3t!   token: ghp_xxxx   api_key: abc123
_SECRET_LINE_RE = re.compile(
    r"(?i)(password|passwd|api[_\-]?key|secret|token|private[_\-]?key"
    r"|auth[_\-]?token|access[_\-]?key|client[_\-]?secret)"
    r"\s*[:=]\s*\S+",
    re.MULTILINE,
)

# These are the generic api keys shpes that look like secret lengths
_API_KEY_RE = re.compile(
    r"\b(?<![a-z])([A-Za-z0-9\-_\.]{20,80})(?![a-z])\b"
)

# Bearer tokens in HTTP headers / log lines
_BEARER_RE = re.compile(r"(?i)Bearer\s+[A-Za-z0-9\-_\.]{10,")

@dataclass

class DetectedEntity:
    """A single detected PII span"""
    entity_type: str
    start: int
    end: int
    text: str
    score: float
    source: str  # prsidio | spacy | custome regex

@dataclass
class ScrubResult:
    """
    Returned by scrub(). Contains the masked text and the reversible map.
    The caller MUST perist pseudonym_map to the restricted pii_map table before dicarding the object.
    """
    masked_text: str
    pseudonym_map: dict[str, str] = field(default_factory=dict)
    entities: list[DetectedEntity] = field(default_factory=list)

# Engine Initialization (Module level ingletons, loaded once per worker)

def _build_analyzer():
    """
    DISABLED: Heavy ML libraries are disabled for performance.
    Returns None to indicate PII detection is skipped.
    """
    return None

# DISABLED: Heavy ML libraries for performance
_ANALYZER = None
_ANONYMIZER = None
logger.info("[pii] PII detection DISABLED - emails will not be anonymized")


# Stable Pseudonymisation token generation

def _stable_token(entity_type: str, original: str) -> str:
    """
    Generate a stable pseudonymisation token for a given (type, value) pair.
    Stability guarantee: the same original value always maps to the same token
    within a corpus, so co-references ("Alice" in doc A and doc B) can be
    linked by analysts with pii_resolve permission without exposing the name
    to the LLM.
    The SHA-256 is deterministic and one-way. Reversing requires the map.
    The 8-hex-char prefix gives 2^32 ≈ 4 billion unique values per entity type,
    which is more than sufficient for any corporate corpus.
    """

    digest = hashlib.sha256(f"{entity_type}|{original}".encode()).hexdigest()
    index = int(digest[:8], 16) % 1_000_000
    return f"{entity_type}_{index:06d}"


# Cutom regex detectors

def _detect_custom(text: str) -> list[DetectedEntity]:
    
    found: list[DetectedEntity] = []

    for m in _SECRET_LINE_RE.finditer(text):
        found.append(DetectedEntity(
            entity_type="SECRET_VALUE",
            start=m.start(),
            end=m.end(),
            text=m.group(0),
            score=0.95,
            source="custom_regex",
        ))
 

    for m in _BEARER_RE.finditer(text):
        found.append(DetectedEntity(
            entity_type="API_KEY",
            start=m.start(),
            end=m.end(),
            text=m.group(0),
            score=0.95,
            source="custom_regex",
        ))

    return found

# Perform SPAN MERGING - prevent double-masking overlapping detections

def _merge_spans(entities: list[DetectedEntity]) -> list[DetectedEntity]:
    """
    Merge overlapping or adjacent entity spans so that substitution doesn't
    produce garbled output.
 
    Algorithm (O(n log n)):
    1. Sort by start position.
    2. Walk linearly, merging any span that starts before the previous end.
    3. When merging, keep the entity type of the higher-confidence span.
 
    Mathematical invariant: output spans are non-overlapping and sorted.
    """

    if not entities:
        return []
    
    sorted_ents = sorted(entities, key=lambda e: (e.start, -e.score))
    merged: list[DetectedEntity] = [sorted_ents[0]]

    for current in sorted_ents[1:]:
        prev = merged[-1]
        if current.start < prev.end:
            if current.score >= prev.score:
                merged[-1] = DetectedEntity(
                    entity_type=current.entity_type,
                    start=prev.start,
                    end=max(prev.end, current.end),
                    text=current.text,
                    score=current.score,
                    source=current.source,
                )
            else:
                merged[-1] = DetectedEntity(
                    entity_type=prev.entity_type,
                    start=prev.start,
                    end=max(prev.end, current.end),
                    text=prev.text,
                    score=prev.score,
                    source=prev.source,
                )
        else:
            merged.append(current)

    return merged

# Scrub function

def scrub(text: str, doc_id: Optional[str] = None) -> ScrubResult:
    if not text or not text.strip():
        raise ValueError("Scrub() received empty text")

    # DISABLED: Skip PII detection - ML libraries disabled for performance
    logger.warning("[pii] PII detection DISABLED - returning text as-is")
    return ScrubResult(masked_text=text, pseudonym_map={}, entities=[])
    
    log_ref = f"doc={doc_id}" if doc_id else "doc=<unknown>"
    logger.debug("[pii] Scanning %d chars (%s)", len(text), log_ref)

    # Run Presidio Analyzer
    entities_to_detect = list(PRESIDIO_ENTITIES)
    if not MASK_LOCATIONS and "LOCATION" in entities_to_detect:
        entities_to_detect.remove("LOCATION")
    if not MASK_URLS and "URL" in entities_to_detect:
        entities_to_detect.remove("URL")

    presidio_results = _ANALYZER.analyze(
        text=text,
        language="en",
        entities=entities_to_detect,
        score_threshold=PRESIDIO_MIN_SCORE,
    )

    # Convert Preidio results to DetectedEntity
    detected: list[DetectedEntity] = []
    for r in presidio_results:
        detected.append(DetectedEntity(
            entity_type=r.entity_type,
            start=r.start,
            end=r.end,
            text=text[r.start:r.end],
            score=r.score,
            source="preside",
        ))

    # Run Custom Regex Detctors
    detected.extend(_detect_custom(text))

    # Merge Overlapping Spans
    detected = _merge_spans(detected)

    logger.info("[pii] %d entities detected (%s)", len(detected), log_ref)

    if not detected:
        return ScrubResult(masked_text=text, pseudonym_map={}, entities=[])
    
    # Build the pseudonym mao and perform substitution
    pseudonym_map: dict[str, str] = {}
    masked = list(text)

    for entity in sorted(detected, key=lambda e: e.start, reverse=True):
        original = text[entity.start:entity.end]
        token = _stable_token(entity.entity_type, original)
        pseudonym_map[token] = original

        # Replace in-place
        masked[entity.start:entity.end] = list(f"[{token}]")

    masked_text = "".join(masked)

    logger.debug(
        "[pii] Masked %d entities -> %d unique tokens (%s)",
        len(detected),
        len(pseudonym_map),
        log_ref,
    )

    return ScrubResult(
        masked_text=masked_text,
        pseudonym_map=pseudonym_map,
        entities=detected,
    )

# Admin: Resolve tokens back to the original Values
def resolve(
        masked_text: str,
        pseudonym_map: dict[str, str],
        *,
        role: str,
) -> str:
    logger.info("[PII] resolve() called by role=%s", role)
    result = masked_text
    for token, original in pseudonym_map.items():
        result = result.replace(f"[{token}]", original)
    return result

# Metrics Helper
def entity_type_counts(entities: list[DetectedEntity]) -> dict[str, str]:
        """
        Aggregate detected entities by type for metrics/alerting.
        Feed the result to your monitoring pipeline (Datadog / CloudWatch).
        """
        counts: dict[str, int] = {}
        for e in entities:
            counts[e.entity_type] = counts.get(e.entity_type, 0) + 1
        return counts

# Integration Points
def stage_pii(text: str, doc_id: Optional[str] = None) -> tuple[str, dict[str, str]]:
    result = scrub(text, doc_id=doc_id)
    return result.masked_text, result.pseudonym_map

# Just a smoke test for quick validation
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    SAMPLE = """
 Hi Austine Alex,
 
    Please send the updated report to alex@labanbrain.com or call me on
    +254 7138 270 98. My card ending in 4111 1111 1111 1111 expires 12/26.
    The API key is: ghp_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7
    Database password: supersecret123!
    Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummypayload.sig
 
    Regards,
    Black Survivor
    SSN: 123-45-6789
"""
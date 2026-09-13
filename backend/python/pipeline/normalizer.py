from __future__ import annotations

import re
import math
import hashlib
import unicodedata
import struct
import logging
from dataclasses import dataclass, field
from datetime import datetime, date
from typing import Optional

import chardet
import numpy as np
from dateutil import parser as dateutil_parser

logger = logging.getLogger(__name__)

@dataclass
class RawDocument:
    """Input: Whatever comes off the connector agent"""
    content: bytes | str
    source: str
    author: str
    timestamp: str
    metadata: dict = field(default_factory=dict)

@dataclass
class NormalisedDocument:
    """Output: clean, consistent, ready for chunking and embedding"""
    content: str            # Clean UTF-8 text
    source: str
    author: str
    timestamp_iso: str
    timestamp_epoch: int
    word_count: int
    bm25_lengths: dict      # {token: normalised_bm25_weight}
    content_hash: str       # SHA-256 of clean content
    minhash_sig: list[int]  #125 minHash value for dedup
    metadata: dict = field(default_factory=dict)

# Encoding Detection and unicode NFC normalization

_ERA_ENCODING_MAP = {
    "email": "windows-1252",
    "drive": "latin-1",
    "notion": "utf-8",
    "slack": "utf-8",
    "jira": "utf-8",
}

_WIN1252_FIXES = str.maketrans({
     "\x80": "€", "\x82": "‚", "\x83": "ƒ", "\x84": "„",
    "\x85": "…", "\x86": "†", "\x87": "‡", "\x88": "ˆ",
    "\x89": "‰", "\x8a": "Š", "\x8b": "‹", "\x8c": "Œ",
    "\x91": "\u2018", "\x92": "\u2019",   # smart quotes
    "\x93": "\u201c", "\x94": "\u201d",   # smart double quotes
    "\x96": "–", "\x97": "—",             # en/em dash
    "\x99": "™", "\xa9": "©", "\xae": "®",
})

def _decode_bytes(raw: bytes, source: str) -> str:
    detected = chardet.detect(raw)
    ecoding = detected['encoding'] or _ERA_ENCODING_MAP.get(source, 'utf-8')
    confidence = detected.get('confidence', 0.0)

    if confidence < 0.7:
        encoding = _ERA_ENCODING_MAP.get(source, 'utf-8')
        logger.debug(f"Low confidence ({confidence:.2f}) for detected encoding '{detected['encoding']}' on source '{source}'. Falling back to '{encoding}'.")
    
    try:
        text = raw.decode(ecoding, errors='replace')
    except (LookupError, UnicodeDecodeError):
        text = raw.decode('utf-8', errors='replace')

    return text

def _unicode_nfc(text: str) -> str:
     """
    Unicode NFC normalisation.

    Mathematics:
        NFD(s)  = canonical decomposition (é → e + U+0301)
        NFC(s)  = NFD followed by canonical composition (e + U+0301 → é)

    Why: Two documents with visually identical text can have different byte
    sequences if one uses precomposed characters (NFC) and one uses
    decomposed sequences (NFD). SHA-256 dedup and exact-match search would
    treat them as different. NFC collapses all representations to one.
    """
     
     text = text.translate(_WIN1252_FIXES)
     return unicodedata.normalize('NFC', text)

def stage1_encoding(raw: RawDocument) -> str:
    """Return clean, NFC-normalised Unicode string."""
    if isinstance(raw.content, bytes):
        text = _decode_bytes(raw.content, raw.source)
    else:
        text = raw.content
    return _unicode_nfc(text)

# OCR artefact Correction Logic

_OCR_CONFUSION = [
     (r"\b0([A-Za-z])",  r"O\1"),    # 0peration → Operation
    (r"([A-Za-z])0\b",  r"\1O"),     # fOO0 → fOOO
    (r"\bl\b",           "I"),       # standalone l → I (pronoun)
    (r"\brn\b",          "m"),       # rn → m  (serif OCR artefact)
    (r"(\w)rn(\w)",      r"\1m\2"),  # "arnount" → "amount"
    (r"\bvv\b",          "w"),       # vv → w
    (r"(\w)vv(\w)",      r"\1w\2"),
    (r"\|",              "I"),       # pipe → I (common in OCR)
    (r"(?<=[a-z])1(?=[a-z])", "l"), # rea1ly → really
    (r"(?<=[A-Z])1(?=[A-Z])", "I"), # GOD1 → GODI
    (r"(?<=\d),(?=\d{3})", ""), 
]

_OCR_PATTERN = [(re.compile(p), r) for p, r in _OCR_CONFUSION]

def stage2_ocr_repair(text: str) -> str:
    for pattern, replacement in _OCR_PATTERN:
        text = pattern.sub(replacement, text)
    return text

# Temporal Normalization

_DATE_PATTERNS = [
     # ISO 8601 variants
    (r"\b(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})\b",    "%Y-%m-%dT%H:%M:%S"),
    (r"\b(\d{4})-(\d{2})-(\d{2})\b",                          "%Y-%m-%d"),
    # Full written dates (common in formal memos 1950-1980)
    (r"\b(\d{1,2})\s+(January|February|March|April|May|June|"
     r"July|August|September|October|November|December),?\s+(\d{2,4})\b", "DMY_FULL"),
    (r"\b(January|February|March|April|May|June|July|August|"
     r"September|October|November|December)\s+(\d{1,2}),?\s+(\d{2,4})\b", "MDY_FULL"),
    # Numeric formats — ambiguous, resolved by era heuristic
    (r"\b(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{2,4})\b",       "NUMERIC_AMBIGUOUS"),
]

_MONTHS = {
    "january":1,"february":2,"march":3,"april":4,"may":5,"june":6,
    "july":7,"august":8,"september":9,"october":10,"november":11,"december":12
}

_EPOCH = date(1970, 1, 1)

def _two_digit_year(yy: int, doc_era: int = 2000) -> int:
     """
    Resolve a 2-digit year.

    Mathematics:
        For documents from 1950-1999 era, 50 → 1950, 99 → 1999, 00 → 2000.
        For documents from 2000+ era, 00 → 2000, 24 → 2024.

        Rule: if yy >= 50 and doc_era < 2000 → 1900 + yy
              else if yy >= 50               → 1900 + yy  (historical)
              else                           → 2000 + yy
    """
     
     if yy >= 50:
         return 1900 + yy
     return 2000 + yy

def _parse_date(text: str, doc_era: int = 2000) -> Optional[datetime]:
   
    text = text.strip()
    try:
        dt = dateutil_parser.parse(
            text,
            dayfirst=(doc_era < 1990),
            yearfirst=False,
            default=datetime(doc_era, 1, 1)
        )
        # Sanity check: date must be between 1900 and 2030
        if 1900 <= dt.year <= 2030:
            return dt
    except (ValueError, OverflowError):
        pass
    return None

def _to_epoch_days(dt: datetime) -> int:
    """
    Convert datetime to integer days since Unix epoch (1970-01-01).

    Range: 1950-01-01 → -7305 days, 2024-12-31 → 20088 days
    """

    delta = dt.date() - _EPOCH
    return delta.days

def stage3_temporal(text: str, doc_era: int = 2000) -> tuple[tsr, str, int]:
    primary_dt: Optional[datetime] = None
    result = text

    def replace_date(match):
        nonlocal primary_dt
        raw = match.group(0)
        dt = _parse_date(raw, doc_era)
        if dt is None:
            return raw
        if primary_dt is None:
            primary_dt = dt
        return dt.strftime("%Y-%m-%d")
    
    date_re = re.compile(
         r"\b\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}\b"
        r"|\b\d{4}[/\-\.]\d{2}[/\-\.]\d{2}\b"
        r"|\b(?:January|February|March|April|May|June|July|August|"
        r"September|October|November|December)"
        r"[,\s]+\d{1,2}[,\s]+\d{2,4}\b",
        re.IGNORECASE
    )
    result = date_re.sub(replace_date, result)

    if primary_dt is not None:
        iso = primary_dt.strftime("%Y-%m-%dT%H:%M:%S")
        epoch = _to_epoch_days(primary_dt)
    else:
        iso = f"{doc_era}-01-01T00:00:00"
        epoch = _to_epoch_days(datetime(doc_era, 1, 1))

    return result, iso, epoch

# Text Surface Cleaning 

_CTRL_CHARS    = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_MULTI_SPACE   = re.compile(r"[ \t]{2,}")
_MULTI_NEWLINE = re.compile(r"\n{3,}")
_SOFT_HYPHEN   = re.compile(r"\xad")
_PAGE_BREAK    = re.compile(r"\f|\x0c")

def stage4_surface_clean(text: str, preserve_formatting: bool = False) -> str:
     """
    Remove noise that is meaningless in semantic search.

    Mathematical invariant: |tokens(output)| < |tokens(input)|
    We never add content, only remove noise.

    preserve_formatting: keep runs of spaces, tabs and blank lines intact.
    Required for source code, where whitespace is not noise — collapsing it
    flattens every indent level, which silently changes what Python code MEANS
    and makes any language unreadable when displayed back to the user.
    """
     text = _CTRL_CHARS.sub(" ", text)
     text = _SOFT_HYPHEN.sub("", text)
     text = _PAGE_BREAK.sub("\n\n", text)
     if not preserve_formatting:
         text = _MULTI_SPACE.sub(" ", text)
         text = _MULTI_NEWLINE.sub("\n\n", text)
         text = text.strip()
     else:
         # Only trim the document's outer edges; interior layout is content.
         text = text.strip("\n")

     if len(text) < 10:
         raise ValueError(f"Document too short after cleaning: {len(text)} chars")

     return text


class BM25Scorer:
    """
    For query term t in document d across corpus D of N documents:

        IDF(t) = log( (N − df(t) + 0.5) / (df(t) + 0.5) + 1 )

        BM25(t,d) = IDF(t) × [ tf(t,d) × (k₁ + 1) ]
                              ─────────────────────────────────────────
                              [ tf(t,d) + k₁ × (1 − b + b × |d| / dl̄) ]

    where:
        tf(t,d)  = raw term frequency of t in d
        df(t)    = number of documents containing t
        N        = total number of documents
        |d|      = number of tokens in d
        dl̄       = average document length across all d in D
        k₁ = 1.5 (saturation: diminishing returns for repeated terms)
        b  = 0.75 (length normalisation: 1.0 = full, 0.0 = none)
    """

    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b  = b
        self.N:       int   = 0
        self.df:      dict  = {}
        self.avg_dl:  float = 0.0
        self._total_tokens: int = 0

    def index_document(self, tokens: list[str]) -> None:
        """Update corpus statistics with a new document."""
        self.N += 1
        self._total_tokens += len(tokens)
        self.avg_dl = self._total_tokens / self.N
        for token in set(tokens):
            self.df[token] = self.df.get(token, 0) + 1

    def idf(self, token: str) -> float:
        """
        Inverse Document Frequency.
        Robertson-Sparck Jones IDF with smoothing to handle unseen terms.
        """
        df_t = self.df.get(token, 0)
        return math.log((self.N - df_t + 0.5) / (df_t + 0.5) + 1.0)

    def score_tokens(self, tokens: list[str]) -> dict[str, float]:
        doc_len  = len(tokens)
        tf_map   = {}
        for t in tokens:
            tf_map[t] = tf_map.get(t, 0) + 1

        scores = {}
        for token, tf in tf_map.items():
            idf_val = self.idf(token)
            numerator   = tf * (self.k1 + 1)
            denominator = tf + self.k1 * (1 - self.b + self.b * doc_len / max(self.avg_dl, 1))
            scores[token] = idf_val * (numerator / denominator)

        return scores


# Module-level singleton — loaded from disk if pre-computed on corpus
_bm25 = BM25Scorer(k1=1.5, b=0.75)

def stage5_bm25(text: str) -> dict[str, float]:
    """Tokenise and return BM25-weighted token scores."""
    tokens = re.findall(r"\b[a-z]{2,}\b", text.lower())
    _bm25.index_document(tokens)
    return _bm25.score_tokens(tokens)


_CPI = {
    1950: 5.7,  1960: 7.5,  1970: 10.4, 1980: 29.0, 1990: 53.4,
    2000: 72.8, 2010: 92.4, 2015: 100.0,2020: 108.9, 2024: 128.3
}

def _nearest_cpi(year: int) -> float:
    """Get the nearest CPI value for a given year."""
    closest = min(_CPI.keys(), key=lambda y: abs(y - year))
    return _CPI[closest]

def cpi_adjust(amount: float, from_year: int, to_year: int = 2024) -> float:
    """
    Adjust a monetary amount for inflation using CPI.

    adjusted = amount × (CPI_target / CPI_source)

    £1,000 in 1960 → £1,000 × (128.3 / 7.5) = £17,107 in 2024 terms
    """

    cpi_from = _nearest_cpi(from_year)
    cpi_to = _nearest_cpi(to_year)
    return amount * (cpi_to / cpi_from)

def z_score_normalise(values: list[float]) -> list[float]:
    """
    Z-score (standard score) normalisation.

      μ  = (1/n) Σ xᵢ                    (mean)
        σ  = √( (1/n) Σ (xᵢ − μ)² )       (standard deviation)
        x̂ᵢ = (xᵢ − μ) / σ                 (z-score)

    Result: values with μ=0, σ=1. Outliers preserved but bounded.
    Use for: numerical features fed into the TFT forecast model.
    """

    if not values:
        return []
    arr = np.array(values, dtype=np.float64)
    mu = arr.mean()
    sigma = arr.std()
    if sigma < 1e-10:
        return [0.0] * len(values)
    return ((arr - mu) / sigma).tolist()

def minmax_normalise(values: list[float]) -> list[float]:
     """
    Min-Max normalisation.

        x̂ᵢ = (xᵢ − x_min) / (x_max − x_min)

    Result: all values in [0, 1]. Outliers compress the range.
    Use for: sentiment scores, document length ratios, confidence values.
    """
     
     if not values:
         return []
     arr = np.array(values, dtype=np.float64)
     xmin = arr.min()
     xmax = arr.max()
     if abs(xmax - xmin) < 1e-10:
         return [0.5] * len(values)
     return ((arr - xmin) / (xmax - xmin)).tolist()

# PERFORM VECTOR NORMALIZATION

def l2_normalise(vector: np.ndarray) -> np.ndarray:
     """
    L2 (Euclidean) normalisation — project onto unit hypersphere.

        ‖v‖₂ = √(v₁² + v₂² + ... + v_n²)       (L2 norm / Euclidean length)
        v̂    = v / ‖v‖₂                          (unit vector)

    Property: ‖v̂‖₂ = 1 for all v̂

    Why critical for Qdrant cosine search:
        Cosine similarity = (A · B) / (‖A‖₂ × ‖B‖₂)

        If vectors are already L2-normalised (‖A‖₂ = ‖B‖₂ = 1), then:
        cosine_similarity = A · B  (dot product is enough, no division needed)

        Qdrant's cosine index exploits this — pre-normalising means Qdrant
        uses the faster dot-product HNSW index internally.

    Without L2 normalisation:
        A 3,000-word memo has ‖v_memo‖₂ >> ‖v_slack‖₂
        → the memo appears closer to every query vector regardless of
          semantic content, because its raw magnitude dominates.
    """
     
     norm = np.linalg.norm(vector)
     if norm < 1e-10:
         logger.warning("Near-Zero Vetcor encountered - returnning zero vector")
         return vector
     return vector / norm

def l2_normalise_batch(matrix: np.ndarray) -> np.ndarray:
    """
    L2-normalise a batch of vectors efficiently.

    Mathematics:
        For matrix V of shape (N, D):
        norms = ‖vᵢ‖₂  for each row i     (shape: N,)
        V̂    = V / norms[:, np.newaxis]    (broadcast division)

    Faster than looping — uses NumPy BLAS routines.
    """

    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms = np.where(norms < 1e-10, 1.0, norms)
    return matrix / norms

# MinHash near-duplicate detection

_MINHASH_NUM_HASHES = 128
_MINHASH_SHINGLE_K  = 3
_LARGE_PRIME        = (1 << 61) - 1
_MAX_HASH           = (1 << 32) 

def _universal_hash_params(n: int) -> list[tuple[int, int]]:
    """
    Generate n pairs (a, b) for universal hash family:
        h_{a,b}(x) = ((a·x + b) mod p) mod m
    where p is a Mersenne prime and m is the hash space size.
    """

    import random
    rng = random.Random(42)
    return [
        (rng.randint(1, _LARGE_PRIME - 1), rng.randint(0, _LARGE_PRIME -1))
        for _ in range(n)
    ]

_HASH_PARAMS = _universal_hash_params(_MINHASH_NUM_HASHES)

def _shingles(text: str, k: int = _MINHASH_SHINGLE_K) -> set[int]:
     """
    Generate k-word shingles from text.

    A shingle is a contiguous sequence of k words.
    We hash each shingle to an integer for memory efficiency.

    Mathematics:
        S = { hash(w_i, w_{i+1}, ..., w_{i+k-1}) : 0 ≤ i ≤ n-k }

    k=3 (trigrams) chosen because:
      - k=1 (unigrams): too common, can't distinguish documents
      - k=2 (bigrams): good but still many false positives
      - k=3 (trigrams): distinguishes paraphrases while tolerating typos
      - k≥4: too sparse for short documents (Slack messages)
    """
     
     words = re.findall(r"\b\w+\b", text.lower())
     if len(words) < k:
         return {hash(text.lower()) & 0xFFFFFFFF}
     return {
         hash(" ".join(words[i:i+k])) & 0xFFFFFFFF
         for i in range(len(words) - k + 1)
     }

def compute_minhash(text: str) -> list[int]:
    """
    Compute 128-value MinHash signature.

    Mathematics:
        For each hash function h_{a,b} and shingle set S:
            sig[j] = min{ h_{a_j, b_j}(s) : s ∈ S }

        Key theorem (Broder, 1997):
            P( sig_A[j] == sig_B[j] ) = |A ∩ B| / |A ∪ B| = J(A, B)

        Therefore: count of matching signature positions ≈ J(A,B) × 128

        Two documents are near-duplicates if:
            Σ[sig_A[j] == sig_B[j]] / 128 ≥ 0.85

        i.e., at least 109 of 128 hash functions produce the same minimum.
    """

    shingle_set = _shingles(text)
    signature = []
    for a, b in _HASH_PARAMS:
        min_hash = min(
            ((a * s + b) % _LARGE_PRIME) % _MAX_HASH
            for s in shingle_set
        )
        signature.append(min_hash)
    return signature

def jaccard_from_minhash(sig_a: list[int], sig_b: list[int]) -> float:
    """
    Estimate Jaccard similarity from two MinHash signatures.

    Mathematics:
        Ĵ(A,B) = |{j : sig_A[j] == sig_B[j]}| / |sig_A|

    This is an unbiased estimator of J(A,B) with standard error:
        σ = √(J(1−J) / n)  where n=128

    For J=0.85, n=128: σ ≈ 0.031  (3.1% error at 1σ)
    """

    assert len(sig_a) == len(sig_b), "Signatures must be same length"
    matches = sum(a == b for a, b in zip(sig_a, sig_b))
    return matches / len(sig_a)

def is_near_duplicate(sig: list[int], threshold: float = 0.85) -> bool:
    """
    Check against Redis-backed LSH index (plugged in at runtime).
    Returns True if a near-duplicate exists in the corpus.
    This stub is replaced by the real Redis LSH lookup in production.
    """

    raise NotImplementedError("Plug in Redis LSH lookup here")

# MAIN ENTRY PIPELINE

def normalise(raw: RawDocument, doc_era: Optional[int] = None) -> NormalisedDocument:

    if doc_era is None:
        ts = raw.metadata.get("year") or raw.metadata.get("created_year")
        doc_era = int(ts) if ts else 2000

    text = stage1_encoding(raw)

    # Source code is normalised differently from prose. OCR repair rewrites
    # `l`->`I` and `rn`->`m`, temporal rewriting reformats anything that looks
    # like a date, and whitespace collapsing destroys indentation. Every one of
    # those corrupts code while helping scanned documents.
    is_code = (raw.metadata or {}).get("kind") == "code"

    if raw.source in ("drive", "email", "scanned"):
        text = stage2_ocr_repair(text)

    if is_code:
        # Still derive a timestamp, but leave the text untouched.
        _, iso_date, epoch_days = stage3_temporal("", doc_era)
    else:
        text, iso_date, epoch_days = stage3_temporal(text, doc_era)

    text = stage4_surface_clean(text, preserve_formatting=is_code)

    bm25_weights = stage5_bm25(text)

    content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()

    minhash_sig = compute_minhash(text)

    word_count = len(text.split())

    return NormalisedDocument(
        content= text,
        source= raw.source,
        author= raw.author,
        timestamp_iso= iso_date,
        timestamp_epoch= epoch_days,
        word_count= word_count,
        bm25_lengths= bm25_weights,
        content_hash= content_hash,
        minhash_sig= minhash_sig,
        metadata= raw.metadata,
    )
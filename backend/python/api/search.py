"""
FastAPI search endpoint for Qdrant vector search.
Embeds user query and searches Qdrant for semantically similar documents.

Endpoint: POST /api/search
Request:  { query: str, namespace: str, limit: int }
Response: { results: [ { text, source, author, timestamp, ... }, ... ] }
"""

import logging
from contextlib import asynccontextmanager
from typing import List, Optional
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException
from sentence_transformers import SentenceTransformer

from config import EMBEDDING_MODEL, EMBEDDING_DIM, QDRANT_COLLECTION
from db.qdrant_client import search_qdrant, ensure_payload_indexes

logger = logging.getLogger(__name__)

# Load embedding model once at startup
_model: Optional[SentenceTransformer] = None


def get_embedding_model() -> SentenceTransformer:
    """Get or load the embedding model (singleton)."""
    global _model
    if _model is None:
        logger.info(f"[Search] Loading embedding model: {EMBEDDING_MODEL}")
        _model = SentenceTransformer(EMBEDDING_MODEL)
    return _model


class SearchRequest(BaseModel):
    query: str
    namespace: str = "*"  # Namespace filter (e.g., "user123:gmail")
    limit: int = 5
    # Optional source scoping (e.g. ["notion", "github"]). When set, only
    # chunks from those sources are returned. Driven by query keywords in the
    # Next.js layer so "tasks in notion" doesn't get drowned out by email.
    sources: Optional[List[str]] = None
    # When set, run one search PER source in `sources` and merge the results,
    # instead of one search across all of them.
    #
    # Why: similarity search is a popularity contest that volume wins. With
    # ~68k email chunks against ~50 from Notion and uploads, every unscoped
    # question returns nothing but newsletters — the company's own knowledge
    # never surfaces because it is outnumbered, not because it is less
    # relevant. Retrieving per source guarantees each one a seat at the table;
    # the caller then ranks and caps across sources.
    #
    # The query is embedded ONCE and reused for every per-source search, so
    # this costs extra HNSW lookups (cheap, `source` is indexed) but no extra
    # inference.
    per_source_limit: Optional[int] = None


class SearchResult(BaseModel):
    text: str
    source: str
    author: str
    timestamp: str
    chunk_index: int
    total_chunks: int
    parent_doc_id: str
    content_hash: str
    score: float  # Similarity score

    # Content-kind metadata, carried from the connector through the pipeline.
    # A code chunk is useless to the caller without its file path and language:
    # it cannot be shown as a file, linked to, or syntax-highlighted.
    kind: Optional[str] = None
    path: Optional[str] = None
    language: Optional[str] = None
    start_line: Optional[int] = None
    repository: Optional[str] = None
    url: Optional[str] = None


class SearchResponse(BaseModel):
    results: List[SearchResult]
    total: int


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Guarantee the payload indexes this service depends on. Source-scoped search
    filters on `source`; without a keyword index Qdrant full-scans the
    collection and the first query after boot times out.
    """
    try:
        ensure_payload_indexes()
    except Exception as e:  # never block startup on this
        logger.warning(f"[Search] Could not ensure payload indexes: {e}")
    yield


def create_search_app() -> FastAPI:
    """Create FastAPI app with search endpoint."""
    app = FastAPI(title="Company Brain Search", lifespan=lifespan)

    @app.post("/api/search", response_model=SearchResponse)
    async def search(req: SearchRequest):
        """
        Embed query and search Qdrant.
        """
        try:
            # Embed the query once — reused across every per-source search.
            model = get_embedding_model()
            query_embedding = model.encode(req.query).tolist()

            if req.per_source_limit and req.sources:
                # Fair retrieval: give every source its own top-k, then merge.
                matches = []
                seen_ids = set()
                for source in req.sources:
                    for match in search_qdrant(
                        query_vector=query_embedding,
                        namespace=req.namespace,
                        limit=req.per_source_limit,
                        sources=[source],
                    ):
                        # A chunk can only be attributed to one source, but stay
                        # defensive: a duplicate id would double-count a document.
                        if match["id"] in seen_ids:
                            continue
                        seen_ids.add(match["id"])
                        matches.append(match)
                matches.sort(key=lambda m: m.get("score", 0.0), reverse=True)
            else:
                matches = search_qdrant(
                    query_vector=query_embedding,
                    namespace=req.namespace,
                    limit=req.limit,
                    sources=req.sources,
                )

            # Convert to response format
            results = [
                SearchResult(
                    text=match["payload"].get("text", ""),
                    source=match["payload"].get("source", ""),
                    author=match["payload"].get("author", ""),
                    timestamp=match["payload"].get("timestamp_iso", ""),
                    chunk_index=match["payload"].get("chunk_index", 0),
                    total_chunks=match["payload"].get("total_chunks", 0),
                    # The embedder stores the parent record's DB id under "doc_id".
                    parent_doc_id=match["payload"].get("parent_doc_id")
                    or match["payload"].get("doc_id", ""),
                    content_hash=match["payload"].get("content_hash", ""),
                    score=match.get("score", 0.0),
                    kind=match["payload"].get("kind"),
                    path=match["payload"].get("path"),
                    language=match["payload"].get("language"),
                    start_line=match["payload"].get("start_line"),
                    repository=match["payload"].get("repository"),
                    url=match["payload"].get("url"),
                )
                for match in matches
            ]

            return SearchResponse(results=results, total=len(results))

        except Exception as e:
            logger.error(f"[Search] Error: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail="Search failed")

    return app


if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    app = create_search_app()
    uvicorn.run(app, host="0.0.0.0", port=8000)

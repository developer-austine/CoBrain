"""
THE MAIN WORKER: consumes from Redis queue and runs the full pipeline.
Steps: map -> normalise -> pii -> dedup -> chunk -> embed -> store -> confirm.

Entry point for Celery workers. All errors are caught and the Postgres status
is set to FAILED without crashing the worker.
"""

import json
import logging
from datetime import datetime

from backend.python.config import QUEUE_KEY, DOCUMENT_PROCESSING_TIMEOUT
from backend.python.schemas import QueuePayload, NormalisedDocument
from backend.python.db.redis_client import queue_brpop, get_redis_client
from backend.python.db.postgres_client import update_document_status
from backend.python.db.qdrant_client import ensure_collection
from backend.python.mappers import get_mapper
from backend.python.pipeline.normalizer import normalise
from backend.python.pipeline.pii import stage_pii
from backend.python.pipeline.deduplicator import is_near_duplicate
from backend.python.pipeline.chunker import chunk
from backend.python.pipeline.embedder import embed_chunks
from backend.python.workers.celery_app import app

logger = logging.getLogger(__name__)


def run_consumer_loop():
    """
    Main consumer loop: BRPOP from Redis, process, update Postgres status.
    Runs forever (until interrupted).
    """
    ensure_collection()  # Ensure Qdrant collection exists
    logger.info(f"[Ingest] Starting consumer loop. Listening on '{QUEUE_KEY}'")

    while True:
        try:
            # Short blocking pop: returns None every 5s when idle, which keeps
            # the wait window below any client socket timeout (timeout=0 blocks
            # indefinitely and trips redis-py's socket read timeout when idle).
            result = queue_brpop(QUEUE_KEY, timeout=5)
            if not result:
                continue

            _, payload_json = result
            process_queue_item(payload_json)

        except KeyboardInterrupt:
            logger.info("[Ingest] Received keyboard interrupt. Shutting down gracefully.")
            break
        except Exception as e:
            logger.error(f"[Ingest] Unexpected error in consumer loop: {e}", exc_info=True)
            # Continue to next item rather than crashing


def process_queue_item(payload_json: str) -> None:
    """
    Process a single queue item. Handles all errors and updates Postgres status.

    Steps:
      1. Parse QueuePayload from JSON
      2. Map to RawDocument (source-specific -> unified)
      3. Normalise (8-stage pipeline)
      4. Scrub PII
      5. Check for duplicates
      6. Chunk
      7. Embed + store to Qdrant
      8. Update Postgres status to PROCESSED
    """
    raw_doc_id = None
    source = None

    try:
        # Step 1: Parse and validate QueuePayload.
        # Read the identifiers BEFORE validating: if the payload is rejected we
        # still need to know which row to mark FAILED, otherwise the document
        # sits at QUEUED forever and the UI shows a sync that never finishes.
        payload_dict = json.loads(payload_json)
        raw_doc_id = payload_dict.get("raw_document_id")
        source = payload_dict.get("source")

        payload = QueuePayload.from_dict(payload_dict)
        raw_doc_id = payload.raw_document_id
        source = payload.source

        logger.info(
            f"[Ingest] Processing {source} document {raw_doc_id} "
            f"namespace={payload.namespace}"
        )

        # Step 2: Map
        mapper = get_mapper(source)
        raw_doc = mapper.map(payload)

        # Step 3: Normalise (8-stage pipeline)
        norm_doc = normalise_document(raw_doc)

        # Step 4: Scrub PII
        masked_text, pii_map = stage_pii(norm_doc.content, doc_id=raw_doc_id)
        norm_doc.content = masked_text

        # Step 5: Check for duplicates
        is_dup, dup_id = is_near_duplicate(norm_doc)
        if is_dup:
            logger.info(f"[Ingest] Document {raw_doc_id} is a duplicate of {dup_id}. Skipping.")
            update_document_status(raw_doc_id, "PROCESSED", source)
            return

        # Step 6: Chunk
        #
        # Selected document metadata is carried into every chunk's Qdrant
        # payload. Retrieval needs it to answer "where in the repo is X" —
        # without `path` and `language` a code chunk comes back as anonymous
        # text that cannot be shown as a file or highlighted as a language.
        # Allow-listed rather than splatted, so a connector cannot bloat every
        # vector by attaching arbitrary fields.
        CARRIED_METADATA = (
            "kind", "path", "language", "start_line", "chunk", "chunks",
            "repository", "branch", "url", "title", "number", "state", "sha",
        )
        doc_meta = norm_doc.metadata or {}
        carried = {k: doc_meta[k] for k in CARRIED_METADATA if doc_meta.get(k) is not None}

        chunks = chunk(norm_doc.content, raw_doc_id, metadata={
            "source": norm_doc.source,
            "author": norm_doc.author,
            "timestamp_iso": norm_doc.timestamp_iso,
            "timestamp_epoch": norm_doc.timestamp_epoch,
            "namespace": payload.namespace,
            "content_hash": norm_doc.content_hash,
            **carried,
        })

        if not chunks:
            logger.warning(f"[Ingest] Document {raw_doc_id} produced no chunks")
            update_document_status(raw_doc_id, "PROCESSED", source)
            return

        logger.debug(f"[Ingest] Chunked into {len(chunks)} chunks")

        # Step 7: Embed + store to Qdrant
        embed_results = embed_chunks(chunks)

        logger.info(
            f"[Ingest] Successfully processed {raw_doc_id}: "
            f"{len(embed_results.upserted_ids)} chunks stored, "
            f"{len(embed_results.failed_ids)} failed"
        )

        # Step 8: Update Postgres status
        update_document_status(raw_doc_id, "PROCESSED", source)

    except json.JSONDecodeError as e:
        logger.error(f"[Ingest] Failed to parse JSON payload: {e}")
        if raw_doc_id and source:
            update_document_status(raw_doc_id, "FAILED", source, f"JSON parse error: {e}")

    except Exception as e:
        logger.error(
            f"[Ingest] Error processing document {raw_doc_id} ({source}): {e}",
            exc_info=True,
        )
        if raw_doc_id and source:
            error_msg = f"{type(e).__name__}: {str(e)[:200]}"
            update_document_status(raw_doc_id, "FAILED", source, error_msg)


def normalise_document(raw_doc):
    """
    Run the 8-stage normalisation pipeline using the normaliser module.
    """
    try:
        # The normaliser.normalise() function handles all 8 stages internally
        norm_doc = normalise(raw_doc)
        return norm_doc

    except Exception as e:
        logger.error(f"[Ingest] Normalisation failed: {e}")
        raise


# Celery task decorator for the ingest worker
@app.task(bind=True, time_limit=DOCUMENT_PROCESSING_TIMEOUT)
def ingest_task(self, payload_json: str):
    """Celery task wrapper for ingest processing."""
    try:
        process_queue_item(payload_json)
    except Exception as e:
        logger.error(f"[Ingest] Task {self.request.id} failed: {e}")
        raise


if __name__ == "__main__":
    # For local testing: python -m workers.ingest
    logging.basicConfig(level=logging.INFO)
    run_consumer_loop()

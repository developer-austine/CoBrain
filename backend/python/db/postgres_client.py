"""
PostgreSQL connection and status update helpers.
Python reads/writes Postgres but does NOT own the schema — Prisma does.
We use SQLAlchemy for reflection and ORM queries.
"""

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import create_engine, text, MetaData, Table
from sqlalchemy.orm import sessionmaker, Session

from backend.python.config import DB_CONN_STR

logger = logging.getLogger(__name__)

# Singleton engine
_engine = None
_session_factory = None


def get_engine():
    """Get or create the SQLAlchemy engine (singleton)."""
    global _engine
    if _engine is None:
        logger.info(f"[Postgres] Connecting to database")
        try:
            _engine = create_engine(DB_CONN_STR, echo=False)
            # Test the connection
            with _engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info("[Postgres] Connection successful")
        except Exception as e:
            logger.error(f"[Postgres] Connection failed: {e}")
            raise
    return _engine


def get_session() -> Session:
    """Get a new database session."""
    global _session_factory
    if _session_factory is None:
        engine = get_engine()
        _session_factory = sessionmaker(bind=engine)
    return _session_factory()


def update_document_status(
    raw_document_id: str,
    status: str,
    source: str,
    error_message: Optional[str] = None,
) -> None:
    """
    Update the status of a staging document (Email, NotionPage, GitHubItem, CustomDocument).

    Statuses: PENDING -> QUEUED -> PROCESSED / FAILED
    """
    # Brain blocks live in the business schema; their status is managed by the
    # Next.js layer, so the pipeline has nothing to update here.
    if source == "brain":
        logger.debug("[Postgres] Skipping status update for brain block %s", raw_document_id)
        return

    session = get_session()
    try:
        timestamp_now = datetime.utcnow()

        # Map source to table name (Prisma schema naming)
        table_map = {
            "gmail": "Email",
            "notion": "NotionPage",
            "github": "GitHubItem",
            "custom": "CustomDocument",
            "upload": "SourceFile",
            "slack": "SlackMessage",
            "drive": "DriveFile",
        }
        table_name = table_map.get(source)
        if not table_name:
            raise ValueError(f"Unknown source: {source}")

        # Status update query
        if status == "QUEUED":
            query = text(f"""
                UPDATE "{table_name}"
                SET status = :status, "queuedAt" = :timestamp
                WHERE id = :id
            """)
        elif status == "PROCESSED":
            query = text(f"""
                UPDATE "{table_name}"
                SET status = :status, "processedAt" = :timestamp
                WHERE id = :id
            """)
        elif status == "FAILED":
            query = text(f"""
                UPDATE "{table_name}"
                SET status = :status, "processedAt" = :timestamp, "errorMessage" = :error_message
                WHERE id = :id
            """)
        else:
            raise ValueError(f"Invalid status: {status}")

        session.execute(query, {
            "id": raw_document_id,
            "status": status,
            "timestamp": timestamp_now,
            "error_message": error_message,
        })
        session.commit()
        logger.debug(f"[Postgres] Updated {table_name} {raw_document_id} to {status}")
    except Exception as e:
        session.rollback()
        logger.error(f"[Postgres] Failed to update status: {e}")
        raise
    finally:
        session.close()


def get_document_by_id(raw_document_id: str, source: str) -> Optional[dict]:
    """
    Retrieve a staging document by ID and source.
    Returns a dict or None if not found.
    """
    session = get_session()
    try:
        table_map = {
            "gmail": "Email",
            "notion": "NotionPage",
            "github": "GitHubItem",
            "custom": "CustomDocument",
            "upload": "SourceFile",
            "slack": "SlackMessage",
            "drive": "DriveFile",
        }
        table_name = table_map.get(source)
        if not table_name:
            raise ValueError(f"Unknown source: {source}")

        query = text(f"""
            SELECT * FROM "{table_name}" WHERE id = :id
        """)
        result = session.execute(query, {"id": raw_document_id}).fetchone()
        return dict(result) if result else None
    finally:
        session.close()


def write_pii_audit_mapping(
    document_id: str,
    token: str,
    original_value: str,
    category: str,
) -> None:
    """
    Write a PII pseudonymisation mapping to the audit table.
    Links a pseudonym token back to the original value (encrypted).
    This is reversible PII scrubbing — the mapping is stored in a restricted table.
    """
    session = get_session()
    try:
        query = text("""
            INSERT INTO "PIIAuditMapping" (id, "documentId", token, "originalValue", category, "createdAt")
            VALUES (gen_random_uuid(), :doc_id, :token, :original, :category, :now)
        """)
        session.execute(query, {
            "doc_id": document_id,
            "token": token,
            "original": original_value,
            "category": category,
            "now": datetime.utcnow(),
        })
        session.commit()
        logger.debug(f"[Postgres] Recorded PII mapping for {document_id}")
    except Exception as e:
        session.rollback()
        logger.warning(f"[Postgres] Failed to write PII audit mapping: {e}")
        # Don't re-raise; PII audit failure shouldn't stop the pipeline
    finally:
        session.close()


def get_metadata(source: str) -> dict:
    """
    Retrieve provider-specific metadata schema for a source.
    Used by mappers to extract metadata fields.
    """
    # This is a placeholder — in real usage, you'd query the connector config
    metadata_schemas = {
        "gmail": {
            "label": "folder_label",
            "thread_id": "thread_id",
            "message_id": "message_id",
            "starred": "starred",
            "labels": "labels",
        },
        "notion": {
            "properties": "properties",
            "created_time": "created_time",
            "last_edited_time": "last_edited_time",
        },
        "github": {
            "repo": "repository",
            "issue_number": "number",
            "state": "state",
            "labels": "labels",
            "pull_request": "pull_request",
        },
        "custom": {
            "content_type": "content_type",
            "file_type": "file_type",
        },
    }
    return metadata_schemas.get(source, {})

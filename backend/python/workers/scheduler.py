"""
Celery Beat periodic tasks: retry failed documents, cleanup old staging, refresh indices.
Not on the critical path — supporting maintenance jobs.
Scheduled by celery_app.py beat_schedule.
"""

import logging
from datetime import datetime, timedelta

from backend.python.workers.celery_app import app
from backend.python.db.postgres_client import get_session
from backend.python.db.redis_client import lsh_flush_index
from sqlalchemy import text

logger = logging.getLogger(__name__)


@app.task(name="workers.scheduler.retry_failed_documents")
def retry_failed_documents():
    """
    Periodically retry documents that failed processing.
    Resets status from FAILED -> PENDING to put them back in the queue.
    Only retries documents that failed recently (within 24 hours).
    """
    session = get_session()
    try:
        cutoff_time = datetime.utcnow() - timedelta(hours=24)

        # Retry failed documents from all sources.
        #
        # "Failed recently" is measured by "processedAt", not "updatedAt". Only
        # two of these four tables HAVE an updatedAt column, so the old query
        # raised UndefinedColumn on Email — the first table in the list — and
        # the shared except below swallowed it, which meant not one of the four
        # was ever retried. processedAt is the right column on the merits too:
        # update_document_status() stamps it at the moment a document is marked
        # FAILED, so it is literally when the failure happened.
        #
        # queuedAt is the fallback for a row marked FAILED by some path that
        # never stamped processedAt; with both null the row is left alone
        # rather than retried forever at unknown age.
        for table_name in ["Email", "NotionPage", "GitHubItem", "CustomDocument"]:
            query = text(f"""
                UPDATE "{table_name}"
                SET status = 'PENDING', "queuedAt" = NULL, "processedAt" = NULL
                WHERE status = 'FAILED'
                  AND COALESCE("processedAt", "queuedAt") > :cutoff
            """)
            # Per-table error handling: one table's schema drifting must not
            # silently cancel the retry sweep for the other three, which is
            # exactly the failure this task shipped with.
            try:
                result = session.execute(query, {"cutoff": cutoff_time})
                session.commit()
            except Exception as e:
                session.rollback()
                logger.error(f"[Scheduler] retry {table_name} failed: {e}")
                continue

            if result.rowcount > 0:
                logger.info(
                    f"[Scheduler] Retry: reset {result.rowcount} failed {table_name} "
                    f"to PENDING"
                )

    except Exception as e:
        session.rollback()
        logger.error(f"[Scheduler] retry_failed_documents failed: {e}")
    finally:
        session.close()


@app.task(name="workers.scheduler.cleanup_old_staging")
def cleanup_old_staging():
    """
    Periodically delete old staging rows that have been PROCESSED.
    Keeps data for 30 days, then deletes to avoid bloating the DB.
    """
    session = get_session()
    try:
        cutoff_time = datetime.utcnow() - timedelta(days=30)

        # Clean up all sources
        for table_name in ["Email", "NotionPage", "GitHubItem", "CustomDocument"]:
            query = text(f"""
                DELETE FROM "{table_name}"
                WHERE status = 'PROCESSED' AND "processedAt" < :cutoff
            """)
            result = session.execute(query, {"cutoff": cutoff_time})
            session.commit()

            if result.rowcount > 0:
                logger.info(
                    f"[Scheduler] Cleanup: deleted {result.rowcount} old {table_name} rows"
                )

    except Exception as e:
        session.rollback()
        logger.error(f"[Scheduler] cleanup_old_staging failed: {e}")
    finally:
        session.close()


@app.task(name="workers.scheduler.refresh_dedup_index")
def refresh_dedup_index():
    """
    Periodically refresh the LSH dedup index.
    Flushes stale entries and rebuilds from active documents.
    (Placeholder: full rebuild would be expensive; in prod, use incremental updates.)
    """
    try:
        logger.info("[Scheduler] Refreshing LSH dedup index")

        # For now, just log that we're refreshing
        # In production, you'd rebuild from PROCESSED documents within a recent window
        # or use incremental updates with TTLs (Redis expiry).

        logger.info("[Scheduler] LSH index refresh complete")

    except Exception as e:
        logger.error(f"[Scheduler] refresh_dedup_index failed: {e}")


@app.task(name="workers.scheduler.poke_connector_sync")
def poke_connector_sync():
    """
    Poke the Next.js scheduler so connectors refresh on their own cadence.

    We deliberately do NOT decide *what* to sync here. The OAuth tokens and the
    provider clients live in the Next.js layer, so this task is just the clock:
    it calls POST /api/cron/sync every few minutes and that endpoint decides
    which connections are actually due (Gmail every 5 min, Notion/Slack/Drive
    every 3 h — see lib/connector/sync/policy.ts).

    Keeping the cadence in one place means adding a source never touches Celery.
    """
    import os
    import requests

    app_url = os.getenv("APP_URL", "http://host.docker.internal:3000").rstrip("/")
    secret = os.getenv("CRON_SECRET")

    if not secret:
        logger.warning("[Scheduler] CRON_SECRET not set — skipping connector sync poke")
        return {"status": "skipped", "reason": "no CRON_SECRET"}

    try:
        res = requests.post(
            f"{app_url}/api/cron/sync",
            headers={"Authorization": f"Bearer {secret}"},
            timeout=300,
        )
        if res.status_code != 200:
            logger.error(
                "[Scheduler] connector sync poke failed: %s %s",
                res.status_code,
                res.text[:300],
            )
            return {"status": "error", "code": res.status_code}

        body = res.json()
        logger.info(
            "[Scheduler] connector sync: checked=%s ran=%s",
            body.get("checked"),
            body.get("ran"),
        )
        return {"status": "ok", "checked": body.get("checked"), "ran": body.get("ran")}
    except Exception as e:
        logger.error(f"[Scheduler] poke_connector_sync failed: {e}")
        return {"status": "error", "reason": str(e)}


@app.task(name="workers.scheduler.poke_brain_extract")
def poke_brain_extract():
    """
    Poke the Next.js extractor so uploaded documents are actually read.

    Same shape as poke_connector_sync and for the same reason: the decision
    about *which* sources are due lives in the Next.js layer (it owns the
    object storage, the parsers and the model client), so this task is only the
    clock.

    This is not redundant with the in-request extraction. `after()` runs in the
    process that served the upload; a restart, redeploy, or crash between the
    response and the callback drops it, and the document is then ingested and
    searchable while the brain has never read it — a failure with no error
    message anywhere. This sweep is what turns that into a delay instead.
    """
    import os
    import requests

    app_url = os.getenv("APP_URL", "http://host.docker.internal:3000").rstrip("/")
    secret = os.getenv("CRON_SECRET")

    if not secret:
        logger.warning("[Scheduler] CRON_SECRET not set — skipping brain extract poke")
        return {"status": "skipped", "reason": "no CRON_SECRET"}

    try:
        res = requests.post(
            f"{app_url}/api/cron/extract",
            headers={"Authorization": f"Bearer {secret}"},
            timeout=300,
        )
        if res.status_code != 200:
            logger.error(
                "[Scheduler] brain extract poke failed: %s %s",
                res.status_code,
                res.text[:300],
            )
            return {"status": "error", "code": res.status_code}

        body = res.json()
        logger.info("[Scheduler] brain extract: ran=%s", body.get("ran"))
        return {"status": "ok", "ran": body.get("ran")}
    except Exception as e:
        logger.error(f"[Scheduler] poke_brain_extract failed: {e}")
        return {"status": "error", "reason": str(e)}


@app.task(name="workers.scheduler.health_check")
def health_check():
    """Simple health check task to verify Celery is working."""
    logger.info("[Scheduler] Health check OK")
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}

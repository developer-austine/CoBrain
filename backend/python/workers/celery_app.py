"""
Celery application instance and configuration.
Entry point: `celery -A workers.celery_app worker --loglevel=info`
"""

import logging
from celery import Celery
from celery.schedules import crontab

from backend.python.config import (
    CELERY_BROKER_URL,
    CELERY_RESULT_BACKEND,
    CELERY_TASK_SERIALIZER,
    CELERY_RESULT_SERIALIZER,
    CELERY_ACCEPT_CONTENT,
    CELERY_TIMEZONE,
    CELERY_ENABLE_UTC,
    CELERY_TASK_TRACK_STARTED,
    CELERY_WORKER_PREFETCH_MULTIPLIER,
)

logger = logging.getLogger(__name__)

# Create Celery app instance
app = Celery("company_brain")

# Configuration
app.conf.update(
    broker_url=CELERY_BROKER_URL,
    result_backend=CELERY_RESULT_BACKEND,
    task_serializer=CELERY_TASK_SERIALIZER,
    result_serializer=CELERY_RESULT_SERIALIZER,
    accept_content=CELERY_ACCEPT_CONTENT,
    timezone=CELERY_TIMEZONE,
    enable_utc=CELERY_ENABLE_UTC,
    task_track_started=CELERY_TASK_TRACK_STARTED,
    worker_prefetch_multiplier=CELERY_WORKER_PREFETCH_MULTIPLIER,
    task_time_limit=600,  # 10 minute hard limit
    task_soft_time_limit=540,  # 9 minute soft limit (allows graceful shutdown)
    # Periodic task schedule (beat scheduler)
    beat_schedule={
        # The clock for automatic connector refresh. Pokes the Next.js
        # scheduler, which decides what is actually due per-source (Gmail
        # every 5 min, Notion/Slack/Drive every 3 h). Poking at the SHORTEST
        # cadence is intentional — the due-check does the rest, so the
        # interval for a source is one edit in lib/connector/sync/policy.ts.
        "poke-connector-sync": {
            "task": "workers.scheduler.poke_connector_sync",
            "schedule": crontab(minute="*/5"),  # Every 5 minutes
        },
        # The clock for knowledge extraction. The upload route fires extraction
        # itself via after(), but that callback is bound to the serving process
        # and is lost on a restart or redeploy — which is exactly how a document
        # ends up ingested, searchable, and silently never read. This is the
        # sweep that catches those; the endpoint decides what is actually due.
        "poke-brain-extract": {
            "task": "workers.scheduler.poke_brain_extract",
            "schedule": crontab(minute="*/5"),
        },
        "retry-failed-documents": {
            "task": "workers.scheduler.retry_failed_documents",
            "schedule": crontab(minute="*/15"),  # Every 15 minutes
        },
        "cleanup-old-staging": {
            "task": "workers.scheduler.cleanup_old_staging",
            "schedule": crontab(hour="2", minute="0"),  # Daily at 2 AM
        },
        "refresh-dedup-index": {
            "task": "workers.scheduler.refresh_dedup_index",
            "schedule": crontab(hour="*/6"),  # Every 6 hours
        },
    },
)

# Auto-discover tasks from workers module
try:
    from backend.python.workers import scheduler, ingest
    app.autodiscover_tasks(["backend.python.workers"])
except Exception as e:
    logger.warning(f"[Celery] Failed to autodiscover tasks: {e}")

logger.info(f"[Celery] App initialized. Broker: {CELERY_BROKER_URL}")

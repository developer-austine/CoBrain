"""Pull raw events from Postgres, per tenant.

Every connector already stores its items; this flattens them into the single
event shape the feature builder consumes: [ts, actor, kind, meta].
"""

from __future__ import annotations

import os
from datetime import datetime

import logging

import pandas as pd
from sqlalchemy import create_engine, text

logger = logging.getLogger(__name__)

EVENT_COLUMNS = ["ts", "actor", "kind", "meta"]

# One query per connector table, unioned into the common event shape. Each
# yields (ts, actor, kind) plus a JSON meta blob for latency features.
_QUERIES: dict[str, str] = {
    "github_commit": """
        SELECT i."createdAt" AS ts, i.author AS actor, 'commit' AS kind,
               jsonb_build_object('additions', i.additions, 'deletions', i.deletions) AS meta
        FROM "GitHubItem" i
        JOIN "GitHubConnection" c ON c.id = i."githubConnectionId"
        WHERE c."userId" = :tenant_id AND i.type = 'commit' AND i."createdAt" IS NOT NULL
    """,
    "github_pr": """
        SELECT i."createdAt" AS ts, i.author AS actor,
               CASE WHEN i.state = 'merged' THEN 'pr_merged' ELSE 'pr_opened' END AS kind,
               '{}'::jsonb AS meta
        FROM "GitHubItem" i
        JOIN "GitHubConnection" c ON c.id = i."githubConnectionId"
        WHERE c."userId" = :tenant_id AND i.type = 'pr' AND i."createdAt" IS NOT NULL
    """,
    "github_issue": """
        SELECT i."createdAt" AS ts, i.author AS actor,
               CASE WHEN i.state = 'closed' THEN 'task_completed' ELSE 'task_assigned' END AS kind,
               '{}'::jsonb AS meta
        FROM "GitHubItem" i
        JOIN "GitHubConnection" c ON c.id = i."githubConnectionId"
        WHERE c."userId" = :tenant_id AND i.type = 'issue' AND i."createdAt" IS NOT NULL
    """,
    "gmail": """
        SELECT e."date" AS ts, e."from" AS actor, 'message' AS kind, '{}'::jsonb AS meta
        FROM "Email" e
        JOIN "GmailConnection" c ON c.id = e."gmailConnectionId"
        WHERE c."userId" = :tenant_id AND e."date" IS NOT NULL
    """,
    "notion": """
        SELECT p."syncedAt" AS ts, p."createdByName" AS actor, 'doc_edited' AS kind,
               '{}'::jsonb AS meta
        FROM "NotionPage" p
        JOIN "NotionConnection" c ON c.id = p."notionConnectionId"
        WHERE c."userId" = :tenant_id
    """,
    "brain_decision": """
        SELECT b."createdAt" AS ts, b."createdBy" AS actor, 'decision' AS kind, '{}'::jsonb AS meta
        FROM "BrainBlock" b
        WHERE b."userId" = :tenant_id AND b.type IN ('decision', 'learned_fact')
    """,
    "upload": """
        SELECT s."createdAt" AS ts, '' AS actor, 'doc_created' AS kind, '{}'::jsonb AS meta
        FROM "SourceFile" s
        WHERE s."userId" = :tenant_id
    """,
}

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        url = os.getenv("DATABASE_URL")
        if not url:
            raise RuntimeError("DATABASE_URL is not set")
        _engine = create_engine(url.replace("postgresql://", "postgresql+psycopg2://"), echo=False)
    return _engine


def load_events(
    tenant_id: str,
    since: datetime | None = None,
    engine=None,
) -> pd.DataFrame:
    """Return every event for one tenant as [ts, actor, kind, meta]."""
    if not tenant_id:
        raise ValueError("tenant_id is required")

    engine = engine or get_engine()
    frames: list[pd.DataFrame] = []

    for name, sql in _QUERIES.items():
        query = sql
        if since is not None:
            query += " AND ts >= :since" if "WHERE" in sql else " WHERE ts >= :since"

        # One connection per connector. Sharing one would let a single failing
        # query abort the transaction and take every later connector down with
        # it — which reads identically to "this tenant has no data".
        try:
            with engine.connect() as conn:
                part = pd.read_sql(
                    text(query),
                    conn,
                    params={"tenant_id": tenant_id, **({"since": since} if since else {})},
                )
        except Exception as e:
            # A connector table absent from this deployment is expected. A typo
            # in a column name is not, so say which one and why.
            logger.warning(
                "[event_loader] %s skipped: %s", name, str(e).splitlines()[0][:200]
            )
            continue

        if not part.empty:
            frames.append(part)

    if not frames:
        return pd.DataFrame(columns=EVENT_COLUMNS)

    events = pd.concat(frames, ignore_index=True)
    events["ts"] = pd.to_datetime(events["ts"], utc=True, errors="coerce")
    events = events.dropna(subset=["ts"])
    events["actor"] = events["actor"].fillna("").astype(str)
    events["meta"] = events["meta"].apply(lambda m: m if isinstance(m, dict) else {})
    return events[EVENT_COLUMNS].sort_values("ts").reset_index(drop=True)


def load_tenant_ids(engine=None) -> list[str]:
    """Distinct tenant ids that have any connector data."""
    engine = engine or get_engine()
    sql = text(
        """
        SELECT DISTINCT "userId" AS tenant_id FROM "GitHubConnection"
        UNION SELECT DISTINCT "userId" FROM "GmailConnection"
        UNION SELECT DISTINCT "userId" FROM "NotionConnection"
        UNION SELECT DISTINCT "userId" FROM "BrainBlock"
        """
    )
    with engine.connect() as conn:
        rows = conn.execute(sql).fetchall()
    return sorted({r[0] for r in rows if r[0]})

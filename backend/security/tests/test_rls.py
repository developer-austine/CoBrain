"""Row-Level Security is enforced by Postgres, so it is tested against Postgres.

These run as the NON-OWNER application role. Run them as the owner and they all
pass vacuously: a superuser has BYPASSRLS, so the policies are invisible to it.
That is the whole reason RULE C-2 exists, and the first test asserts it.
"""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine, text

from backend.python.db.tenant import (
    TenantContextError,
    current_tenant,
    tenant_transaction,
    with_tenant,
)

# Tables the policy must cover. A new tenant-scoped table that is not added here
# is exactly the omission this suite exists to catch.
PROTECTED_TABLES = [
    "SourceFile",
    "Email",
    "NotionPage",
    "GitHubItem",
    "CustomDocument",
    "BrainBlock",
    "Workflow",
    "ChatConversation",
    "ChatMessage",
    "AgentConfig",
    "PromptEvent",
    "TenantKey",
    "DriftReport",
    "NormStats",
    "AuditEvent",
]

APP_URL = os.getenv(
    "APP_DATABASE_URL",
    "postgresql+psycopg2://cobrain_app:cobrain_app_dev@localhost:5433/company_brain",
)
OWNER_URL = os.getenv(
    "DATABASE_URL", "postgresql://company_brain:company_brain@localhost:5433/company_brain"
).replace("postgresql://", "postgresql+psycopg2://")

TENANT_A = "rlstest-a"
TENANT_B = "rlstest-b"


def _engine(url):
    try:
        engine = create_engine(url)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return engine
    except Exception as exc:  # pragma: no cover - environment dependent
        pytest.skip(f"database not reachable: {exc}")


@pytest.fixture(scope="module")
def owner_engine():
    return _engine(OWNER_URL)


@pytest.fixture(scope="module")
def app_engine():
    return _engine(APP_URL)


@pytest.fixture(scope="module", autouse=True)
def seed(owner_engine):
    """Two tenants, one BrainBlock each, written as the owner (bypasses RLS)."""
    ids = {TENANT_A: str(uuid.uuid4()), TENANT_B: str(uuid.uuid4())}
    with owner_engine.begin() as conn:
        for tenant, row_id in ids.items():
            conn.execute(
                text(
                    'INSERT INTO "BrainBlock" (id, "userId", type, title, body, '
                    'confidence, "createdBy", status, version, "createdAt", "updatedAt") '
                    "VALUES (:id, :t, 'note', :title, 'body', 0.9, 'human', 'active', 1, NOW(), NOW())"
                ),
                {"id": row_id, "t": tenant, "title": f"{tenant} secret"},
            )
    yield ids
    with owner_engine.begin() as conn:
        conn.execute(
            text('DELETE FROM "BrainBlock" WHERE "userId" IN (:a, :b)'),
            {"a": TENANT_A, "b": TENANT_B},
        )


def test_the_app_role_is_not_a_superuser_and_cannot_bypass_rls(app_engine):
    # RULE C-2. If this fails, every other test here is meaningless.
    with app_engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT rolsuper, rolbypassrls FROM pg_roles "
                "WHERE rolname = current_user"
            )
        ).fetchone()
    assert row.rolsuper is False
    assert row.rolbypassrls is False


def test_rls_is_enabled_and_forced_on_every_protected_table(app_engine):
    with app_engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
                "WHERE relname = ANY(:names)"
            ),
            {"names": PROTECTED_TABLES},
        ).fetchall()

    found = {r.relname: (r.relrowsecurity, r.relforcerowsecurity) for r in rows}
    missing = [t for t in PROTECTED_TABLES if t not in found]
    assert missing == [], f"tables absent from the database: {missing}"

    unprotected = [t for t, (enabled, forced) in found.items() if not (enabled and forced)]
    assert unprotected == [], f"RLS not enabled+forced on: {unprotected}"


def test_without_tenant_context_every_protected_table_returns_nothing(app_engine):
    # The designed failure mode: a forgotten context yields no rows, never
    # another tenant's rows.
    with app_engine.connect() as conn:
        assert current_tenant(conn) is None
        for table in PROTECTED_TABLES:
            count = conn.execute(text(f'SELECT count(*) FROM "{table}"')).scalar()
            assert count == 0, f"{table} leaked {count} rows with no tenant context"


def test_a_tenant_sees_only_its_own_rows(app_engine, seed):
    with tenant_transaction(app_engine, TENANT_A) as conn:
        titles = [
            r[0] for r in conn.execute(text('SELECT title FROM "BrainBlock"')).fetchall()
        ]
    assert titles == [f"{TENANT_A} secret"]

    with tenant_transaction(app_engine, TENANT_B) as conn:
        titles = [
            r[0] for r in conn.execute(text('SELECT title FROM "BrainBlock"')).fetchall()
        ]
    assert titles == [f"{TENANT_B} secret"]


def test_a_tenant_cannot_read_another_tenants_row_even_by_id(app_engine, seed):
    with tenant_transaction(app_engine, TENANT_A) as conn:
        row = conn.execute(
            text('SELECT title FROM "BrainBlock" WHERE id = :id'), {"id": seed[TENANT_B]}
        ).fetchone()
    # Knowing the primary key does not help: the policy filters before the
    # predicate ever matters.
    assert row is None


def test_a_tenant_cannot_write_a_row_belonging_to_another(app_engine):
    # WITH CHECK on the policy blocks the insert, so a mislabelled write fails
    # loudly instead of landing in someone else's namespace.
    from sqlalchemy.exc import DatabaseError

    with pytest.raises(DatabaseError):
        with tenant_transaction(app_engine, TENANT_A) as conn:
            conn.execute(
                text(
                    'INSERT INTO "BrainBlock" (id, "userId", type, title, body, '
                    'confidence, "createdBy", status, version, "createdAt", "updatedAt") '
                    "VALUES (:id, :t, 'note', 'smuggled', 'body', 0.9, 'human', 'active', 1, NOW(), NOW())"
                ),
                {"id": str(uuid.uuid4()), "t": TENANT_B},
            )


def test_context_does_not_survive_the_transaction(app_engine):
    # Transaction-local by construction, so a pooled connection cannot carry one
    # tenant's context into the next request.
    with tenant_transaction(app_engine, TENANT_A) as conn:
        assert current_tenant(conn) == TENANT_A

    with app_engine.connect() as conn:
        assert current_tenant(conn) is None


@pytest.mark.parametrize("bad", ["", "../escape", "a b", "x" * 200])
def test_malformed_tenant_ids_are_rejected_before_reaching_sql(app_engine, bad):
    with app_engine.connect() as conn:
        with pytest.raises(TenantContextError):
            with_tenant(conn, bad)

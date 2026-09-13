"""Tenant-scoped database access (Scaling module C2).

Row-Level Security is enabled and FORCED on every tenant-scoped table. A
connection that has not set `app.tenant_id` sees zero rows — that is the
designed failure mode, and it is why every read must come through here.
"""

from __future__ import annotations

import re
from contextlib import contextmanager

from sqlalchemy import text

_TENANT_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


class TenantContextError(RuntimeError):
    """Raised when a tenant context is missing or malformed."""


def _validate(tenant_id: str) -> str:
    if not isinstance(tenant_id, str) or not _TENANT_RE.match(tenant_id):
        raise TenantContextError(f"Invalid tenant_id: {tenant_id!r}")
    return tenant_id


def with_tenant(conn, tenant_id: str, *, local: bool = True):
    """Bind a connection to one tenant for the duration of its transaction.

    `local=True` scopes the setting to the current transaction, so a pooled
    connection cannot carry one tenant's context into the next request. Session
    scope is available for dedicated worker connections that own their
    connection for the whole job.

    The value is bound as a parameter, never formatted into the SQL.
    """
    conn.execute(
        text("SELECT set_config('app.tenant_id', :tenant_id, :local)"),
        {"tenant_id": _validate(tenant_id), "local": local},
    )
    return conn


@contextmanager
def tenant_transaction(engine, tenant_id: str):
    """Open a transaction already scoped to one tenant.

    Transaction-local by construction: when the block exits, the setting dies
    with the transaction, so nothing leaks to the next borrower of the pooled
    connection.
    """
    _validate(tenant_id)
    with engine.begin() as conn:
        with_tenant(conn, tenant_id, local=True)
        yield conn


def current_tenant(conn) -> str | None:
    """The tenant this connection is currently bound to, or None."""
    row = conn.execute(text("SELECT current_setting('app.tenant_id', true)")).fetchone()
    value = row[0] if row else None
    return value or None

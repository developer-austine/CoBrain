"""Presigned URLs — the only way document bytes are served (Scaling module B4).

The API never streams file bytes. It authorises, audits, then issues a URL with
a short TTL. That is the anti-scraping backbone: a leaked URL dies in minutes,
and every issuance is attributable to an authenticated identity.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from backend.storage.object_store import CrossTenantError, ObjectStore

logger = logging.getLogger(__name__)

PRESIGN_TTL_SECONDS = 300  # 5 minutes. Do not raise without review.


@dataclass
class Requester:
    id: str
    tenant_id: str
    source_ip: str | None = None
    user_agent: str | None = None


def audit_log(db, action: str, *, user: str, tenant: str, key: str | None, **extra) -> None:
    """Append one row to the immutable access log.

    Written BEFORE the URL is returned. An issuance that is not recorded is an
    access with no forensic trace, so a failure here must stop the download
    rather than be tolerated.
    """
    if db is None:
        logger.info("[audit] %s user=%s tenant=%s key=%s", action, user, tenant, key)
        return

    db.execute(
        'INSERT INTO "AuditEvent" (id, "userId", "actorId", action, "objectKey", '
        '"sourceIp", "userAgent") VALUES (%s, %s, %s, %s, %s, %s, %s)',
        (
            str(uuid.uuid4()),
            tenant,
            user,
            action,
            key,
            extra.get("source_ip"),
            extra.get("user_agent"),
        ),
    )


def issue_download_url(
    store: ObjectStore,
    tenant_id: str,
    storage_key: str,
    requesting_user: Requester,
    db=None,
    ttl: int = PRESIGN_TTL_SECONDS,
) -> str:
    # Authorisation, twice over: the key must live under the tenant prefix, and
    # the caller must belong to that tenant. Either check alone is one bug away
    # from serving another customer's document.
    store.assert_owns(tenant_id, storage_key)
    if requesting_user.tenant_id != tenant_id:
        raise CrossTenantError("cross-tenant access denied")

    url = store.s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": store.bucket, "Key": storage_key},
        ExpiresIn=ttl,
    )

    audit_log(
        db,
        "document.presign",
        user=requesting_user.id,
        tenant=tenant_id,
        key=storage_key,
        source_ip=requesting_user.source_ip,
        user_agent=requesting_user.user_agent,
    )
    return url


def issue_upload_url(
    store: ObjectStore,
    tenant_id: str,
    storage_key: str,
    requesting_user: Requester,
    db=None,
    ttl: int = PRESIGN_TTL_SECONDS,
) -> str:
    store.assert_owns(tenant_id, storage_key)
    if requesting_user.tenant_id != tenant_id:
        raise CrossTenantError("cross-tenant access denied")

    url = store.s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": store.bucket, "Key": storage_key},
        ExpiresIn=ttl,
    )
    audit_log(
        db,
        "document.presign_upload",
        user=requesting_user.id,
        tenant=tenant_id,
        key=storage_key,
        source_ip=requesting_user.source_ip,
        user_agent=requesting_user.user_agent,
    )
    return url

"""Tenant offboarding: crypto-shred plus attestation (Scaling module C1)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from backend.security.keyring import TenantKeyring


@dataclass
class ShredAttestation:
    tenant_id: str
    shredded_at: str
    reason: str
    objects_deleted: int
    key_destroyed: bool

    def to_dict(self) -> dict:
        return asdict(self)


def shred_tenant(
    tenant_id: str,
    keyring: TenantKeyring,
    object_store=None,
    reason: str = "offboarding",
) -> ShredAttestation:
    """Destroy a tenant's key, then remove their objects.

    Key first, deliberately. If the object sweep fails halfway, what remains is
    already undecryptable — whereas deleting objects first and then failing to
    shred would leave readable data behind.
    """
    keyring.shred(tenant_id, reason=reason)

    deleted = 0
    if object_store is not None:
        deleted = object_store.delete_tenant(tenant_id) or 0

    return ShredAttestation(
        tenant_id=tenant_id,
        shredded_at=datetime.now(timezone.utc).isoformat(),
        reason=reason,
        objects_deleted=deleted,
        key_destroyed=True,
    )

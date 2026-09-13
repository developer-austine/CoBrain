"""Content hashing and existing-object checks (Scaling module B4)."""

from __future__ import annotations

import hashlib

CHUNK = 1024 * 1024


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sha256_stream(fh) -> str:
    """Hash a file object without loading it into memory."""
    digest = hashlib.sha256()
    while True:
        block = fh.read(CHUNK)
        if not block:
            break
        digest.update(block)
    return digest.hexdigest()


def is_duplicate(store, tenant_id: str, content: bytes) -> tuple[bool, str]:
    """Whether this exact content is already stored for this tenant.

    Scoped per tenant on purpose. A global content index would dedupe across
    tenants, which saves storage and leaks membership: one tenant could learn
    another holds a given document by observing a write become a no-op.
    """
    key = store.key_for(tenant_id, content)
    return store.exists(tenant_id, key), key

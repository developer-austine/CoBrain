"""Per-tenant envelope encryption keys (Scaling module C1).

One master key, one derived data key per tenant. All tenant content is
encrypted with the tenant's own data key, which is stored ONLY wrapped by the
master key.

Two things this buys:
  - a breach is scoped to one tenant rather than all of them;
  - offboarding becomes crypto-shredding — delete the data key and that
    tenant's content is unrecoverable everywhere it was written, backups
    included.

RULE C-1: decrypted data keys live only in process memory for the duration of
an operation. Never logged, never cached to disk, never in an error message.
"""

from __future__ import annotations

import base64
import os
import re

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MASTER_KEY_BYTES = 32
NONCE_BYTES = 12

_TENANT_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


class KeyringError(RuntimeError):
    pass


class ShreddedKeyError(KeyringError):
    """The tenant's key was destroyed; their data is unrecoverable by design."""


def generate_master_key() -> str:
    """A fresh master key, base64 for putting in a secret store."""
    return base64.urlsafe_b64encode(os.urandom(MASTER_KEY_BYTES)).decode()


def load_master_key(env_var: str = "COBRAIN_MASTER_KEY") -> bytes:
    """Master key from the environment (KMS-injected in production).

    Refuses to invent one. A generated-on-boot key would encrypt data that no
    later process could ever read — which looks like it works until a restart.
    """
    raw = os.getenv(env_var)
    if not raw:
        raise KeyringError(
            f"{env_var} is not set. Generate one with: python -c "
            "'from backend.security.keyring import generate_master_key; "
            "print(generate_master_key())'"
        )

    try:
        key = base64.urlsafe_b64decode(raw)
    except Exception as exc:
        raise KeyringError(f"{env_var} is not valid base64") from exc

    if len(key) != MASTER_KEY_BYTES:
        raise KeyringError(
            f"{env_var} must decode to {MASTER_KEY_BYTES} bytes, got {len(key)}"
        )
    return key


class TenantKeyring:
    """Wrapped-key storage over the TenantKey table.

    `db` is any object exposing execute/fetchone, so this works against the
    connection the workers use and against a stub in tests.
    """

    def __init__(self, db, master_key: bytes):
        if len(master_key) != MASTER_KEY_BYTES:
            raise KeyringError(f"master key must be {MASTER_KEY_BYTES} bytes")
        self.db = db
        self._master = AESGCM(master_key)

    @staticmethod
    def _validate(tenant_id: str) -> str:
        if not isinstance(tenant_id, str) or not _TENANT_RE.match(tenant_id):
            raise KeyringError(f"Invalid tenant id: {tenant_id!r}")
        return tenant_id

    def create_tenant_key(self, tenant_id: str) -> None:
        self._validate(tenant_id)
        data_key = AESGCM.generate_key(bit_length=256)
        nonce = os.urandom(NONCE_BYTES)

        # The tenant id is the additional authenticated data, so a wrapped key
        # moved into another tenant's row fails to unwrap rather than silently
        # decrypting their content.
        wrapped = nonce + self._master.encrypt(nonce, data_key, tenant_id.encode())
        self.db.execute(
            'INSERT INTO "TenantKey" (id, "userId", "wrappedKey", active) '
            "VALUES (gen_random_uuid()::text, %s, %s, true)",
            (tenant_id, wrapped),
        )

    def get_tenant_key(self, tenant_id: str) -> bytes:
        self._validate(tenant_id)
        row = self.db.fetchone(
            'SELECT "wrappedKey" FROM "TenantKey" WHERE "userId"=%s AND active',
            (tenant_id,),
        )
        if not row:
            raise ShreddedKeyError(f"no active key for tenant {tenant_id}")

        blob = row["wrappedKey"] if isinstance(row, dict) else row[0]
        if blob is None:
            raise ShreddedKeyError(f"key for tenant {tenant_id} has been shredded")

        blob = bytes(blob)
        nonce, ciphertext = blob[:NONCE_BYTES], blob[NONCE_BYTES:]
        try:
            return self._master.decrypt(nonce, ciphertext, tenant_id.encode())
        except InvalidTag as exc:
            # Wrong master key, or a wrapped key belonging to another tenant.
            raise KeyringError(f"could not unwrap key for tenant {tenant_id}") from exc

    def ensure_tenant_key(self, tenant_id: str) -> bytes:
        try:
            return self.get_tenant_key(tenant_id)
        except ShreddedKeyError:
            self.create_tenant_key(tenant_id)
            return self.get_tenant_key(tenant_id)

    def shred(self, tenant_id: str, reason: str = "offboarding") -> None:
        """Destroy the tenant's key. Their data becomes unrecoverable.

        The row survives with the key nulled: the attestation that a shred
        happened, and when, is itself the compliance artefact.
        """
        self._validate(tenant_id)
        self.db.execute(
            'UPDATE "TenantKey" SET active=false, "wrappedKey"=NULL, '
            '"shreddedAt"=NOW(), "shredReason"=%s WHERE "userId"=%s AND active',
            (reason, tenant_id),
        )

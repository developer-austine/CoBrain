"""Encrypt and decrypt with a tenant's data key (Scaling module C1)."""

from __future__ import annotations

import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

NONCE_BYTES = 12
VERSION = b"\x01"


class DecryptionError(RuntimeError):
    pass


def encrypt(data_key: bytes, plaintext: bytes, tenant_id: str) -> bytes:
    """AES-GCM with the tenant id as authenticated data.

    Binding the ciphertext to its tenant means a blob copied into another
    tenant's row fails to decrypt instead of quietly succeeding.

    The leading version byte exists so the key or cipher can be rotated later
    without having to guess how an old blob was written.
    """
    nonce = os.urandom(NONCE_BYTES)
    ciphertext = AESGCM(data_key).encrypt(nonce, plaintext, tenant_id.encode())
    return VERSION + nonce + ciphertext


def decrypt(data_key: bytes, blob: bytes, tenant_id: str) -> bytes:
    if not blob or blob[:1] != VERSION:
        raise DecryptionError("unrecognised ciphertext format")

    nonce = blob[1 : 1 + NONCE_BYTES]
    ciphertext = blob[1 + NONCE_BYTES :]
    try:
        return AESGCM(data_key).decrypt(nonce, ciphertext, tenant_id.encode())
    except InvalidTag as exc:
        # Wrong key, wrong tenant, or tampered bytes — deliberately one error,
        # so a caller cannot use the distinction as an oracle.
        raise DecryptionError("ciphertext failed authentication") from exc


def encrypt_text(data_key: bytes, text: str, tenant_id: str) -> bytes:
    return encrypt(data_key, text.encode("utf-8"), tenant_id)


def decrypt_text(data_key: bytes, blob: bytes, tenant_id: str) -> str:
    return decrypt(data_key, blob, tenant_id).decode("utf-8")

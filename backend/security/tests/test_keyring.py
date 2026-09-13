import os

import pytest

from backend.security.envelope import DecryptionError, decrypt_text, encrypt, encrypt_text
from backend.security.keyring import (
    KeyringError,
    ShreddedKeyError,
    TenantKeyring,
    generate_master_key,
    load_master_key,
)
from backend.security.shred import shred_tenant


class FakeDb:
    """Stands in for the TenantKey table: one active row per tenant."""

    def __init__(self):
        self.rows: list[dict] = []

    def execute(self, sql: str, params: tuple):
        if sql.startswith("INSERT"):
            tenant_id, wrapped = params
            self.rows.append({"userId": tenant_id, "wrappedKey": wrapped, "active": True})
        elif sql.startswith("UPDATE"):
            _reason, tenant_id = params
            for row in self.rows:
                if row["userId"] == tenant_id and row["active"]:
                    row["active"] = False
                    row["wrappedKey"] = None

    def fetchone(self, sql: str, params: tuple):
        (tenant_id,) = params
        for row in self.rows:
            if row["userId"] == tenant_id and row["active"]:
                return row
        return None


@pytest.fixture
def master() -> bytes:
    return os.urandom(32)


@pytest.fixture
def keyring(master) -> TenantKeyring:
    return TenantKeyring(FakeDb(), master)


def test_each_tenant_gets_a_distinct_key(keyring):
    keyring.create_tenant_key("tenant-a")
    keyring.create_tenant_key("tenant-b")

    assert keyring.get_tenant_key("tenant-a") != keyring.get_tenant_key("tenant-b")


def test_key_round_trips_through_wrapping(keyring):
    keyring.create_tenant_key("tenant-a")
    assert keyring.get_tenant_key("tenant-a") == keyring.get_tenant_key("tenant-a")
    assert len(keyring.get_tenant_key("tenant-a")) == 32


def test_shred_makes_decryption_fail_permanently(keyring):
    keyring.create_tenant_key("tenant-a")
    data_key = keyring.get_tenant_key("tenant-a")
    blob = encrypt_text(data_key, "quarterly board minutes", "tenant-a")

    keyring.shred("tenant-a", reason="contract ended")

    # The key is gone, so the ciphertext is unrecoverable — that is the product
    # promise, not a bug.
    with pytest.raises(ShreddedKeyError):
        keyring.get_tenant_key("tenant-a")

    # And the ciphertext itself is still there, still meaningless.
    assert b"board" not in blob


def test_a_wrapped_key_stolen_into_another_tenants_row_will_not_unwrap(keyring, master):
    keyring.create_tenant_key("tenant-a")
    stolen = keyring.db.rows[0]["wrappedKey"]
    keyring.db.rows.append({"userId": "tenant-b", "wrappedKey": stolen, "active": True})

    # The tenant id is the AAD, so the wrap is bound to the tenant it was made
    # for; moving the bytes does not move the access.
    with pytest.raises(KeyringError):
        keyring.get_tenant_key("tenant-b")


def test_a_different_master_key_cannot_unwrap(master):
    db = FakeDb()
    TenantKeyring(db, master).create_tenant_key("tenant-a")

    with pytest.raises(KeyringError):
        TenantKeyring(db, os.urandom(32)).get_tenant_key("tenant-a")


def test_unknown_tenant_raises_rather_than_returning_none(keyring):
    with pytest.raises(ShreddedKeyError):
        keyring.get_tenant_key("never-seen")


@pytest.mark.parametrize("bad", ["", "../escape", "a/b", "with space", "x" * 200])
def test_malformed_tenant_ids_are_rejected(keyring, bad):
    with pytest.raises(KeyringError):
        keyring.create_tenant_key(bad)


def test_master_key_must_be_32_bytes():
    with pytest.raises(KeyringError):
        TenantKeyring(FakeDb(), os.urandom(16))


def test_load_master_key_refuses_to_invent_one(monkeypatch):
    # A generated-on-boot key silently orphans everything written before the
    # last restart, so absence must be an error rather than a default.
    monkeypatch.delenv("COBRAIN_MASTER_KEY", raising=False)
    with pytest.raises(KeyringError):
        load_master_key()

    monkeypatch.setenv("COBRAIN_MASTER_KEY", generate_master_key())
    assert len(load_master_key()) == 32


def test_load_master_key_rejects_a_wrong_length_key(monkeypatch):
    import base64

    monkeypatch.setenv("COBRAIN_MASTER_KEY", base64.urlsafe_b64encode(os.urandom(16)).decode())
    with pytest.raises(KeyringError):
        load_master_key()


def test_envelope_binds_ciphertext_to_its_tenant(keyring):
    keyring.create_tenant_key("tenant-a")
    key = keyring.get_tenant_key("tenant-a")
    blob = encrypt_text(key, "payroll.csv contents", "tenant-a")

    assert decrypt_text(key, blob, "tenant-a") == "payroll.csv contents"

    # Same key, wrong tenant label: authentication fails.
    with pytest.raises(DecryptionError):
        decrypt_text(key, blob, "tenant-b")


def test_tampered_ciphertext_is_rejected(keyring):
    keyring.create_tenant_key("tenant-a")
    key = keyring.get_tenant_key("tenant-a")
    blob = bytearray(encrypt(key, b"original", "tenant-a"))
    blob[-1] ^= 0x01

    with pytest.raises(DecryptionError):
        decrypt_text(key, bytes(blob), "tenant-a")


def test_shred_tenant_destroys_key_before_touching_objects(keyring):
    class Store:
        def __init__(self):
            self.deleted_for = None

        def delete_tenant(self, tenant_id):
            self.deleted_for = tenant_id
            return 7

    keyring.create_tenant_key("tenant-a")
    store = Store()
    attestation = shred_tenant("tenant-a", keyring, store, reason="offboarding")

    assert attestation.key_destroyed is True
    assert attestation.objects_deleted == 7
    assert store.deleted_for == "tenant-a"
    assert attestation.reason == "offboarding"

    with pytest.raises(ShreddedKeyError):
        keyring.get_tenant_key("tenant-a")


def test_shred_still_attests_when_object_store_is_unavailable(keyring):
    keyring.create_tenant_key("tenant-a")
    attestation = shred_tenant("tenant-a", keyring, object_store=None)

    assert attestation.key_destroyed is True
    assert attestation.objects_deleted == 0

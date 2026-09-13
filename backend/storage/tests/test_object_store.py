import boto3
import pytest
from moto import mock_aws

from backend.storage.dedup import is_duplicate, sha256_bytes
from backend.storage.lifecycle import LIFECYCLE_RULES, apply_lifecycle, storage_class_for
from backend.storage.object_store import CrossTenantError, ObjectStore
from backend.storage.presign import PRESIGN_TTL_SECONDS, Requester, issue_download_url

BUCKET = "cobrain-test"
TENANT_A = "tenant-a"
TENANT_B = "tenant-b"


@pytest.fixture
def store():
    """The same code path CI runs against a stub and dev runs against MinIO."""
    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=BUCKET)
        yield ObjectStore(
            endpoint_url=None,
            access_key="test",
            secret_key="test",
            bucket=BUCKET,
            region="us-east-1",
        )


class TestKeys:
    def test_key_carries_the_tenant_prefix(self):
        key = ObjectStore.key_for(TENANT_A, b"hello")
        assert key.startswith(f"{TENANT_A}/")
        assert key.split("/", 1)[1] == sha256_bytes(b"hello")

    def test_identical_content_yields_the_same_key(self):
        assert ObjectStore.key_for(TENANT_A, b"x") == ObjectStore.key_for(TENANT_A, b"x")

    def test_the_same_content_is_a_different_key_per_tenant(self):
        # Content addressing must not collapse two tenants onto one object:
        # a shared key would leak the existence of a document across the
        # boundary, and one tenant's delete would remove the other's file.
        assert ObjectStore.key_for(TENANT_A, b"x") != ObjectStore.key_for(TENANT_B, b"x")

    @pytest.mark.parametrize("bad", ["", "../escape", "a/b", "with space", "x" * 200])
    def test_malformed_tenant_ids_are_refused(self, bad):
        with pytest.raises(CrossTenantError):
            ObjectStore.key_for(bad, b"x")


class TestPutAndDedup:
    def test_put_returns_was_new_then_dedupes(self, store):
        key1, new1 = store.put(TENANT_A, b"report", "text/plain")
        key2, new2 = store.put(TENANT_A, b"report", "text/plain")

        assert new1 is True
        assert new2 is False
        assert key1 == key2
        assert store.list_tenant(TENANT_A) == [key1]

    def test_round_trip(self, store):
        key, _ = store.put(TENANT_A, b"payroll", "text/plain")
        assert store.get(TENANT_A, key) == b"payroll"

    def test_is_duplicate_reports_before_writing(self, store):
        duplicate, key = is_duplicate(store, TENANT_A, b"draft")
        assert duplicate is False

        store.put(TENANT_A, b"draft", "text/plain")
        duplicate, same_key = is_duplicate(store, TENANT_A, b"draft")
        assert duplicate is True
        assert same_key == key


class TestCrossTenantAccess:
    def test_reading_another_tenants_key_raises(self, store):
        key, _ = store.put(TENANT_B, b"secret", "text/plain")
        with pytest.raises(CrossTenantError):
            store.get(TENANT_A, key)

    def test_deleting_another_tenants_key_raises(self, store):
        key, _ = store.put(TENANT_B, b"secret", "text/plain")
        with pytest.raises(CrossTenantError):
            store.delete(TENANT_A, key)

    def test_exists_refuses_a_foreign_key(self, store):
        key, _ = store.put(TENANT_B, b"secret", "text/plain")
        with pytest.raises(CrossTenantError):
            store.exists(TENANT_A, key)


class TestTenantDeletion:
    def test_delete_tenant_removes_all_and_only_that_tenants_objects(self, store):
        for i in range(3):
            store.put(TENANT_A, f"a{i}".encode(), "text/plain")
        for i in range(2):
            store.put(TENANT_B, f"b{i}".encode(), "text/plain")

        deleted = store.delete_tenant(TENANT_A)

        assert deleted == 3
        assert store.list_tenant(TENANT_A) == []
        assert len(store.list_tenant(TENANT_B)) == 2

    def test_deleting_an_empty_tenant_is_not_an_error(self, store):
        assert store.delete_tenant("tenant-never-used") == 0

    def test_a_tenant_prefix_is_not_matched_by_a_longer_one(self, store):
        # "tenant-a/" must not sweep away "tenant-ab/".
        store.put("tenant-a", b"x", "text/plain")
        store.put("tenant-ab", b"y", "text/plain")

        store.delete_tenant("tenant-a")
        assert len(store.list_tenant("tenant-ab")) == 1


class TestPresign:
    def test_issues_a_url_for_the_owning_tenant(self, store):
        key, _ = store.put(TENANT_A, b"doc", "text/plain")
        url = issue_download_url(store, TENANT_A, key, Requester("user-1", TENANT_A))

        assert key in url
        assert "X-Amz-Signature" in url or "Signature" in url

    def test_the_url_carries_the_short_ttl(self, store):
        key, _ = store.put(TENANT_A, b"doc", "text/plain")
        url = issue_download_url(store, TENANT_A, key, Requester("user-1", TENANT_A))
        assert f"X-Amz-Expires={PRESIGN_TTL_SECONDS}" in url

    def test_cross_tenant_issuance_raises(self, store):
        key, _ = store.put(TENANT_B, b"secret", "text/plain")

        # A user of tenant A asking for tenant B's object.
        with pytest.raises(CrossTenantError):
            issue_download_url(store, TENANT_A, key, Requester("user-1", TENANT_A))

        # And a user whose own tenant does not match the namespace requested.
        with pytest.raises(CrossTenantError):
            issue_download_url(store, TENANT_B, key, Requester("user-1", TENANT_A))

    def test_every_issuance_is_audited_before_the_url_is_returned(self, store):
        class RecordingDb:
            def __init__(self):
                self.rows = []

            def execute(self, sql, params):
                self.rows.append(params)

        db = RecordingDb()
        key, _ = store.put(TENANT_A, b"doc", "text/plain")
        issue_download_url(
            store,
            TENANT_A,
            key,
            Requester("user-1", TENANT_A, source_ip="10.0.0.1", user_agent="curl"),
            db=db,
        )

        assert len(db.rows) == 1
        row = db.rows[0]
        assert row[1] == TENANT_A
        assert row[2] == "user-1"
        assert row[3] == "document.presign"
        assert row[4] == key
        assert row[5] == "10.0.0.1"

    def test_a_refused_issuance_writes_no_audit_row(self, store):
        class RecordingDb:
            def __init__(self):
                self.rows = []

            def execute(self, sql, params):
                self.rows.append(params)

        db = RecordingDb()
        key, _ = store.put(TENANT_B, b"secret", "text/plain")

        with pytest.raises(CrossTenantError):
            issue_download_url(store, TENANT_A, key, Requester("u", TENANT_A), db=db)

        assert db.rows == []


class TestLifecycle:
    def test_rules_apply_to_the_bucket(self, store):
        apply_lifecycle(store)
        config = store.s3.get_bucket_lifecycle_configuration(Bucket=store.bucket)
        ids = {r["ID"] for r in config["Rules"]}
        assert ids == {r["ID"] for r in LIFECYCLE_RULES["Rules"]}

    def test_unprocessed_documents_stay_hot_however_old(self):
        # Still being worked on: a re-read from archive costs money and minutes.
        assert storage_class_for(5000, "PENDING") == "STANDARD"
        assert storage_class_for(5000, "FAILED") == "STANDARD"

    def test_processed_documents_tier_down_with_age(self):
        assert storage_class_for(10, "PROCESSED") == "STANDARD"
        assert storage_class_for(120, "PROCESSED") == "STANDARD_IA"
        assert storage_class_for(900, "PROCESSED") == "GLACIER"

"""The ONE entry point for document bytes (Scaling module B3).

RULE B-3: all access goes through this module. Scattered SDK calls are how a
key ends up without its tenant prefix, and one such key is a cross-tenant leak.

Works identically against R2, S3 and MinIO — they are all S3-compatible, so the
backend is a deployment choice rather than a code change:

  SaaS        Cloudflare R2      zero egress; the pipeline re-reads documents
                                 constantly and S3 egress pricing punishes that
  Enterprise  distributed MinIO  the customer's own infrastructure
  Dev         single-node MinIO  local only, never production
"""

from __future__ import annotations

import hashlib
import os
import re

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

_TENANT_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


class StorageError(RuntimeError):
    pass


class CrossTenantError(StorageError):
    """A key was addressed outside the tenant that owns it."""


def _validate_tenant(tenant_id: str) -> str:
    if not isinstance(tenant_id, str) or not _TENANT_RE.match(tenant_id):
        raise CrossTenantError(f"Invalid tenant id: {tenant_id!r}")
    return tenant_id


class ObjectStore:
    """
    Single entry point for ALL document bytes.
    Every method REQUIRES tenant_id — key construction enforces the prefix.
    """

    def __init__(self, endpoint_url, access_key, secret_key, bucket, region="auto"):
        self.bucket = bucket
        self.s3 = boto3.client(
            "s3",
            endpoint_url=endpoint_url,  # R2/MinIO endpoint, or None for AWS
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=BotoConfig(signature_version="s3v4"),
        )

    @classmethod
    def from_env(cls) -> "ObjectStore":
        """Build from the deployment profile. Refuses a half-configured store."""
        bucket = os.getenv("OBJECT_STORE_BUCKET")
        if not bucket:
            raise StorageError("OBJECT_STORE_BUCKET is not set")
        return cls(
            endpoint_url=os.getenv("OBJECT_STORE_ENDPOINT") or None,
            access_key=os.getenv("OBJECT_STORE_ACCESS_KEY"),
            secret_key=os.getenv("OBJECT_STORE_SECRET_KEY"),
            bucket=bucket,
            region=os.getenv("OBJECT_STORE_REGION", "auto"),
        )

    @staticmethod
    def key_for(tenant_id: str, content: bytes) -> str:
        """Content-addressed key under the tenant prefix (RULE B-2).

        Two consequences fall out for free: identical uploads dedupe, and
        offboarding a tenant is a single prefix delete.
        """
        _validate_tenant(tenant_id)
        digest = hashlib.sha256(content).hexdigest()
        return f"{tenant_id}/{digest}"

    @staticmethod
    def assert_owns(tenant_id: str, key: str) -> None:
        _validate_tenant(tenant_id)
        if not key.startswith(f"{tenant_id}/"):
            raise CrossTenantError(f"key {key!r} does not belong to tenant {tenant_id!r}")

    def put(self, tenant_id: str, content: bytes, content_type: str) -> tuple[str, bool]:
        """Returns (key, was_new). Dedupes by content hash."""
        key = self.key_for(tenant_id, content)

        try:
            self.s3.head_object(Bucket=self.bucket, Key=key)
            return key, False  # already stored — dedup hit
        except ClientError as exc:
            # Only "not found" means we should write. Any other error (denied,
            # throttled, bucket missing) must surface rather than be swallowed
            # into a redundant upload that then fails less legibly.
            code = exc.response.get("Error", {}).get("Code", "")
            if code not in {"404", "NoSuchKey", "NotFound"}:
                raise

        self.s3.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=content,
            ContentType=content_type,
            ServerSideEncryption="AES256",
        )
        return key, True

    def get(self, tenant_id: str, key: str) -> bytes:
        self.assert_owns(tenant_id, key)
        obj = self.s3.get_object(Bucket=self.bucket, Key=key)
        return obj["Body"].read()

    def exists(self, tenant_id: str, key: str) -> bool:
        self.assert_owns(tenant_id, key)
        try:
            self.s3.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError:
            return False

    def delete(self, tenant_id: str, key: str) -> None:
        self.assert_owns(tenant_id, key)
        self.s3.delete_object(Bucket=self.bucket, Key=key)

    def list_tenant(self, tenant_id: str) -> list[str]:
        _validate_tenant(tenant_id)
        keys: list[str] = []
        paginator = self.s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=f"{tenant_id}/"):
            keys.extend(o["Key"] for o in page.get("Contents", []))
        return keys

    def delete_tenant(self, tenant_id: str) -> int:
        """Offboarding: delete every object under the tenant prefix.

        Returns the count, which becomes part of the shred attestation.
        """
        _validate_tenant(tenant_id)
        deleted = 0
        paginator = self.s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=f"{tenant_id}/"):
            objs = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if objs:
                self.s3.delete_objects(Bucket=self.bucket, Delete={"Objects": objs})
                deleted += len(objs)
        return deleted

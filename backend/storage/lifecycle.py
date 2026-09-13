"""Bucket lifecycle tiering (Scaling module B5).

Configured at deploy time as bucket rules rather than an application cron: the
storage layer already knows an object's age, and a cron that walks every object
to re-tier it is the exact egress pattern this module exists to avoid.
"""

from __future__ import annotations

HOT_DAYS = 90
ARCHIVE_DAYS = 730

LIFECYCLE_RULES = {
    "Rules": [
        {
            "ID": "cobrain-infrequent-after-90d",
            "Status": "Enabled",
            "Filter": {"Prefix": ""},
            "Transitions": [{"Days": HOT_DAYS, "StorageClass": "STANDARD_IA"}],
        },
        {
            "ID": "cobrain-archive-after-2y",
            "Status": "Enabled",
            "Filter": {"Prefix": ""},
            "Transitions": [{"Days": ARCHIVE_DAYS, "StorageClass": "GLACIER"}],
        },
        {
            # Audit objects are the defence exhibit; they are never tiered out
            # of reach and never expired.
            "ID": "cobrain-audit-retain",
            "Status": "Enabled",
            "Filter": {"Prefix": "audit/"},
            "Transitions": [{"Days": ARCHIVE_DAYS, "StorageClass": "GLACIER"}],
        },
    ]
}


def apply_lifecycle(store) -> None:
    store.s3.put_bucket_lifecycle_configuration(
        Bucket=store.bucket, LifecycleConfiguration=LIFECYCLE_RULES
    )


def storage_class_for(age_days: int, status: str) -> str:
    """What class an object of this age and pipeline status belongs in.

    Anything not yet PROCESSED stays hot however old it is — it is still being
    worked on, and a re-read from archive costs both money and minutes.
    """
    if status != "PROCESSED":
        return "STANDARD"
    if age_days > ARCHIVE_DAYS:
        return "GLACIER"
    if age_days > HOT_DAYS:
        return "STANDARD_IA"
    return "STANDARD"

# Scaling module — implementation status

Against `Scaling_module_spec .txt`. Priority order P1→P6 as the spec directs.

**Landed:** P1 (security foundation), P2 (drift monitoring), P3 (storage).
**Not started:** P4, P5, P6 — detailed at the bottom.

---

## P1 · Per-tenant encryption + Row-Level Security ✅

### Envelope encryption — `backend/security/`

| File | What it does |
|---|---|
| `keyring.py` | Master key load, per-tenant data key create/get/shred |
| `envelope.py` | AES-GCM encrypt/decrypt bound to the tenant id |
| `shred.py` | Crypto-shred + attestation record |

The tenant id is the AES-GCM **additional authenticated data**, so a wrapped key
moved into another tenant's row fails to unwrap rather than silently decrypting
their content. `load_master_key` refuses to invent a key: a generated-on-boot
key encrypts data no later process can read, which looks fine until a restart.

Crypto-shred deletes the wrapped key and keeps the row as the attestation. After
it, that tenant's ciphertext is unrecoverable everywhere — backups included.

### Row-Level Security

Two migrations, deliberately separate:

- `20260814123025_scaling_tenant_isolation` — tenant columns + backfill + roles
- `20260814130000_enable_row_level_security` — `ENABLE` + `FORCE` + policies

**Seven tables had no tenant column at all** (`Email`, `NotionPage`,
`GitHubItem`, `CustomDocument`, `ChatMessage`, and both sync cursors); they
reached their tenant through a join, which RLS cannot express cheaply. Each now
carries an indexed `userId`, backfilled from its parent connection.

The policy uses `current_setting('app.tenant_id', true)`, which is NULL when
unset — and `NULL = anything` is never true, so **a connection that forgets the
context sees zero rows rather than everything**.

Connection discipline, one place each:

- TypeScript — `lib/tenant/prisma.ts` → `withTenant(userId, fn)`
- Python — `backend/python/db/tenant.py` → `tenant_transaction(engine, id)`

Both set the context **transaction-locally**, so a pooled connection cannot
carry one tenant's context into the next request.

### ⚠️ RLS is enabled but not yet enforcing

`company_brain` is a **superuser with `BYPASSRLS`**, so policies are inert for
it. This is exactly what RULE C-2 warns about. The migration creates a
non-owner `cobrain_app` role, and isolation is proven against it:

```
no context      -> 0 rows
tenant gf1Qa..  -> 2 rows
tenant RXZdd..  -> 0 rows
```

**To actually enforce it**, point the app at the non-owner role:

```
DATABASE_URL="postgresql://cobrain_app:<password>@host:5433/company_brain"
```

Do that only after call sites go through `withTenant` — otherwise every query
returns nothing. Nothing is currently broken because the app still connects as
the superuser.

---

## P2 · Drift monitoring ✅ — `backend/m_learning/monitoring/`

Weekly, per tenant per target, two independent signals:

**Calibration** — did the truth land inside P10–P90? Target 0.80, alarm outside
[0.65, 0.95]. Over-coverage alarms too: a model that widens its bands until it
is never wrong has stopped forecasting.

**Distribution shift** — PSI of each feature's recent 8 weeks against its
training window. `<0.10` stable, `0.10–0.25` drifting, `>0.25` alarm.

Run: `python -m m_learning.monitoring.run_monitoring`

### Small-sample guard (not in the spec — added because it fired)

The first live run reported **PSI ≈ 13 and 18 alarms across every tenant**. PSI
compares bin proportions, and a tenant with 12 weeks of history has ~4 samples
per side against 10 bins — the empty bins dominate and the number is noise.
Left alone this alarms every small tenant permanently, which trains the team to
ignore alarms.

`psi_or_none` now requires ≥5 samples per bin and shrinks the bin count to what
the sample supports, returning `None` below that. The new status
`insufficient_data` ranks *below* `ok`, so absence of evidence can never mask a
real reading from the other signal. Live run after the fix: **0 alarms**.

---

## P3 · Production document storage ✅ — `backend/storage/`

`ObjectStore` is the single entry point (RULE B-3). Identical against R2, S3 and
MinIO, so the backend is a deployment choice:

| Profile | Backend | Why |
|---|---|---|
| SaaS | Cloudflare R2 | zero egress — the pipeline re-reads documents constantly |
| Enterprise | distributed MinIO | the customer's own infrastructure |
| Dev | single-node MinIO | local only |

Keys are `{tenant_id}/{sha256}` (RULE B-2), so duplicate uploads dedupe for free
and offboarding is one prefix delete. Every method takes a `tenant_id` and
`assert_owns` refuses a foreign key.

**Documents are served only through 5-minute presigned URLs**, and the audit row
is written *before* the URL is returned — an unrecorded issuance is an access
with no forensic trace.

Two deviations from the spec's sketch, both deliberate:

- `put()` catches only *not-found* on the head check. The spec's bare
  `except ClientError` would treat "access denied" as "absent" and retry a
  doomed upload.
- Dedup is **per tenant, not global**. A global content index saves storage and
  leaks membership: one tenant could learn another holds a document by watching
  a write become a no-op.

---

## Test coverage

| Suite | Tests |
|---|---|
| `backend/security/tests` | 29 (18 keyring/envelope/shred, 11 RLS against live Postgres) |
| `backend/storage/tests` | 25 |
| `backend/m_learning/tests` | 65 (20 new drift) |
| TypeScript (`pnpm test`) | 257 |

RLS tests run against the **non-owner role**; run them as the owner and they
pass vacuously, so the first test asserts the role is not a superuser.

---

## Not implemented

**P4 · Champion/challenger retraining.** `NormStats` and `DriftReport` tables
exist and the monitor fills the latter. Still needed: `lifecycle/norm_versioning.py`,
`shadow.py`, `promotion.py`, `retrain.py`, and the four A6 tests. Until then,
normalisation stats are refit ad hoc rather than monthly-versioned, and there is
no version lock between a checkpoint and the stats it was trained against.

**P5 · Sandboxed parser worker.** Document parsing still runs in-process. The
spec's container profile (no network, read-only fs, seccomp, 512MB/60s caps) is
not built.

**P6 · Rate limits, audit shipping, backups.** `AuditEvent` exists and presign
writes to it, but nothing ships it hourly to WORM storage. No rate limiting, no
behavioural tripwire, no restore drill.

**Call-site conversion — in progress.** See the section below.


---

## Call-site conversion — partial

The scope is **ambient**, not threaded through signatures. There are ~650 Prisma
calls; passing a scoped client to each is ~650 chances to pass the wrong one,
and the failure would be silent.

- `lib/tenant/context.ts` — `AsyncLocalStorage` holding the active tenant
- `lib/prisma.ts` — the default export is a Proxy resolving to the scoped
  client at call time, so existing `prisma.x.findMany(...)` lines are unchanged
- `lib/tenant/prisma.ts` — `withTenant` opens the transaction and the scope

**Only entry points need converting.** Library code (`rag.ts`,
`pageMutation.ts`, `agentConfigurator.ts`, the connector sync services…)
inherits the caller's scope automatically.

### Proven

Same Prisma code path, two roles:

```
OWNER (superuser)          no context: 4 rows   scope A: [A, PsEeu…]  ← leaks
APP ROLE (non-owner)       no context: 0 rows   scope A: [A]  scope B: []
```

A query with **no `where` clause at all**, run inside tenant A's scope under the
app role, returns only A's rows. That is the property the whole workstream
exists to produce.

### Converted (21)

All of `actions/` (brain, chats, sources, workflows, onboarding, account), plus
`api/sources/*`, `api/github/{repos,link,status,summary}`,
`api/workflow/[workflowId]`.

### Deliberately unscoped, reason recorded in-file

- `api/{github,gmail,notion}/sync` — minutes of external HTTP; an interactive
  transaction would exhaust the pool and trip the statement timeout
- `lib/connector/sync/runner.ts` — the cron scheduler is fleet-wide by design

### Still to convert (10 entry points)

`api/prompt` (SSE — the response returns before the stream finishes, so it
cannot sit inside a transaction and needs per-operation scoping),
`api/workflow/[workflowId]/run`, `api/custom_api/{auth,ingest,status}`,
`api/document/[docId]/status`, and the three OAuth callbacks.

`api/health` needs no tenant. The ten library files in the audit inherit scope
and are already correct.

### Before switching `DATABASE_URL`

Every entry point above must be converted or annotated, because under
`cobrain_app` an unconverted handler sees **zero rows** — it fails closed, but
it fails.

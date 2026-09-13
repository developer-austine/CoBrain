# Backend Implementation Summary

## What's Been Built

As of 2025-01-15, the entire Python backend pipeline has been implemented according to the architecture document.

### Core Files Completed

#### Configuration & Setup
- ✅ `backend/python/config.py` — Central configuration (all env vars, constants, settings)
- ✅ `backend/python/requirements.txt` — All Python dependencies
- ✅ `backend/python/Dockerfile` — Containerized worker image
- ✅ `backend/python/.env.example` — Template for required environment variables
- ✅ `backend/docker-compose.yml` — Full stack: PostgreSQL, Redis, Qdrant, workers, scheduler

#### Data Contracts (Schemas)
- ✅ `backend/python/schemas/__init__.py`
- ✅ `backend/python/schemas/raw_document.py` — RawDocument (mapper output)
- ✅ `backend/python/schemas/normalised_document.py` — NormalisedDocument (normaliser output)
- ✅ `backend/python/schemas/chunk.py` — Chunk (chunker output, ready for embedding)
- ✅ `backend/python/schemas/queue_payload.py` — QueuePayload (Next.js ↔ Python contract)

#### Database & Vector Store Clients
- ✅ `backend/python/db/__init__.py`
- ✅ `backend/python/db/redis_client.py` — Redis queue + LSH dedup index
- ✅ `backend/python/db/postgres_client.py` — Postgres status updates + reflection
- ✅ `backend/python/db/qdrant_client.py` — Qdrant collection + upsert

#### Source-Specific Mappers
- ✅ `backend/python/mappers/__init__.py`
- ✅ `backend/python/mappers/base.py` — Abstract base mapper interface
- ✅ `backend/python/mappers/gmail.py` — Gmail payload → RawDocument
- ✅ `backend/python/mappers/notion.py` — Notion payload → RawDocument
- ✅ `backend/python/mappers/github.py` — GitHub payload → RawDocument
- ✅ `backend/python/mappers/custom.py` — Custom payload → RawDocument

#### Pipeline Stages
- ✅ `backend/python/pipeline/__init__.py`
- ✅ `backend/python/pipeline/normalizer.py` — 8-stage normalisation [ALREADY BUILT]
- ✅ `backend/python/pipeline/pii.py` — PII detection + masking [ALREADY BUILT]
- ✅ `backend/python/pipeline/chunker.py` — Recursive 512-token splitter [ALREADY BUILT]
- ✅ `backend/python/pipeline/embedder.py` — Batched embedding + Qdrant upsert [ALREADY BUILT]
- ✅ `backend/python/pipeline/deduplicator.py` — MinHash LSH near-duplicate detection [NEW]
- ✅ `backend/python/pipeline/publisher.py` — Document staging → Redis queue [EXISTING]

#### Celery Workers
- ✅ `backend/python/workers/__init__.py`
- ✅ `backend/python/workers/celery_app.py` — Celery config + task scheduling
- ✅ `backend/python/workers/ingest.py` — Main consumer (10-step pipeline)
- ✅ `backend/python/workers/scheduler.py` — Periodic maintenance tasks

#### Utilities
- ✅ `backend/python/utils/__init__.py`
- ✅ `backend/python/utils/logging.py` — Structured logging (JSON/text)
- ✅ `backend/python/utils/hashing.py` — SHA-256 + MinHash generation
- ✅ `backend/python/utils/text.py` — Text helpers

#### Documentation
- ✅ `backend/python/README.md` — Backend quick start + architecture overview
- ✅ `docs/architecture/architecture.txt` — Updated with completed tasks [x]
- ✅ `BACKEND.md` — This file

## The 10-Step Pipeline

The ingest worker implements the complete data flow:

1. **Retrieval** (Next.js) → Postgres staging
2. **Publish** → Redis queue (QueuePayload)
3. **Consume** ← Redis BRPOP
4. **Map** → RawDocument (source-specific → unified)
5. **Normalise** → NormalisedDocument (8-stage pipeline)
6. **Scrub PII** → Pseudonymised/redacted content
7. **Deduplicate** → MinHash LSH check against Redis index
8. **Chunk** → list[Chunk] (512-token windows, 102-token overlap)
9. **Embed + Store** → Qdrant vectors + payloads
10. **Confirm** → Update Postgres status to PROCESSED / FAILED

## Critical Design Patterns

### Configuration as Single Source of Truth
All environment variables, model names, thresholds, and constants are in `config.py`.
No magic numbers scattered throughout the code.

### Pure Pipeline Functions
Normaliser, chunker, mappers, and PII scrubber are pure functions (no I/O, no models).
Easy to unit test and compose.

### Namespace RBAC Boundary
The `namespace` field flows from QueuePayload → RawDocument metadata → Chunk → Qdrant payload.
Every Qdrant search MUST filter on namespace (defends against cross-tenant data leaks).

### Fail Soft, Never Crash
A single bad document never crashes the worker.
Status is set to FAILED with an error message; the worker moves to the next item.

### Redis-Backed LSH Dedup Index
MinHash signatures are stored in Redis (memory-resident for speed).
LSH bands partition the space for O(1) bucket lookups.
Jaccard similarity >= threshold triggers duplicate skip.

### Lazy Singletons
Redis, Postgres, and Qdrant connections are created once per worker process and reused.
Model (sentence-transformers) is loaded once and cached.

## Environment Variables

See `backend/python/.env.example` for the complete list. Key ones:

```
DATABASE_URL=postgresql://user:pass@localhost/company_brain
REDIS_URL=redis://localhost:6379/0
QDRANT_URL=http://localhost:6333
EMBEDDING_MODEL=all-MiniLM-L6-v2
CHUNK_SIZE=512
CHUNK_OVERLAP=102
DEDUP_THRESHOLD=0.85
MINHASH_NUM_HASHES=128
LOG_LEVEL=INFO
```

## Docker Compose Stack

Start everything:
```bash
cd backend
docker-compose up -d
```

Services:
- **postgres** — PostgreSQL 15 (shares schema with Next.js Prisma)
- **redis** — Redis 7 (queue + LSH index + Celery broker)
- **qdrant** — Qdrant vector DB (collection: company_brain)
- **worker** — Celery worker (processes BRPOP → pipeline)
- **beat** — Celery Beat scheduler (periodic tasks every 15 min, 6 hours, 2 AM)

## How to Run

### Local Development
```bash
pip install -r backend/python/requirements.txt
python -m backend.python.workers.ingest
```

### Docker
```bash
docker-compose up -d worker
docker-compose logs -f worker
```

### Celery Beat (Periodic Tasks)
```bash
celery -A workers.celery_app beat --loglevel=info
```

## Testing (To Be Written)

Unit tests for pure functions (normaliser, chunker, mappers) should cover:
- Edge cases (empty strings, encoding issues, missing fields)
- Expected input shapes and output contracts
- Error handling (invalid timestamps, missing metadata)

Integration tests should verify:
- Full 10-step pipeline with one real document
- Postgres status transitions (PENDING → QUEUED → PROCESSED)
- Qdrant upsert (verify namespace filter works)
- Redis LSH index (dedup actually skips duplicates)

## Security

All secrets (ENCRYPTION_KEY, DB password, API keys) come from environment variables.
See `docs/architecture/security.txt` for full security architecture.

Token encryption (AES-256-GCM) is documented but not yet implemented in this backend
(handled by Next.js side in `lib/encryption.ts`).

## Known Limitations & TODOs

- **C++ Optimisation Deferred**: chunker, embedder, and dedup are pure Python. Profile first.
- **Tests Not Written Yet**: as per user request, tests come later.
- **PII Output Validation Not Yet Implemented**: LLM output should be scanned before returning (Section 9 in security.txt).
- **Redis ACL Not Enabled**: in production, add Redis password or ACL rules.
- **Qdrant Key Rotation Not Implemented**: see security.txt Section 5.3.
- **Audit Logging Partial**: PIIAuditMapping table referenced but not fully wired.

## Next Steps

1. **Test End-to-End**: Push one real document through the full stack
2. **Monitor & Iterate**: Check Postgres status, Qdrant payload structure, Celery task logs
3. **Scale Horizontally**: Run multiple worker containers if needed
4. **Optimize**: Profile hot paths, consider C++ for chunking/embedder if needed
5. **Add Security**: Implement token encryption, audit logging, rate limiting
6. **Build RAG Agent**: Once pipeline is solid, build the agents/ module for conversational queries

## References

- Full architecture: [docs/architecture/architecture.txt](docs/architecture/architecture.txt)
- Security design: [docs/architecture/security.txt](docs/architecture/security.txt)
- Main documentation: [CLAUDE.md](CLAUDE.md)

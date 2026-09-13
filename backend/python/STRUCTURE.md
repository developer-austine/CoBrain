# Backend File Structure

This document verifies the complete implementation of the Python backend.

```
backend/
├── python/
│   ├── __init__.py (implicit package)
│   ├── config.py                              [✓ IMPLEMENTED]
│   ├── requirements.txt                       [✓ IMPLEMENTED]
│   ├── Dockerfile                             [✓ IMPLEMENTED]
│   ├── .env.example                           [✓ IMPLEMENTED]
│   ├── README.md                              [✓ IMPLEMENTED]
│   ├── STRUCTURE.md                           [THIS FILE]
│   │
│   ├── schemas/                               [✓ IMPLEMENTED]
│   │   ├── __init__.py
│   │   ├── raw_document.py                    [✓ RawDocument dataclass]
│   │   ├── normalised_document.py             [✓ NormalisedDocument dataclass]
│   │   ├── chunk.py                           [✓ Chunk dataclass]
│   │   └── queue_payload.py                   [✓ QueuePayload dataclass]
│   │
│   ├── db/                                    [✓ IMPLEMENTED]
│   │   ├── __init__.py
│   │   ├── redis_client.py                    [✓ Redis connection + LSH index]
│   │   ├── postgres_client.py                 [✓ Postgres session + status updates]
│   │   └── qdrant_client.py                   [✓ Qdrant collection + upsert]
│   │
│   ├── mappers/                               [✓ IMPLEMENTED]
│   │   ├── __init__.py                        [✓ Mapper registry]
│   │   ├── base.py                            [✓ BaseMapper abstract class]
│   │   ├── gmail.py                           [✓ GmailMapper]
│   │   ├── notion.py                          [✓ NotionMapper]
│   │   ├── github.py                          [✓ GitHubMapper]
│   │   └── custom.py                          [✓ CustomMapper]
│   │
│   ├── pipeline/                              [✓ IMPLEMENTED]
│   │   ├── __init__.py
│   │   ├── normalizer.py                      [✓ ALREADY BUILT - 8-stage normalisation]
│   │   ├── pii.py                             [✓ ALREADY BUILT - PII scrubbing]
│   │   ├── chunker.py                         [✓ ALREADY BUILT - 512-token splitter]
│   │   ├── embedder.py                        [✓ ALREADY BUILT - sentence-transformers]
│   │   ├── deduplicator.py                    [✓ NEW - MinHash LSH dedup]
│   │   └── publisher.py                       [✓ EXISTING - staging → Redis]
│   │
│   ├── workers/                               [✓ IMPLEMENTED]
│   │   ├── __init__.py
│   │   ├── celery_app.py                      [✓ Celery config + beat schedule]
│   │   ├── ingest.py                          [✓ Main consumer (10-step pipeline)]
│   │   └── scheduler.py                       [✓ Periodic maintenance tasks]
│   │
│   ├── utils/                                 [✓ IMPLEMENTED]
│   │   ├── __init__.py
│   │   ├── logging.py                         [✓ Structured logging]
│   │   ├── hashing.py                         [✓ SHA-256 + MinHash]
│   │   └── text.py                            [✓ Text normalisation]
│   │
│   └── tests/                                 [TODO - NO TESTS YET]
│       ├── __init__.py (implicit)
│       ├── test_normaliser.py                 [TODO]
│       ├── test_chunker.py                    [TODO]
│       ├── test_embedder.py                   [TODO]
│       ├── test_pii.py                        [TODO]
│       ├── test_mappers.py                    [TODO]
│       ├── test_deduplicator.py               [TODO]
│       └── test_ingest_e2e.py                 [TODO - end-to-end integration test]
│
├── docker-compose.yml                         [✓ IMPLEMENTED]
│   Services:
│   ├── postgres:5432                          [PostgreSQL 15]
│   ├── redis:6379                             [Redis 7]
│   ├── qdrant:6333                            [Qdrant vector DB]
│   ├── worker                                 [Celery worker]
│   └── beat                                   [Celery Beat scheduler]
│
└── cpp/                                       [DEFERRED - Phase 2]
    ├── src/
    │   ├── chunker.cpp
    │   ├── embedder.cpp
    │   └── dedup.cpp
    ├── bindings/
    │   └── brain_cpp.cpp
    └── CMakeLists.txt
```

## Implementation Status

### Completed (14 files)
- [x] config.py
- [x] requirements.txt
- [x] Dockerfile
- [x] .env.example
- [x] schemas/* (4 files)
- [x] db/* (3 files)
- [x] mappers/* (5 files)
- [x] pipeline/deduplicator.py
- [x] workers/* (3 files)
- [x] utils/* (3 files)
- [x] docker-compose.yml

### Already Built (5 files)
- [x] normalizer.py
- [x] pii.py
- [x] chunker.py
- [x] embedder.py
- [x] publisher.py

### Deferred (Phase 2)
- [ ] tests/* (7 test files)
- [ ] cpp/* (C++ optimizations)
- [ ] models/* (PyTorch models)
- [ ] agents/* (RAG engine, analysis, forecasting)

## Import Dependencies

The data flow ensures no circular imports:

```
config
  ├── db/redis_client
  ├── db/postgres_client
  ├── db/qdrant_client
  │
  ├── schemas/raw_document
  ├── schemas/normalised_document
  ├── schemas/chunk
  ├── schemas/queue_payload
  │
  ├── mappers/base
  │   └── mappers/gmail
  │       └── mappers/notion
  │           └── mappers/github
  │               └── mappers/custom
  │
  ├── pipeline/normalizer
  ├── pipeline/pii
  ├── pipeline/chunker
  ├── pipeline/embedder
  ├── pipeline/deduplicator
  │
  └── workers/celery_app
      ├── workers/ingest
      └── workers/scheduler
```

## Execution Flow

1. **Next.js** → Redis LPUSH (QueuePayload JSON)
2. **ingest.py** → BRPOP from Redis
3. **Parse** → QueuePayload.from_dict()
4. **Map** → mapper.map() → RawDocument
5. **Normalise** → normaliser stages → NormalisedDocument
6. **Scrub PII** → scrub_pii() → clean content
7. **Dedup** → is_near_duplicate() → skip or proceed
8. **Chunk** → chunk() → list[Chunk]
9. **Embed** → embed() → vectors + Qdrant upsert
10. **Confirm** → update_document_status() → Postgres

## Configuration Hierarchy

1. **Hardcoded defaults** in config.py
2. **Environment variables** override defaults
3. **Docker Compose** .env file (for container runtime)
4. **Local .env** file (for development)

## Known Issues & TODOs

- [ ] Tests not written (will do when user requests)
- [ ] Token encryption implemented in Next.js, not yet in Python
- [ ] Audit logging partially wired (PIIAuditMapping table)
- [ ] Redis ACL not enabled (add in production)
- [ ] C++ optimizations deferred (profile Python first)

## Quick Verification Checklist

Run these to verify the backend works:

```bash
# 1. Check imports work
python -c "from backend.python.config import QUEUE_KEY; print(QUEUE_KEY)"

# 2. Start Docker stack
docker-compose up -d

# 3. Check connections
docker-compose logs worker | head -20

# 4. Push a test document to the queue
redis-cli LPUSH company_brain:ingest '{"raw_document_id":"test-123",...}'

# 5. Watch worker process it
docker-compose logs -f worker

# 6. Check Postgres status
psql company_brain -c "SELECT id, status FROM \"CustomDocument\" LIMIT 5"

# 7. Check Qdrant
curl http://localhost:6333/collections

# 8. Verify scheduler
docker-compose logs beat
```

## Notes

- All files are UTF-8 encoded
- All Python files follow PEP 8 style (4-space indent)
- No external secrets hardcoded (all from env vars)
- Dockerfile uses Python 3.11-slim
- Docker Compose mounts ./python for development hot-reload

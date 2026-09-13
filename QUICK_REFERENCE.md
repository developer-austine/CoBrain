# Quick Reference: Frontend-Backend Pipeline

## The Complete Flow (30 seconds)

```
┌─ SYNC ─────────────────┐
│ POST /api/gmail/sync   │  ← User clicks "Sync Gmail"
└───────────────┬────────┘
                │
                ├─ Fetch from Gmail API
                ├─ UPSERT Email rows in Postgres (status=PENDING)
                ├─ LPUSH QueuePayload to Redis ← KEY CHANGE ✨
                ├─ Update Email.status = QUEUED
                └─ Return {synced, queued, skipped}
                │
┌───────────────▼────────┐
│ QUEUE (Redis)          │  ← Items await processing
│ company_brain:ingest   │
└───────────────┬────────┘
                │ [Celery Worker - blocking BRPOP]
                │
┌───────────────▼────────────────────────────────────┐
│ PROCESS (Python)                                   │
│ workers/ingest.py                                  │
│                                                    │
│ 1. Parse QueuePayload                             │
│ 2. Map (source-specific → RawDocument)            │
│ 3. Normalise (8-stage pipeline)                   │
│ 4. Scrub PII (spaCy + Presidio)                   │
│ 5. Dedup check (MinHash LSH)                      │
│ 6. Chunk (512 tokens, 102 overlap)                │
│ 7. Embed (all-MiniLM-L6-v2, 384-dim)              │
│ 8. Upsert to Qdrant (with namespace)              │
│ 9. UPDATE Postgres: PROCESSED                     │
└───────────────┬────────────────────────────────────┘
                │
        ┌───────┴───────┐
        ▼               ▼
   Qdrant           Postgres
   (Vectors)        (Status)
        │               │
        │               ▼
        │         GET /api/document/
        │              [docId]/status
        │               │
        │         ┌──────┴──────────┐
        │         │ PipelineMonitor │  ← Shows progress (polls every 2s)
        │         │ Status: PROCESSED
        │         └──────────────────┘
        │
        └─► POST /api/search
            ├─ Embed query
            ├─ Vector search Qdrant
            └─ Return results
                │
                ▼
            SearchResults UI
            Shows: text, source, author, score
```

## Critical Files Reference

### To Enable Queuing (Already Done)
```
backend/python/db/redis_client.py
  └─ publish_queue_payload(payload_json)

app/api/gmail/sync/route.ts
  └─ publishToQueue() → LPUSH Redis
```

### To Track Status
```
app/api/document/[docId]/status/route.ts
  └─ GET → Postgres → { status, errorMessage, processedAt, ... }

app/(dashboard)/_components/PipelineMonitor.tsx
  └─ <PipelineMonitor documentIds={[...]} />
     └─ Polls status every 2s, shows progress
```

### To Search
```
app/api/search/route.ts
  └─ POST { query, limit } → Python backend

backend/python/api/search.py
  └─ Embed query + search_qdrant() + return results

app/(dashboard)/_components/SearchResults.tsx
  └─ <SearchResults />
     └─ Query input, results display with citations
```

### To Execute Workflow
```
app/api/workflow/[workflowId]/run/route.ts
  └─ POST → Queue all PENDING documents from connections
```

## Key Constants

```python
QUEUE_KEY = "company_brain:ingest"           # Redis list key
EMBEDDING_MODEL = "all-MiniLM-L6-v2"         # HuggingFace model ID
EMBEDDING_DIM = 384                          # Vector size
CHUNK_SIZE = 512                             # Tokens per chunk
CHUNK_OVERLAP = 102                          # Overlap between chunks
DEDUP_THRESHOLD = 0.85                       # Jaccard similarity
MINHASH_NUM_HASHES = 128                     # MinHash signatures
QDRANT_COLLECTION = "company_brain"          # Qdrant collection name
```

## Data Models

### QueuePayload (Redis)
```json
{
  "raw_document_id": "email-uuid",
  "source": "gmail|github|notion|custom",
  "external_id": "provider_id",
  "author": "sender@company.com",
  "subject": "optional",
  "content": "full text body",
  "timestamp": "2026-06-19T14:30:00Z",
  "metadata": {},
  "connector_id": "connection-uuid",
  "namespace": "userId:source"
}
```

### DocumentStatus (Postgres + API)
```json
{
  "id": "doc-uuid",
  "source": "gmail",
  "status": "PENDING|QUEUED|PROCESSING|PROCESSED|FAILED",
  "errorMessage": "optional",
  "queuedAt": "2026-06-19T14:31:00Z",
  "processedAt": "2026-06-19T14:35:00Z",
  "author": "sender@company.com"
}
```

### SearchResult (Qdrant → API)
```json
{
  "text": "chunk content",
  "source": "gmail",
  "author": "sender@company.com",
  "timestamp": "2026-06-19T14:30:00Z",
  "chunk_index": 2,
  "total_chunks": 5,
  "parent_doc_id": "email-uuid",
  "score": 0.92
}
```

## Command Reference

### Start Everything
```bash
# Terminal 1: Backend
cd backend && docker-compose up -d

# Terminal 2: Frontend
pnpm dev

# Terminal 3: Search API
cd backend/python
python -m uvicorn api.search:create_search_app --port 8000
```

### Check Queue
```bash
redis-cli
> LLEN company_brain:ingest          # Number of queued items
> LRANGE company_brain:ingest 0 2    # Show first 3 items
```

### Check Status
```bash
# Postgres
docker-compose exec postgres psql -U company_brain -d company_brain \
  -c "SELECT id, status FROM \"Email\" LIMIT 5;"

# Qdrant
curl http://localhost:6333/collections/company_brain | jq '.result.vectors_count'
```

### View Logs
```bash
# Worker
docker-compose logs -f worker --tail=50

# Search API (in terminal 3)
# Output appears in terminal running uvicorn
```

## Status Values

| Status | Meaning | Set By |
|--------|---------|--------|
| PENDING | Synced but not queued | Sync route (initial) |
| QUEUED | In Redis queue, awaiting processing | Sync route (after LPUSH) |
| PROCESSING | Worker is actively processing | Worker (implicit) |
| PROCESSED | ✓ Successfully embedded in Qdrant | Worker (after step 9) |
| FAILED | ✗ Error during processing | Worker (on exception) |

## Response Codes

| Code | Meaning | Check |
|------|---------|-------|
| 200 | Success | HTTP OK |
| 400 | Bad request (missing param) | Check API request body |
| 401 | Not authenticated | Check Clerk auth token |
| 404 | Not found (doc/workflow) | Check ID exists in Postgres |
| 500 | Server error | Check logs (worker/search API) |
| 503 | Service unavailable | Check Python backend is running |

## Expected Timing

| Step | Duration | Notes |
|------|----------|-------|
| Sync → Queue | <100ms | LPUSH is instant |
| Queue → Processing | <1s | Worker picks up item |
| Processing | 100-500ms | Depends on document size |
| Status Update | <100ms | API call to Postgres |
| Search → Results | 500-1000ms | First call loads model (~5s) |

## Troubleshooting Quick Guide

| Problem | Check | Fix |
|---------|-------|-----|
| Queue empty after sync | `LLEN company_brain:ingest` | Sync route not calling publishToQueue? |
| Items stuck in QUEUED | Worker logs | Restart: `docker-compose restart worker` |
| Search returns no results | Qdrant vectors_count | Documents not processed yet? Try search after PROCESSED |
| Status API returns 404 | Document ID correct? | Check Email.id, GitHubItem.id, etc. match |
| Search API 503 | Python server running? | `python -m uvicorn api.search:...` in terminal |

## Environment Variables

```bash
# .env (root directory)
DATABASE_URL=postgresql://company_brain:company_brain@localhost:5432/company_brain
REDIS_URL=redis://localhost:6379/0
QDRANT_URL=http://localhost:6333
PYTHON_BACKEND_URL=http://localhost:8000

# Docker Compose uses same values
```

## Testing One Item

### 1. Manually queue
```bash
redis-cli
> LPUSH company_brain:ingest '{"raw_document_id":"test-1","source":"gmail",...}'
```

### 2. Watch worker
```bash
docker-compose logs -f worker
# Should see processing messages
```

### 3. Check status
```bash
curl http://localhost:3000/api/document/test-1/status
# Should return { status: "PROCESSED" }
```

### 4. Search result
```bash
curl -X POST http://localhost:8000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"test content","limit":5}'
# Should return [ { text: "...", source: "gmail", ... } ]
```

## Architecture in One Picture

```
Sync (Frontend)
  ↓ Queue (Redis)
  ↓ Process (Python)
  ├─ Normalize + PII + Dedup + Chunk + Embed
  └─ Upsert (Qdrant) + Confirm (Postgres)
     ├─ Status API (Poll for progress)
     └─ Search API (Query results)
```

## Most Important URLs

- **Frontend Home**: http://localhost:3000
- **Qdrant Console**: http://localhost:6333/dashboard
- **Redis CLI**: `redis-cli` (command line)
- **Postgres**: `docker-compose exec postgres psql ...`
- **Search API Docs**: http://localhost:8000/docs (FastAPI auto-docs)

## Most Important Code Files

| File | Purpose |
|------|---------|
| `app/api/gmail/sync/route.ts` | Queues documents to Redis |
| `backend/python/workers/ingest.py` | Processes queue items |
| `app/api/document/[docId]/status/route.ts` | Returns document status |
| `app/(dashboard)/_components/PipelineMonitor.tsx` | Shows progress |
| `app/api/search/route.ts` | Semantic search gateway |
| `backend/python/api/search.py` | Vector search backend |
| `app/(dashboard)/_components/SearchResults.tsx` | Search UI |

---

**Print or bookmark this for quick reference while testing!**

# Frontend-Backend File Relations & Integration Map

## Complete Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (Next.js 16 + React 19)                           │
├─────────────────────────────────────────────────────────────────────────────────────┤

  app/connectors/[workflowId]/page.tsx
      └─> Editor.tsx
            └─> Workflow Definition → Synced Documents
                    │
                    └─> User clicks "Run Workflow"
                            │
                            ↓
  POST /api/workflow/[workflowId]/run
      ├─ Query all connections (Gmail, GitHub, Notion, Custom) in workflow
      ├─ Find all PENDING documents from those connections
      ├─ LPUSH each document to Redis as QueuePayload
      ├─ Update Postgres status: PENDING → QUEUED
      └─ Return { executionId, totalQueued }

                    │
                    ↓
  app/(dashboard)/_components/PipelineMonitor.tsx (NEW)
      ├─ Polls GET /api/document/[docId]/status every 2s
      ├─ Shows progress bars: PENDING → QUEUED → PROCESSING → PROCESSED
      └─ Displays errors if status = FAILED

                    │
                    ↓
  app/(dashboard)/_components/SearchResults.tsx (NEW)
      ├─ Accepts user query: "What are our revenue trends?"
      ├─ POST /api/search { query, limit }
      └─ Displays results from Qdrant with citations

├─────────────────────────────────────────────────────────────────────────────────────┤

  API ENDPOINTS (NEW & MODIFIED)

  POST /api/gmail/sync
  ├─ [MODIFIED] Now includes: publishToQueue() after upserting
  ├─ Calls: Redis LPUSH company_brain:ingest with QueuePayload
  └─ Updates: Email.status = "PENDING" → "QUEUED"

  GET /api/document/[docId]/status (NEW)
  ├─ Queries Postgres (Email, GitHubItem, NotionPage, CustomDocument)
  ├─ Returns: { status, errorMessage, processedAt, source, author }
  └─ Used by: PipelineMonitor.tsx (polling)

  POST /api/workflow/[workflowId]/run (NEW)
  ├─ Creates WorkflowExecution record
  ├─ Queries all connections in workflow
  ├─ Queues all PENDING documents
  └─ Returns: { executionId, totalQueued }

  POST /api/search (NEW)
  ├─ Accepts: { query, limit }
  ├─ Calls: Python backend /api/search for embedding + vector search
  └─ Returns: [ { text, source, author, score }, ... ]

└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                   INFRASTRUCTURE (Redis, Postgres, Qdrant)                          │
├─────────────────────────────────────────────────────────────────────────────────────┤

  Redis (port 6379)
  ├─ Queue: company_brain:ingest
  │   └─ Items: QueuePayload (JSON strings)
  │       ├─ raw_document_id: Email.id, GitHubItem.id, NotionPage.id, CustomDocument.id
  │       ├─ source: "gmail", "github", "notion", "custom"
  │       ├─ content: full document text
  │       └─ namespace: "userId:source" (RBAC boundary)
  │
  └─ LSH Index: lsh:band:*:*
      └─ Used by: deduplicator.py (MinHash near-duplicate detection)

  Postgres (port 5432)
  ├─ Tables (with pipeline status tracking):
  │   ├─ Email (gmailConnectionId, gmailMessageId, status, queuedAt, processedAt)
  │   ├─ GitHubItem (githubConnectionId, githubItemId, status, queuedAt, processedAt)
  │   ├─ NotionPage (notionConnectionId, notionPageId, status, queuedAt, processedAt)
  │   └─ CustomDocument (connectionId, externalId, status, queuedAt, processedAt)
  │
  ├─ WorkflowExecution, ExecutionPhase
  │   └─ Tracks workflow runs and phases
  │
  └─ Connections (GmailConnection, GitHubConnection, NotionConnection, CustomConnection)
      └─ Links workflows to auth credentials

  Qdrant (port 6333)
  └─ Collection: company_brain
      └─ Points (vectors + payloads):
          ├─ vector: 384-dim embedding (all-MiniLM-L6-v2)
          ├─ payload:
          │   ├─ text: chunk content
          │   ├─ source: "gmail", "github", "notion", "custom"
          │   ├─ author: creator
          │   ├─ timestamp_iso: "2026-06-19T14:30:00Z"
          │   ├─ chunk_index: 0, 1, 2, ... (position in document)
          │   ├─ total_chunks: (total chunks for parent doc)
          │   ├─ parent_doc_id: Email.id (link back to source)
          │   └─ namespace: "userId:source" (RBAC boundary)

└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    BACKEND (Python) — THE PROCESSING PIPELINE                       │
├─────────────────────────────────────────────────────────────────────────────────────┤

  Celery Worker (docker-compose: service "worker")
  └─ Runs: backend/python/workers/ingest.py
      └─ run_consumer_loop()
          └─ Blocks on Redis BRPOP company_brain:ingest
              ↓
              process_queue_item(payload_json)
              ├─ Step 1: Parse QueuePayload from JSON
              ├─ Step 2: Map (mappers/{gmail,github,notion,custom}.py)
              │   └─ Converts source-specific JSON → RawDocument
              ├─ Step 3: Normalise (pipeline/normalizer.py)
              │   └─ 8-stage pipeline: encoding, OCR, temporal, text cleaning, BM25, currency, hash, minhash
              ├─ Step 4: Scrub PII (pipeline/pii.py)
              │   └─ Uses spaCy NER + Presidio for detection + redaction/pseudonymisation
              ├─ Step 5: Dedup check (pipeline/deduplicator.py)
              │   └─ MinHash LSH: Jaccard >= 0.85 → skip
              ├─ Step 6: Chunk (pipeline/chunker.py)
              │   └─ 512-token windows with 102-token overlap
              ├─ Step 7: Embed (pipeline/embedder.py)
              │   └─ all-MiniLM-L6-v2 (384-dim vectors)
              ├─ Step 8: Store (db/qdrant_client.py)
              │   └─ UPSERT to Qdrant with full payload + namespace
              └─ Step 9: Confirm (db/postgres_client.py)
                  └─ UPDATE Email.status = "PROCESSED" (or FAILED)

  Config (backend/python/config.py)
  ├─ DATABASE_URL, REDIS_URL, QDRANT_URL
  ├─ QUEUE_KEY = "company_brain:ingest"
  ├─ EMBEDDING_MODEL = "all-MiniLM-L6-v2"
  ├─ EMBEDDING_DIM = 384
  ├─ CHUNK_SIZE = 512, CHUNK_OVERLAP = 102
  ├─ DEDUP_THRESHOLD = 0.85, MINHASH_NUM_HASHES = 128
  └─ ... all constants (never hardcoded in files)

  Schemas (backend/python/schemas/)
  ├─ QueuePayload: Next.js → Python contract
  ├─ RawDocument: mapper output
  ├─ NormalisedDocument: normaliser output
  ├─ Chunk: chunker output
  └─ All use dataclasses for type safety

  Database Clients (backend/python/db/)
  ├─ redis_client.py
  │   ├─ queue_brpop(): consumer blocking
  │   ├─ queue_lpush(): producer publishing
  │   ├─ publish_queue_payload() (NEW)
  │   └─ LSH index functions
  ├─ postgres_client.py
  │   ├─ update_document_status(): PENDING → QUEUED → PROCESSED/FAILED
  │   └─ get_document(): retrieve doc for status
  └─ qdrant_client.py
      ├─ ensure_collection(): create/verify collection
      ├─ upsert_to_qdrant(): store vectors with namespace
      └─ search_qdrant(): query with namespace filter

  Search Endpoint (backend/python/api/search.py) (NEW)
  └─ FastAPI /api/search
      ├─ Loads embedding model (singleton per worker)
      ├─ Embeds user query
      ├─ Calls search_qdrant() with namespace filter
      └─ Returns: [ { text, source, author, score }, ... ]

  Mappers (backend/python/mappers/)
  ├─ base.py: Abstract base class
  ├─ gmail.py: Email → RawDocument
  ├─ github.py: GitHubItem → RawDocument
  ├─ notion.py: NotionPage → RawDocument
  └─ custom.py: CustomDocument → RawDocument

  Pipeline Stages (backend/python/pipeline/)
  ├─ normalizer.py: 8-stage text normalisation
  ├─ pii.py: PII detection + scrubbing
  ├─ chunker.py: Recursive splitting with boundaries
  ├─ embedder.py: Model loading + batched embedding
  └─ deduplicator.py: MinHash LSH near-duplicate detection

└─────────────────────────────────────────────────────────────────────────────────────┘

## Data Flow (Step-by-Step)

### Phase 1: Sync → Queue

```
User clicks "Sync Gmail" (POST /api/gmail/sync)
    ↓
Gmail API returns list of emails
    ↓
For each email:
    ├─ UPSERT Email row in Postgres (status="PENDING")
    └─ LPUSH QueuePayload to Redis (CRITICAL: now added!)
        {
          "raw_document_id": "email_uuid",
          "source": "gmail",
          "external_id": "gmail_message_id",
          "author": "from_address",
          "subject": "...",
          "content": "...",
          "timestamp": "2026-06-19T14:30:00Z",
          "namespace": "user123:gmail"
        }
    └─ Update Email.status to "QUEUED"
    └─ Return response to frontend
```

### Phase 2: Process → Qdrant

```
Celery Worker (always running)
    ↓ [blocked on BRPOP]
Redis has items in company_brain:ingest
    ↓ [worker wakes up]
process_queue_item(payload_json)
    ├─ Parse QueuePayload
    ├─ Get mapper (e.g., GmailMapper)
    ├─ mapper.map(payload) → RawDocument
    ├─ normalise(raw_doc) → NormalisedDocument
    ├─ scrub_pii(norm_doc) → NormalisedDocument (scrubbed)
    ├─ is_near_duplicate(norm_doc) → if yes, return (skip)
    ├─ chunk(content) → [ Chunk, Chunk, ... ]
    ├─ embed_chunks(chunks) → [ (chunk, vector), ... ]
    ├─ for each (chunk, vector):
    │   └─ qdrant.upsert(vector, payload_with_namespace)
    ├─ UPDATE Email.status = "PROCESSED"
    └─ Loop back to BRPOP (wait for next item)
```

### Phase 3: Monitor Status

```
Frontend PipelineMonitor.tsx
    ↓ [every 2 seconds]
GET /api/document/{emailId}/status
    ↓
Queries Postgres Email table for this email
    ↓
Returns: { status: "PROCESSED", processedAt: "2026-06-19T14:35:00Z", ... }
    ↓
Frontend shows: ✓ Processed (green checkmark)
```

### Phase 4: Search

```
User types query: "What are our Q2 revenue figures?"
    ↓
POST /api/search { "query": "...", "limit": 5 }
    ↓ [Next.js]
Calls Python backend: POST /api/search with same body
    ↓ [Python]
Load embedding model (singleton)
    ↓
Embed query: "What are our..." → 384-dim vector
    ↓
search_qdrant(vector, namespace="user123:*", limit=5)
    ├─ Filter: must match user's namespace
    ├─ Search using HNSW index
    └─ Return [ { text, source, author, score }, ... ]
    ↓ [Next.js]
Returns to frontend: [ SearchResult, ... ]
    ↓
Displays in SearchResults.tsx with:
    ├─ Matched text snippet
    ├─ Source (Gmail, GitHub, Notion, Custom)
    ├─ Author
    ├─ Relevance score (0-100%)
    └─ Chunk position (e.g., "Chunk 2 of 5")
```

## File Modification Summary

### Files CREATED (New):
1. `app/api/document/[docId]/status/route.ts` — Status tracking
2. `app/api/workflow/[workflowId]/run/route.ts` — Execute workflow
3. `app/api/search/route.ts` — Search API (Next.js → Python)
4. `app/(dashboard)/_components/PipelineMonitor.tsx` — Monitor UI
5. `app/(dashboard)/_components/SearchResults.tsx` — Search UI
6. `backend/python/api/__init__.py` — Python API module
7. `backend/python/api/search.py` — Python search endpoint

### Files MODIFIED (Existing):
1. `app/api/gmail/sync/route.ts` — Added Redis queue publishing
2. `backend/python/db/redis_client.py` — Added `publish_queue_payload()`

### Files UNCHANGED (But Critical):
- `backend/python/workers/ingest.py` — Already correct
- `backend/python/pipeline/*` — All stages already implemented
- `backend/python/mappers/*` — All mappers ready
- `backend/python/db/qdrant_client.py` — Already has `search_qdrant()`
- `backend/python/config.py` — Central config hub
- Prisma schema — Has all status tracking fields

## Testing Checklist

### Unit Tests
- [ ] `GET /api/document/{docId}/status` returns correct status
- [ ] `POST /api/workflow/{workflowId}/run` queues documents
- [ ] `POST /api/search` calls Python backend correctly
- [ ] PipelineMonitor polls and updates status
- [ ] SearchResults displays Qdrant results

### Integration Tests
- [ ] Sync endpoint LPUSH to Redis (check with `redis-cli LLEN company_brain:ingest`)
- [ ] Worker picks up item from Redis (check Celery logs)
- [ ] Document status updates in Postgres (check Email.status)
- [ ] Vectors stored in Qdrant (check with Qdrant HTTP API)
- [ ] Search query returns results with correct namespace

### End-to-End Test
1. Click "Run Workflow"
2. Watch PipelineMonitor show status changes
3. Once all documents = PROCESSED, try a search
4. Verify search results appear with correct citations

## Performance Notes

- **Redis Queue**: LPUSH/BRPOP is O(1) — minimal overhead
- **Qdrant Search**: HNSW index ensures logarithmic search time
- **Embedding Cache**: Model loads once per worker (efficient)
- **Namespace Filter**: Applied at Qdrant level (fast filtering)
- **Status Polling**: Frontend polls every 2s (configurable, can use WebSocket later)

## Security Notes

- ✓ Namespace is SACRED (enforced in Qdrant filters)
- ✓ Auth required for all endpoints (Clerk)
- ✓ User can only see their own documents/execution
- ✓ Credentials stored in Postgres (needs encryption for production)
- ✓ PII scrubbed before embedding to Qdrant

## Future Enhancements

- [ ] WebSocket subscription to status updates (instead of polling)
- [ ] Batch document ingestion (POST /api/documents/ingest with multiple)
- [ ] Export search results to CSV/PDF
- [ ] RAG: LLM-generated answers with citations (in agents/ folder, deferred)
- [ ] C++ optimization for chunking/hashing (after profiling)
- [ ] Webhook for custom integrations

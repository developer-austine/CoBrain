# Frontend-Backend Integration Analysis

## Current State

### BACKEND (COMPLETE)
```
Redis Queue (company_brain:ingest)
    ↓ [BRPOP]
Python Worker (ingest.py)
    ├─ Step 1: Parse QueuePayload
    ├─ Step 2: Map (mapper.map() - converts source-specific JSON to RawDocument)
    ├─ Step 3: Normalise (8-stage pipeline)
    ├─ Step 4: Scrub PII
    ├─ Step 5: Dedup check (MinHash LSH)
    ├─ Step 6: Chunk (512 tokens, 102 overlap)
    ├─ Step 7: Embed (all-MiniLM-L6-v2, 384-dim)
    ├─ Step 8: Upsert to Qdrant
    └─ Step 9: Update Postgres status to PROCESSED

Infrastructure (Running in docker-compose):
├─ PostgreSQL (staging tables: Email, GitHubItem, NotionPage, CustomDocument)
├─ Redis (queue: company_brain:ingest, LSH dedup index)
├─ Qdrant (vector collection: company_brain)
├─ Celery Worker (processes queue items)
└─ Celery Beat (scheduler for retries/cleanup)
```

### FRONTEND (PARTIALLY COMPLETE - MISSING QUEUE PUBLISHER)
```
Current sync flow:
Sync Route (POST /api/{gmail,notion,github,custom}/sync)
    ├─ Fetches data from provider API
    ├─ Stores in Postgres staging table (Email, GitHubItem, NotionPage, CustomDocument)
    └─ Sets status = "PENDING"
    ❌ MISSING: Publish to Redis queue (STEP 2 from architecture doc)

Expected sync flow:
Sync Route
    ├─ Fetches data from provider API
    ├─ Stores in Postgres staging table
    ├─ Sets status = "PENDING"
    ├─ LPUSH to Redis queue: company_brain:ingest (QueuePayload)
    ├─ Sets status = "QUEUED"
    └─ Return response to frontend

Frontend Status Tracking:
❌ MISSING: No way to see document processing status in UI
❌ MISSING: No way to view Qdrant search results
```

## Critical Missing Pieces

### 1. **Queue Publisher** (Backend)
**Problem**: Sync routes write to Postgres but never queue to Redis
**Solution**: Add publisher that LPUSH QueuePayload to Redis after sync
**File**: `backend/python/lib/queue/publisher.py` (already exists but not called)
**Integration Point**: Each sync route (gmail/sync, notion/sync, etc.) must call publisher after upserting

### 2. **API Endpoint: Pipeline Status** (Frontend)
**Problem**: No way to track document processing status
**Solution**: API route `GET /api/document/{docId}/status` returns: { status, source, errorMessage, processedAt }
**File**: `app/api/document/[docId]/status/route.ts` (NEW)

### 3. **API Endpoint: Workflow Run** (Frontend)
**Problem**: "Run workflow" button doesn't actually execute anything
**Solution**: POST /api/workflow/{workflowId}/run triggers:
  - Create WorkflowExecution record
  - Queue all synced documents (iterate Email/GitHubItem/NotionPage/CustomDocument)
  - Update statuses to QUEUED
**File**: `app/api/workflow/[workflowId]/run/route.ts` (NEW)

### 4. **API Endpoint: Qdrant Search** (Frontend)
**Problem**: No way to fetch embeddings/results from Qdrant
**Solution**: POST /api/search with { query, namespace, limit }
  - Embed query using same model (all-MiniLM-L6-v2)
  - Search Qdrant vector DB
  - Return results with text, source, author, timestamp
**File**: `app/api/search/route.ts` (NEW)

### 5. **Frontend Components** (UI)
- Pipeline Status Monitor: Shows Email/GitHubItem/NotionPage/CustomDocument status
- Search Interface: Query Qdrant and display results with citations
- Execution Timeline: Show phase progress

## Data Flow (End-to-End)

```
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 1: USER SYNCS DATA (FRONTEND)                                  │
└─────────────────────────────────────────────────────────────────────┘
User clicks "Sync" → POST /api/gmail/sync
    ↓
Next.js Sync Route
    ├─ Calls Gmail API (with auth)
    ├─ UPSERT Email rows in Postgres (status="PENDING")
    ├─ LPUSH QueuePayload to Redis (NEEDS TO BE ADDED)
    └─ Return { synced: 42, skipped: 2 } to frontend

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 2: PYTHON WORKER PROCESSES (BACKEND)                           │
└─────────────────────────────────────────────────────────────────────┘
Redis Queue (company_brain:ingest) has items
    ↓ [BRPOP - worker blocks until item arrives]
Celery Worker (ingest.py)
    ├─ Parse QueuePayload
    ├─ Map: {gmail JSON} → RawDocument
    ├─ Normalise: 8 stages
    ├─ Scrub PII
    ├─ Dedup check
    ├─ Chunk (512 tokens)
    ├─ Embed (384-dim vectors)
    ├─ UPSERT to Qdrant (with namespace for RBAC)
    ├─ UPDATE Postgres Email.status = "PROCESSED"
    └─ Continue to next queue item

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 3: FRONTEND MONITORS PROGRESS                                  │
└─────────────────────────────────────────────────────────────────────┘
Frontend polls GET /api/document/{emailId}/status
    ├─ First call: { status: "QUEUED", processedAt: null }
    ├─ After worker runs: { status: "PROCESSED", processedAt: "2026-06-19T14:30:00Z" }
    └─ If error: { status: "FAILED", errorMessage: "PII detection failed" }

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 4: FRONTEND SEARCHES RESULTS                                   │
└─────────────────────────────────────────────────────────────────────┘
User asks question in chat → POST /api/search
    ├─ Embed query using all-MiniLM-L6-v2
    ├─ Search Qdrant with namespace filter
    ├─ Return [ { text, source, author, chunk_index }, ... ]
    └─ Display results with citations in UI
```

## File Relationship Map

```
=== BACKEND (Python) ===

config.py
├─ QUEUE_KEY = "company_brain:ingest"
├─ DATABASE_URL, REDIS_URL, QDRANT_URL
└─ All embedding/chunking/dedup settings

schemas/queue_payload.py
├─ QueuePayload (raw_document_id, source, content, namespace, ...)
└─ Used by: ingest.py, sync routes

db/redis_client.py
├─ queue_brpop() - CONSUMED BY: ingest.py
└─ publish_to_queue() - MUST BE CALLED BY: sync routes ⚠️

mappers/
├─ gmail.py: Gmail JSON → RawDocument
├─ notion.py: Notion JSON → RawDocument
├─ github.py: GitHub JSON → RawDocument
└─ custom.py: CustomDocument JSON → RawDocument

pipeline/
├─ normalizer.py: RawDocument → NormalisedDocument
├─ pii.py: Scrub PII
├─ deduplicator.py: MinHash LSH check
├─ chunker.py: Split into 512-token chunks
└─ embedder.py: Generate 384-dim vectors + upsert to Qdrant

workers/ingest.py (THE PIPELINE ORCHESTRATOR)
├─ BRPOP from Redis
├─ Calls all pipeline stages in sequence
├─ Updates Postgres status on completion
└─ Updates Qdrant on success

=== FRONTEND (Next.js) ===

app/api/{gmail,notion,github,custom}/sync/route.ts
├─ Fetch from provider API
├─ UPSERT to Postgres (Email, GitHubItem, NotionPage, CustomDocument)
├─ ❌ MISSING: LPUSH to Redis queue
└─ Return response

app/api/document/[docId]/status/route.ts (NEW)
├─ Query Postgres for Email/GitHubItem/NotionPage/CustomDocument status
├─ Return { status, errorMessage, processedAt }
└─ Used by: Frontend status monitor (polling)

app/api/workflow/[workflowId]/run/route.ts (NEW)
├─ Create WorkflowExecution record
├─ Iterate all synced documents in this workflow's connections
├─ Queue each document to Redis
├─ Update Postgres status = "QUEUED"
└─ Start Celery tasks or workers process automatically

app/api/search/route.ts (NEW)
├─ Accept { query, namespace, limit }
├─ Embed query (client-side library: sentence-transformers-js)
├─ Search Qdrant vector DB
├─ Return [ { text, source, author, ... }, ... ]
└─ Used by: Chat interface (/app/activity/chat)

components/
├─ PipelineStatusMonitor.tsx (NEW): Polls status API, shows progress bar
├─ SearchResults.tsx (NEW): Display Qdrant search results with citations
└─ ExecutionTimeline.tsx (NEW): Show workflow execution phases

=== INTEGRATION POINTS ===

Postgres ← Email, GitHubItem, NotionPage, CustomDocument (status tracking)
Redis → Queue (company_brain:ingest) [QueuePayload]
Qdrant ← Vector embeddings (chunks + metadata)

Frontend polls:
├─ GET /api/document/{docId}/status
└─ GET /api/search (with query)

Frontend triggers:
├─ POST /api/{source}/sync (existing - needs queue publisher)
└─ POST /api/workflow/{workflowId}/run (new)
```

## Implementation Priority

### Phase 1: Enable Queue Publishing (CRITICAL)
1. Add `publish_queue_payload()` function to `db/redis_client.py`
2. Update each sync route to call publisher after upserting
3. Test: Queue item appears in Redis, worker processes it

### Phase 2: Add Status Tracking APIs
1. Create `GET /api/document/{docId}/status` endpoint
2. Return accurate status from Postgres
3. Test: Frontend can poll and see status updates

### Phase 3: Add Execution Triggering
1. Create `POST /api/workflow/{workflowId}/run` endpoint
2. Queries all connections in workflow
3. Queues all pending documents
4. Test: Clicking "Run" actually queues items

### Phase 4: Add Search API
1. Create `POST /api/search` endpoint
2. Embed query + search Qdrant
3. Return results with metadata
4. Test: Chat interface returns real results

### Phase 5: Frontend Components
1. Pipeline Monitor: polls status every 2s
2. Search Results: display citations
3. Execution Timeline: phase tracking

## Test Checklist

- [ ] Sync endpoint LPUSH to Redis (check with redis-cli LLEN company_brain:ingest)
- [ ] Worker picks up item (check Celery logs)
- [ ] Postgres status updates to PROCESSED (check Email.status)
- [ ] Qdrant has vectors (check qdrant HTTP API)
- [ ] Frontend status API returns correct status
- [ ] Frontend can query search API and get results
- [ ] Frontend shows search results in chat interface

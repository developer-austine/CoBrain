# Remaining Tasks to Complete End-to-End Pipeline

## Critical Path (Must Do Before Full Testing)

### 1. Update Other Sync Routes (Gmail is Done ✓)

**Status**: 1 of 4 done

Apply the same `publishToQueue()` pattern to:

#### GitHub Sync
- **File**: `app/api/github/sync/route.ts`
- **Steps**:
  1. Add `auth()` import from Clerk
  2. Add `publishToQueue()` helper function (copy from Gmail)
  3. After `gitHubItem.upsert()`, call `publishToQueue()`
  4. Update response to include `queued` count
- **Estimated Time**: 5 minutes

#### Notion Sync
- **File**: `app/api/notion/sync/route.ts`
- **Steps**: Same as GitHub
- **Note**: Notion might use different batch sync approach; adapt pattern
- **Estimated Time**: 5 minutes

#### Custom API Sync
- **File**: `app/api/custom_api/sync/route.ts`
- **Steps**: Same as GitHub
- **Estimated Time**: 5 minutes

### 2. Integrate Frontend Components into Pages

**Status**: Components built but not displayed

#### Home Page (`app/(dashboard)/(home)/page.tsx`)
- [ ] Import `PipelineMonitor` component
- [ ] Import `SearchResults` component
- [ ] Add `<PipelineMonitor />` to display
- [ ] Add `<SearchResults />` to display
- [ ] (Optional) Query documents to monitor from Postgres

#### Activity/Chat Page (`app/activity/chat/page.tsx`)
- [ ] Replace/supplement `SearchResults` in chat interface
- [ ] Make search results appear inline with chat

#### Execution View (`app/connectors/runs/[workflowId]/[executionId]/page.tsx`)
- [ ] Add `PipelineMonitor` to show phase progress
- [ ] Show breakdown: emails/github/notion/custom counts
- [ ] Display execution timeline with phase completion

### 3. Verify All Dependencies Installed

- [ ] Check `requirements.txt` has `sentence-transformers`
  ```bash
  grep sentence-transformers backend/python/requirements.txt
  ```
- [ ] Check `package.json` has `redis` (for Node Redis client)
  ```bash
  grep redis package.json
  ```
- [ ] If missing, add and reinstall

### 4. Verify Environment Variables

- [ ] `.env` file has:
  - `DATABASE_URL`
  - `REDIS_URL`
  - `QDRANT_URL`
  - `PYTHON_BACKEND_URL=http://localhost:8000` (new)

### 5. Test with Real Data

- [ ] Create workflow with Gmail connection
- [ ] Click "Sync"
- [ ] Check Redis queue: `redis-cli LLEN company_brain:ingest`
- [ ] Watch PipelineMonitor status update
- [ ] Once PROCESSED, try search
- [ ] Verify search returns results

---

## Important (Should Do Soon)

### 6. Add Retry Logic for Failed Documents

- **Files to Update**:
  - `app/api/document/[docId]/retry/route.ts` (NEW)
  - `backend/python/workers/scheduler.py` (extend existing retry task)

- **Implementation**:
  ```ts
  // POST /api/document/{docId}/retry
  // Find document in Postgres (any source)
  // Change status: FAILED → PENDING
  // Call publishToQueue() again
  ```

- **Estimated Time**: 10 minutes

### 7. Add WebSocket Support (Replace Polling)

- **Purpose**: Real-time status updates instead of polling every 2s
- **Files to Create**:
  - `app/api/socket/[docId]/route.ts` (WebSocket endpoint)
  
- **Implementation**: Use Socket.io or similar
- **Estimated Time**: 30 minutes
- **Priority**: Low (polling works fine for now)

### 8. Add Batch Ingestion Endpoint

- **Endpoint**: `POST /api/documents/ingest`
- **Purpose**: Upload multiple documents at once (JSON payload or file)
- **Implementation**:
  ```ts
  // POST /api/documents/ingest
  // Accept: [ { source, author, content, timestamp, ... }, ... ]
  // For each: UPSERT to Postgres + LPUSH to Redis
  // Return: { ingested, queued }
  ```
- **Estimated Time**: 15 minutes
- **Priority**: Medium

### 9. Add Error Details Endpoint

- **Endpoint**: `GET /api/document/{docId}/error`
- **Purpose**: Get detailed error traceback for failed documents
- **Fields to return**: errorMessage, errorType, errorTraceback (if available)
- **Estimated Time**: 5 minutes
- **Priority**: Low

---

## Nice-to-Have (Future)

### 10. Add Filtering to PipelineMonitor

```tsx
<PipelineMonitor 
  documentIds={[...]}
  filterStatus="FAILED"  // Show only failed
  filterSource="gmail"   // Show only Gmail
/>
```

### 11. Add Export Functionality

- Export search results to CSV
- Export search results to PDF
- Export processing report

### 12. Add Charts & Metrics

- Processing throughput (docs/second)
- Status breakdown pie chart
- Error rate tracking
- Performance dashboard

### 13. Implement Namespace Scoping UI

- Show which namespace (user:source) documents are in
- Filter search by namespace
- Visual security indicator

### 14. Add Deduplication Feedback

- Show when a document was skipped as duplicate
- Show which document it's a duplicate of
- Allow manual override

---

## Testing Checklist (Do After Implementation)

### Unit Tests

- [ ] `test /api/github/sync` returns queued count
- [ ] `test /api/notion/sync` returns queued count
- [ ] `test /api/custom_api/sync` returns queued count
- [ ] `test PipelineMonitor` renders and polls
- [ ] `test SearchResults` submits query and shows results
- [ ] `test /api/document/{docId}/retry` changes status FAILED → PENDING

### Integration Tests

- [ ] GitHub sync queues documents to Redis
- [ ] Notion sync queues documents to Redis
- [ ] Custom API sync queues documents to Redis
- [ ] Worker processes GitHub items correctly
- [ ] Worker processes Notion pages correctly
- [ ] Worker processes custom documents correctly
- [ ] PipelineMonitor updates when status changes
- [ ] SearchResults shows different sources with different colors

### End-to-End Tests

- [ ] Full Gmail flow: sync → queue → process → search
- [ ] Full GitHub flow: sync → queue → process → search
- [ ] Full Notion flow: sync → queue → process → search
- [ ] Full Custom flow: sync → queue → process → search
- [ ] Multi-source search returns results from all sources
- [ ] Namespace filtering works (can only search own documents)
- [ ] Error handling: failed document shows error message

---

## Priority Matrix

### Do First (Today) ⚡
1. Update GitHub sync route (5 min)
2. Update Notion sync route (5 min)
3. Update Custom API sync route (5 min)
4. Integrate components into pages (15 min)
5. Run end-to-end test with real data (10 min)

**Total**: ~40 minutes

### Do Second (This Week)
1. Add retry logic (10 min)
2. Add batch ingest endpoint (15 min)
3. Test with multiple connectors (30 min)

**Total**: ~1 hour

### Do Third (This Month)
1. Add WebSocket support (30 min)
2. Add charts/metrics (1-2 hours)
3. Performance profiling (1-2 hours)
4. Production deployment prep (2-3 hours)

---

## Code Snippets for Quick Copy-Paste

### Sync Route Modification Template

```typescript
// app/api/github/sync/route.ts (TEMPLATE)

import { auth } from "@clerk/nextjs/server";

async function publishToQueue(document: any, connection: any, userId: string) {
  try {
    const queuePayload = {
      raw_document_id: document.id,
      source: "github",  // Change for each connector
      external_id: document.githubItemId,
      author: document.author || "Unknown",
      subject: document.title || "",
      content: document.body || "",
      timestamp: document.createdAt?.toISOString() || new Date().toISOString(),
      metadata: {
        // Add connector-specific metadata
      },
      connector_id: connection.id,
      namespace: `${userId}:github`,
    };

    const redis = require("redis").createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
    await redis.connect();
    await redis.lPush("company_brain:ingest", JSON.stringify(queuePayload));
    await redis.disconnect();
  } catch (err) {
    console.error("[Sync] Failed to publish to queue:", err);
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  // ... existing sync logic ...
  
  // After upserting document:
  await publishToQueue(document, connection, userId);
  queued++;

  return NextResponse.json({
    success: true,
    synced,
    queued,
    skipped,
    message: `Synced ${synced}, queued ${queued}`,
  });
}
```

### Component Integration Template

```tsx
// app/(dashboard)/(home)/page.tsx (TEMPLATE)

"use client";

import { useState, useEffect } from "react";
import { PipelineMonitor } from "./_components/PipelineMonitor";
import { SearchResults } from "./_components/SearchResults";
import prisma from "@/lib/prisma";

export default function HomePage() {
  const [documentIds, setDocumentIds] = useState<string[]>([]);

  useEffect(() => {
    // Fetch all documents to monitor
    async function loadDocuments() {
      // Query Postgres for all user's documents
      const [emails, github, notion, custom] = await Promise.all([
        // Get recent Email IDs
        // Get recent GitHubItem IDs
        // Get recent NotionPage IDs
        // Get recent CustomDocument IDs
      ]);
      const allIds = [...emails, ...github, ...notion, ...custom].map(d => d.id);
      setDocumentIds(allIds);
    }
    loadDocuments();
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
      <PipelineMonitor documentIds={documentIds} autoRefresh={true} />
      <SearchResults />
    </div>
  );
}
```

---

## Metrics to Track

After implementation, monitor:

- [ ] **Queue Depth**: Should be near 0 when no syncing
- [ ] **Processing Latency**: Average time from QUEUED → PROCESSED
- [ ] **Success Rate**: % of documents reaching PROCESSED (not FAILED)
- [ ] **Search Latency**: Time from query to results
- [ ] **Vector Count**: Growing as documents are processed
- [ ] **Error Rate**: % documents failing and why

---

## Known Issues to Watch For

1. **Namespace Filtering**: Make sure `namespace` field flows through entire pipeline
2. **Redis Connection**: Multiple Redis connections in Node can cause issues → use connection pooling
3. **Model Loading**: Embedding model takes ~5s first load → cache/load once
4. **Qdrant Vector Size**: Must match EMBEDDING_DIM (384) or search will fail
5. **Postgres Status Updates**: Must update AFTER Qdrant upsert succeeds, not before

---

## Questions/Blockers?

Check these files in order:
1. `QUICK_REFERENCE.md` - Fast lookup
2. `FILE_RELATIONS.md` - Architecture details
3. `QUICK_START_E2E_TEST.md` - Testing steps
4. `docs/architecture/architecture.txt` - Design decisions

---

**Last Updated**: June 19, 2026
**Status**: Ready for Phase 2 (update sync routes + integrate components)

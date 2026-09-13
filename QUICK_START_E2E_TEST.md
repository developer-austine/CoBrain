# End-to-End Pipeline Test Guide

This guide walks you through testing the complete pipeline from sync → queue → process → search.

## Prerequisites

### 1. Start Infrastructure Stack

```bash
cd backend
docker-compose up -d
```

Verify all services are healthy:
```bash
docker-compose ps
# Should show: postgres, redis, qdrant, worker, beat all running/healthy
```

### 2. Start Frontend Dev Server

```bash
pnpm install  # if not already done
pnpm dev
# Open http://localhost:3000
```

### 3. Start Python Search API (in a new terminal)

```bash
cd backend/python
python -m uvicorn api.search:create_search_app --host 0.0.0.0 --port 8000
# Should output: "Application startup complete"
```

## Step 1: Set Up a Workflow with Gmail Connection

1. **Navigate to**: http://localhost:3000/connectors
2. **Click**: "Create Workflow"
3. **Enter name**: "Test Pipeline"
4. **Add Node**: Drag "Gmail" from task menu
5. **Authenticate**: Click the Gmail node → "Connect Gmail"
   - Follow OAuth flow
   - Select an account with some recent emails
6. **Save**: Click top-right "Save"

## Step 2: Sync Documents from Gmail

1. **Right-click Gmail node** → "Sync"
   - Or use the node's sync button
   - Should return: `{ synced: X, queued: X, skipped: Y }`
2. **Check Redis** (in a new terminal):
   ```bash
   redis-cli
   > LLEN company_brain:ingest
   # Should show number of queued items (should match "synced" count above)
   ```

Expected output:
```
{
  "success": true,
  "synced": 5,
  "queued": 5,
  "skipped": 0,
  "connectedAs": "your-email@gmail.com",
  "message": "Synced 5 emails, queued 5 for processing"
}
```

## Step 3: Watch Pipeline Processing

### Option A: Frontend Monitor (Recommended)

1. **Navigate to**: http://localhost:3000 (home)
2. **Should see**: "Pipeline Monitor" card
3. **Watch status change**:
   - Documents start as "PENDING"
   - Move to "QUEUED" (after sync)
   - Move to "PROCESSING" (while worker runs)
   - Move to "PROCESSED" (✓ green checkmark when done)

Status updates every 2 seconds automatically.

### Option B: Manual Checks

**Check Celery Worker Logs**:
```bash
docker-compose logs -f worker
# Should see output like:
# [Ingest] Processing gmail document abc-123...
# [Ingest] Chunked into 5 chunks
# [Ingest] Successfully processed abc-123: 5 chunks stored
```

**Check Postgres Status**:
```bash
docker-compose exec postgres psql -U company_brain -d company_brain -c "SELECT id, status, processedAt FROM \"Email\" LIMIT 5;"
# Should show: status = PROCESSED, processedAt = current timestamp
```

**Check Qdrant Vectors**:
```bash
curl http://localhost:6333/collections/company_brain
# Should show: vector_count increased
```

## Step 4: Test Search

### Frontend Search

1. **Navigate to**: http://localhost:3000 (home)
2. **Should see**: "Semantic Search" card
3. **Enter query**: 
   - Try something specific to your Gmail (e.g., a project name, person name)
   - Example: "What did we discuss about budgets?"
4. **Click "Search"** (or press Enter)

### Expected Results

You should see:
- Card text from your emails displayed
- Source tag (GMAIL)
- Relevance percentage (0-100%)
- Author name
- Date
- Chunk position (if email was split)

Example result:
```
GMAIL | Relevance: 92%
"We discussed budget allocation for Q3. Total available: $500K..."
By: boss@company.com
6/19/2026
Chunk 2 of 3
```

### Backend Search (Direct Test)

Test the Python search API directly:
```bash
curl -X POST http://localhost:8000/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "budget",
    "namespace": "*",
    "limit": 5
  }'
```

Should return:
```json
{
  "results": [
    {
      "text": "We discussed budget allocation...",
      "source": "gmail",
      "author": "sender@company.com",
      "timestamp": "2026-06-19T14:30:00Z",
      "chunk_index": 2,
      "total_chunks": 3,
      "parent_doc_id": "email-uuid",
      "content_hash": "sha256...",
      "score": 0.92
    }
  ],
  "total": 5
}
```

## Step 5: Verify Complete Flow

### Checklist

- [ ] Sync endpoint queued X documents to Redis
- [ ] `LLEN company_brain:ingest` shows queued count
- [ ] Worker logs show processing happening
- [ ] Postgres Email.status changed from PENDING → PROCESSED
- [ ] Qdrant vector_count increased
- [ ] Frontend PipelineMonitor shows PROCESSED status (green checkmark)
- [ ] Frontend search returns results with correct text and source
- [ ] Search results show correct author and dates

### Success Criteria

✓ **Pipeline Status**: All documents show as PROCESSED (no FAILED)
✓ **Vector Storage**: `curl http://localhost:6333/collections/company_brain | jq .` shows vectors
✓ **Search Results**: Query returns relevant emails with correct metadata
✓ **No Errors**: No exceptions in worker logs or Next.js console

## Troubleshooting

### "Queue has items but worker isn't processing"

1. Check worker is running:
   ```bash
   docker-compose ps | grep worker
   ```
2. Check worker logs:
   ```bash
   docker-compose logs worker | tail -50
   ```
3. Check if Redis connection is working:
   ```bash
   docker-compose exec worker redis-cli -u $REDIS_URL ping
   # Should return: PONG
   ```

### "Documents stuck in QUEUED status"

1. Check if there are unprocessed items in Redis:
   ```bash
   redis-cli
   > LLEN company_brain:ingest
   # If > 0, worker isn't running or has crashed
   ```
2. Restart worker:
   ```bash
   docker-compose restart worker
   ```

### "Search returns no results"

1. Verify documents were processed:
   ```bash
   # Check Postgres
   docker-compose exec postgres psql -U company_brain -d company_brain \
     -c "SELECT count(*) FROM \"Email\" WHERE status='PROCESSED';"
   ```
2. Check Qdrant has vectors:
   ```bash
   curl http://localhost:6333/collections/company_brain | jq '.result.vectors_count'
   # Should be > 0
   ```
3. Test search API directly (see above) to check backend is working
4. Check Python search API logs:
   ```bash
   # Look for errors in the terminal running uvicorn
   ```

### "Emails not showing status updates in PipelineMonitor"

1. Check browser console for API errors (F12 → Console)
2. Verify documents are in database:
   ```bash
   docker-compose exec postgres psql -U company_brain -d company_brain \
     -c "SELECT id, status FROM \"Email\" LIMIT 5;"
   ```
3. Check status API directly:
   ```bash
   curl http://localhost:3000/api/document/{emailId}/status
   # Should return status object
   ```

## Performance Notes

- **First load**: Model loading takes ~5s
- **Processing**: ~100ms per email on average
- **Embedding**: ~50ms per 64 chunks batched
- **Qdrant search**: ~100ms for keyword search + vector search combined

## Next Steps After Successful Test

1. **Try other connectors**: GitHub, Notion, Custom API
2. **Test RAG**: Implement `/agents` for LLM-powered Q&A (deferred)
3. **Optimize**: Profile hot paths, consider C++ chunker (deferred)
4. **Deploy**: Containerize, push to production
5. **Scale**: Add more workers for higher throughput

## Test Scenarios

### Scenario 1: High Volume
- Sync 100+ emails at once
- Monitor worker throughput
- Check memory usage doesn't spike

### Scenario 2: Duplicate Detection
- Sync same emails twice
- Second sync should skip duplicates (via MinHash LSH)
- Check Postgres status = PROCESSED (not error)

### Scenario 3: PII Scrubbing
- Sync emails with phone numbers, SSNs, etc.
- Verify vectors in Qdrant don't contain raw PII
- Check pseudonym mappings in audit table (if using pseudonymise mode)

### Scenario 4: Cross-Source Search
- Sync from Gmail + GitHub + Notion
- Search for term that appears in multiple sources
- Verify results include all sources

## Debugging Commands

```bash
# Check Redis queue depth
redis-cli LLEN company_brain:ingest

# List all Redis keys
redis-cli KEYS "*"

# Flush Redis queue (DANGER: loses queued items)
redis-cli DEL company_brain:ingest

# Check Postgres document status
docker-compose exec postgres psql -U company_brain -d company_brain \
  -c "SELECT source::text, status::text, COUNT(*) FROM (
    SELECT 'email' as source, status FROM \"Email\"
    UNION ALL
    SELECT 'github' as source, status FROM \"GitHubItem\"
  ) GROUP BY source, status;"

# Check Qdrant stats
curl http://localhost:6333/collections/company_brain

# Tail worker logs (live)
docker-compose logs -f worker --tail=50
```

## Cleanup (Reset for Fresh Test)

```bash
# Flush all Redis data
docker-compose exec redis redis-cli FLUSHALL

# Reset Postgres documents
docker-compose exec postgres psql -U company_brain -d company_brain \
  -c "TRUNCATE \"Email\" CASCADE; TRUNCATE \"GitHubItem\" CASCADE; ..."

# Reset Qdrant
docker-compose exec qdrant curl -X DELETE http://localhost:6333/collections/company_brain

# Restart all services
docker-compose restart
```

---

**Good luck! Report any issues in the GitHub repo.**

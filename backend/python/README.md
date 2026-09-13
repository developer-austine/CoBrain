# Company Brain — Python Backend

The Python intelligence pipeline for document processing, embedding, and retrieval-augmented intelligence.

## Quick Start

### Local Development

1. **Set up environment**
   ```bash
   cd backend/python
   cp .env.example .env
   # Edit .env with your database and service URLs
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the ingest worker**
   ```bash
   python -m workers.ingest
   ```

### Docker Compose

Start all services (PostgreSQL, Redis, Qdrant, workers, scheduler):

```bash
docker-compose up -d
```

Check logs:
```bash
docker-compose logs -f worker
docker-compose logs -f beat
```

## Architecture

The backend implements the 10-step data flow:

```
STEP 1: Retrieval (Next.js) ──┐
                               ├─→ STEP 2: Publish to Redis
                               │
STEP 3: Consume from Redis ────→ STEP 4: Map (RawDocument)
                                          ↓
                                STEP 5: Normalise (8 stages)
                                          ↓
                                STEP 6: Scrub PII
                                          ↓
                                STEP 7: Deduplicate
                                          ↓
                                STEP 8: Chunk
                                          ↓
                                STEP 9: Embed + Store (Qdrant)
                                          ↓
                               STEP 10: Confirm (Postgres)
```

## Key Files

- **config.py** — Central configuration (env vars, constants)
- **schemas/** — Data contracts (RawDocument, NormalisedDocument, Chunk, QueuePayload)
- **pipeline/** — Document processing stages (normaliser, pii, chunker, embedder, deduplicator)
- **mappers/** — Source-specific payload converters (Gmail, Notion, GitHub, Custom)
- **db/** — Database and vector store clients (Redis, Postgres, Qdrant)
- **workers/** — Celery application and task definitions
  - `celery_app.py` — Celery configuration
  - `ingest.py` — Main consumer (BRPOP → full pipeline)
  - `scheduler.py` — Periodic maintenance tasks

## Configuration

All settings come from environment variables. See `.env.example` for a complete list.

Key variables:
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis queue and dedup index
- `QDRANT_URL` — Qdrant vector database
- `EMBEDDING_MODEL` — Model name (default: all-MiniLM-L6-v2)
- `CHUNK_SIZE` — Chunk size in tokens (default: 512)
- `DEDUP_THRESHOLD` — Jaccard similarity threshold (default: 0.85)

## Running Tests

```bash
pytest tests/ -v
```

## Monitoring

### Redis Queue
```bash
redis-cli
> LLEN company_brain:ingest    # Queue length
> BRPOP company_brain:ingest 0  # See next item (blocking)
```

### Qdrant
```
http://localhost:6333/dashboard
```

### Celery
```bash
celery -A workers.celery_app inspect active
celery -A workers.celery_app inspect stats
```

## Troubleshooting

**Worker not processing documents?**
- Check Redis: `redis-cli ping` should respond with PONG
- Check Postgres connection: `psql -d company_brain -c "SELECT 1"`
- Check logs: `docker-compose logs worker`

**Documents fail with "FAILED" status?**
- Check error message in Postgres: `SELECT id, status, "errorMessage" FROM "CustomDocument" WHERE status = 'FAILED'`
- Review worker logs for stack traces
- Retry with scheduler task (runs every 15 minutes)

**Embedding timeout?**
- Increase `DOCUMENT_PROCESSING_TIMEOUT` in config.py or .env
- Check GPU memory (if using GPU-accelerated embeddings)

## Performance

- Single worker processes ~10-20 documents/second (depending on size)
- Horizontal scaling: run multiple worker containers
- Dedup index is Redis-backed LSH (fast, memory-resident)
- Qdrant uses HNSW for approximate nearest-neighbor search

## Security

- All tokens encrypted at rest (AES-256-GCM) — see security.txt
- PII scrubbed before embedding (spaCy + Presidio)
- Namespace RBAC boundary flows from QueuePayload → Chunk → Qdrant
- No secrets in logs or error messages
- Database connection secured via TLS in production

## See Also

- [Architecture Documentation](../../docs/architecture/architecture.txt)
- [Security Architecture](../../docs/architecture/security.txt)
- [CLAUDE.md](../../CLAUDE.md)

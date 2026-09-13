# CoBrain — Predictive Execution Engine

[![Live Demo](https://img.shields.io/badge/Live%20Demo-CoBrain-blue?style=for-the-badge)](https://cobrain-theta.vercel.app)
[![GitHub](https://img.shields.io/badge/GitHub-Repository-black?style=for-the-badge)](https://github.com/developer-austine/cobrain)
[![Hackathon](https://img.shields.io/badge/Hackathon-Lemma%20x%20Comma%20Capital-purple?style=for-the-badge)](#)

> **Lemma x Comma Capital Multi-App AI Agent Hackathon Submission**

CoBrain is an AI-powered predictive execution engine that connects external applications, ingests information, processes documents asynchronously, generates searchable knowledge, and enables semantic retrieval through a unified workflow.

## 🔗 Project Links

- **Live Demo:** [cobrain-theta.vercel.app](https://cobrain-theta.vercel.app)
- **Repository:** [github.com/developer-austine/cobrain](https://github.com/developer-austine/cobrain)
- **Demo Video:** [Watch the demo](https://drive.google.com/file/d/14r4cM_Qg72x-45QcPRQwQrSS3yjIWFd8/view?usp=sharing)

---

## ✨ Core Capabilities

- **Multi-app connectors** — Connect services such as Gmail and GitHub.
- **Visual workflows** — Create workflows and arrange connector nodes through the frontend.
- **Asynchronous ingestion** — Queue documents for background processing using Redis and a worker.
- **Document processing** — Process, chunk, and index incoming content.
- **Vector search** — Store embeddings in Qdrant for semantic retrieval.
- **Pipeline monitoring** — Track documents from pending to processed.
- **Metadata-rich results** — Search results include relevance scores, authors, dates, and chunk information.
- **Containerized infrastructure** — Run the core backend services with Docker Compose.

## 🏗️ Architecture

```text
                    ┌──────────────────────┐
                    │   Next.js Frontend   │
                    │  Workflow Builder UI  │
                    │   Pipeline Monitor    │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │      Backend API     │
                    │  Workflow + Connectors│
                    │      Sync + Search   │
                    └───────┬───────┬──────┘
                            │       │
             ┌──────────────┘       └──────────────┐
             ▼                                     ▼
    ┌──────────────────┐                 ┌──────────────────┐
    │     PostgreSQL   │                 │      Redis       │
    │ Metadata + Status│                 │ Ingestion Queue  │
    └──────────────────┘                 └────────┬─────────┘
                                                   │
                                                   ▼
                                        ┌──────────────────┐
                                        │ Background Worker │
                                        │ Chunk + Process   │
                                        └────────┬─────────┘
                                                   │
                                                   ▼
                                        ┌──────────────────┐
                                        │      Qdrant      │
                                        │ Vector Database  │
                                        └──────────────────┘
```

### Processing Lifecycle

```text
PENDING
   ↓
QUEUED
   ↓
PROCESSING
   ↓
PROCESSED
```
---

### What We Are Solving

Modern software teams suffer from severe context fragmentation and operational state drift across disconnected enterprise platforms. Critical architectural decisions, feature specifications, and real-time operational shifts are constantly buried across Slack channels, Google Drive documents, Notion roadmaps, and GitHub repositories. Because traditional AI tools operate reactively as simple search indexes or basic chat summarizers, they only report on past events without understanding future execution impact. This lack of active synchronization leads to duplicated engineering work, missed architectural edge cases, unmapped code bottlenecks, and team burnout. CoBrain solves this problem by functioning as an active, predictive context engine. Instead of waiting for human queries, CoBrain continuously ingests live team inputs, uses Temporal Fusion Transformers (TFT) to project 13-week execution bottlenecks and context decay, and autonomously writes code fixes, issue tickets, and documentation updates directly back into your workflow tools before operational failures happen.

---


---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js, React, TypeScript |
| Backend API | Python API services |
| Database | PostgreSQL |
| Queue | Redis |
| Background processing | Worker service |
| Vector database | Qdrant |
| Infrastructure | Docker Compose |
| Package manager | pnpm |

---

## ⚡ Quick Start

### Prerequisites

Make sure the following are installed:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js](https://nodejs.org/)
- [pnpm](https://pnpm.io/installation)
- Git

### 1. Clone the repository

```bash
git clone https://github.com/developer-austine/cobrain.git
cd cobrain
```

### 2. Configure environment variables

Create a `.env` file in the project root, or place the variables in the backend and frontend environment files according to the project configuration.

```env
# Infrastructure
POSTGRES_USER=company_brain
POSTGRES_DB=company_brain
POSTGRES_PASSWORD=your_password
REDIS_URL=redis://localhost:6379/0
QDRANT_URL=http://localhost:6333

# Application services
PYTHON_API_URL=http://localhost:8000
NEXT_PUBLIC_API_URL=http://localhost:3000
```

> Do not commit real credentials, OAuth secrets, API keys, or production environment variables to Git.

### 3. Start backend infrastructure

```bash
cd backend
docker-compose up -d
```

Verify the services:

```bash
docker-compose ps
```

The expected services include:

- PostgreSQL
- Redis
- Qdrant
- Worker
- Beat, if configured in the Compose file

### 4. Start the frontend

Open a new terminal from the frontend/project directory:

```bash
pnpm install
pnpm dev
```

Open the application:

```text
http://localhost:3000
```

The backend API is expected to run at:

```text
http://localhost:8000
```

---

## 🧪 End-to-End Pipeline Test

This test verifies the complete flow:

```text
Connect Gmail → Sync emails → Queue documents → Process documents → Index vectors → Search
```

### Step 1: Create a workflow

1. Open `http://localhost:3000/connectors`.
2. Click **Create Workflow**.
3. Enter a workflow name, for example:
   ```text
   Test Pipeline
   ```
4. Drag the **Gmail** node into the workflow.
5. Select the Gmail node.
6. Click **Connect Gmail**.
7. Complete the OAuth flow.
8. Select an account containing recent emails.
9. Click **Save** in the top-right corner.

### Step 2: Sync Gmail documents

Right-click the Gmail node and select **Sync**, or use the node's sync action.

A successful response should look similar to:

```json
{
  "success": true,
  "synced": 5,
  "queued": 5,
  "skipped": 0,
  "connectedAs": "your-email@gmail.com",
  "message": "Synced 5 emails, queued 5 for processing"
}
```

Check the Redis queue:

```bash
redis-cli
```

```redis
LLEN company_brain:ingest
```

The queue length should correspond to the number of documents queued for processing.

### Step 3: Monitor processing

#### Option A: Frontend monitor

1. Open `http://localhost:3000`.
2. Locate the **Pipeline Monitor** card.
3. Watch documents move through the processing states:

```text
PENDING → QUEUED → PROCESSING → PROCESSED
```

The monitor should refresh automatically, approximately every two seconds when polling is enabled.

#### Option B: Worker logs

From the backend directory:

```bash
docker-compose logs -f worker
```

### Step 4: Verify PostgreSQL status

Run:

```bash
docker-compose exec postgres psql \
  -U company_brain \
  -d company_brain \
  -c 'SELECT id, status, "processedAt" FROM "Email" LIMIT 5;'
```

Processed documents should have a status of `PROCESSED`.

### Step 5: Verify Qdrant

Check the collection:

```bash
curl http://localhost:6333/collections/company_brain
```

The response should contain collection information and vector statistics.

### Step 6: Test semantic search

#### Frontend search

1. Open `http://localhost:3000`.
2. Locate **Semantic Search**.
3. Enter a query such as:
   ```text
   What did we discuss about budgets?
   ```
4. Click **Search**.

Search results should include relevant content and metadata such as:

- Relevance score
- Author
- Date
- Chunk position

#### Direct API search

```bash
curl -X POST http://localhost:8000/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "budget",
    "namespace": "*",
    "limit": 5
  }'
```

---

## ✅ Verification Checklist

Use this checklist to confirm that the full pipeline is working:

- [ ] Gmail is authenticated successfully.
- [ ] A workflow has been created and saved.
- [ ] The sync action returns the number of synced and queued documents.
- [ ] Redis contains queued ingestion items.
- [ ] Worker logs show document processing.
- [ ] PostgreSQL records move to `PROCESSED`.
- [ ] Qdrant vector counts increase.
- [ ] Semantic search returns relevant chunks.
- [ ] Search results include complete metadata.
- [ ] The frontend pipeline monitor reflects processing progress.

---

## 🔍 Troubleshooting

### Worker is not processing the queue

Check service status:

```bash
docker-compose ps
```

Inspect worker logs:

```bash
docker-compose logs worker --tail=50
```

Check Redis connectivity from the worker container:

```bash
docker-compose exec worker redis-cli -u "$REDIS_URL" ping
```

A healthy Redis connection should return:

```text
PONG
```

### Search returns no results

Check whether documents have been processed:

```bash
docker-compose exec postgres psql \
  -U company_brain \
  -d company_brain \
  -c 'SELECT count(*) FROM "Email" WHERE status = '\''PROCESSED'\'';'
```

Check Qdrant vector counts:

```bash
curl http://localhost:6333/collections/company_brain
```

If the vector count is zero, confirm that:

1. Documents were successfully queued.
2. The worker is running.
3. The worker can connect to Qdrant.
4. Embedding generation is configured correctly.
5. The target collection exists.

### Frontend cannot reach the API

Confirm that the backend is running:

```bash
curl http://localhost:8000
```

Then verify:

- `NEXT_PUBLIC_API_URL`
- API route prefixes
- Frontend proxy or rewrite configuration
- CORS configuration
- Docker network and exposed ports

### Gmail sync fails

Confirm that:

- OAuth credentials are configured.
- The redirect URI matches the configured OAuth application.
- The Gmail account has accessible messages.
- The connector has the required permissions.
- The workflow was saved after authentication.

---

## 🧹 Reset the Development Environment

> **Warning:** The following commands delete development data. Do not run them against production databases or collections.

### Flush Redis

```bash
docker-compose exec redis redis-cli FLUSHALL
```

### Reset PostgreSQL tables

```bash
docker-compose exec postgres psql \
  -U company_brain \
  -d company_brain \
  -c 'TRUNCATE "Email" CASCADE; TRUNCATE "GitHubItem" CASCADE;'
```

### Delete the Qdrant collection

```bash
docker-compose exec qdrant \
  curl -X DELETE http://localhost:6333/collections/company_brain
```

### Restart services

```bash
docker-compose restart
```

---

## 📁 Suggested Project Structure

```text
cobrain/
├── backend/
│   ├── docker-compose.yml
│   ├── api/
│   ├── workers/
│   ├── connectors/
│   └── ...
├── frontend/
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── ...
├── .env.example
├── README.md
└── ...
```

> The exact structure may differ depending on the current branch and implementation. Keep this section synchronized with the repository as the project evolves.

---

## 🔐 Security Notes

- Store secrets in environment variables.
- Never commit OAuth access tokens or refresh tokens.
- Use separate credentials for development and production.
- Restrict database, Redis, and Qdrant ports in production.
- Validate connector permissions before syncing data.
- Apply authentication and authorization to workflow and search endpoints.
- Avoid logging sensitive email contents or credentials.

---

## 🚀 Hackathon Value Proposition

CoBrain transforms disconnected application data into an actionable, searchable knowledge layer.

Instead of manually checking multiple applications, users can:

1. Connect their preferred tools.
2. Build a workflow visually.
3. Synchronize information from connected sources.
4. Process and index the data automatically.
5. Search the resulting knowledge base using natural language.
6. Monitor the execution pipeline in real time.

This creates a foundation for intelligent multi-application agents that can retrieve context, reason over connected data, and support future automated actions.

---

## 🗺️ Roadmap

- [ ] Add more application connectors.
- [ ] Expand workflow node types.
- [ ] Improve document deduplication.
- [ ] Add richer pipeline analytics.
- [ ] Add retry and dead-letter queue handling.
- [ ] Add role-based access control.
- [ ] Improve observability and structured logging.
- [ ] Add production deployment documentation.
- [ ] Support agent actions based on retrieved context.

---

## 📄 License

Add the project's applicable license here.

---

## 🙌 Acknowledgements

Built for the **Lemma x Comma Capital Multi-App AI Agent Hackathon**.

Developed by [Austine Ochieng'](https://github.com/developer-austine).

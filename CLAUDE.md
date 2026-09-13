# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

**Install dependencies:**
```bash
pnpm install
```

**Development server** (includes hot reload):
```bash
pnpm dev
```
Open http://localhost:3000 — app is served on port 3000.

**Build for production:**
```bash
pnpm build  # Runs prisma generate before Next.js build
```

**Start production server:**
```bash
pnpm start
```

**Linting:**
```bash
pnpm lint
```

**Tests** (Vitest):
```bash
pnpm test                              # run the whole suite once
pnpm exec vitest                       # watch mode
pnpm exec vitest run lib/chat/__tests__/format.test.ts   # a single file
pnpm exec vitest run -t "some name"    # a single test by name
```
Tests live in `**/__tests__/*.test.ts` (see `vitest.config.ts`). `@` aliases the repo root and `server-only` is stubbed, so server modules can be imported directly. The Python backend has no tests yet.

**Auth schema migration** (Better Auth tables live in the separate Neon DB, not Prisma):
```bash
pnpm auth:migrate   # scripts/migrate-auth.mjs
```

---

## Architecture Overview

This is a **company-knowledge / data-orchestration platform** (v0.1.0) with a full-stack architecture: Next.js frontend + Next.js API layer + Python backend workers + PostgreSQL + Redis + Qdrant.

### Two-Database Split (read this first)

There are **two separate Postgres databases**, and confusing them is the most common mistake:

- **Auth DB (Neon)** — holds Better Auth's `User`, `Session`, `Account`, `Verification` tables. Accessed via a raw `pg` `Pool` in `lib/auth.ts` (NOT Prisma). Its tables are **deliberately absent from `prisma/schema.prisma`**; managed with `pnpm auth:migrate`. URL comes from `AUTH_DATABASE_URL` / `NEON_DATABASE_URL`.
- **Business DB (Docker Postgres)** — everything in `prisma/schema.prisma` (workflows, connections, ingested items, Brain, chat history). Accessed via Prisma (`lib/prisma.ts`), which generates to `lib/generated/prisma/`.

`userId` fields across the business DB are Better Auth user IDs (foreign-key-less references into the auth DB). All multi-tenant scoping keys off these.

### High-Level Data Flow

1. **Workflow Definition** (UI)
   - User builds a visual pipeline in the flow editor (`/app/connectors/[workflowId]`)
   - Saves as `Workflow` model (contains name, definition, user ownership)
   - Flow is a directed acyclic graph (DAG) of nodes and edges

2. **Node Registry & Task Types**
   - Nodes represent data connectors or operations (GitHub, Gmail, Notion, Custom API)
   - Each task type is registered in `TaskRegistry` with metadata: inputs, outputs, credentials required
   - Entry point node marks where workflow execution begins
   - Tasks flow through phases: phase 1 (entry), phase 2+ (dependent nodes)

3. **Execution Planning** (`lib/workflow/executionPlan.ts`)
   - `createExecutionPlan()` converts flow (nodes + edges) into `WorkflowExecutionPlan` (array of phases)
   - Phases are topologically sorted based on edge dependencies
   - Validation: checks for entry point, missing inputs, circular deps
   - Returns `WorkflowExecutionPlanPhase[]` where each phase contains nodes that can run in parallel

4. **Connector OAuth/Auth** (`app/api/{github,gmail,notion,custom_api}/*`)
   - Each connector has auth/callback routes that follow OAuth 2.0 flow
   - Tokens stored in `GitHubConnection`, `GmailConnection`, `NotionConnection`, `CustomConnection` models
   - Linked to workflow + node ID (allows multiple auth instances per flow)
   - Custom API uses webhook-based ingestion (`POST /api/custom_api/ingest`)

5. **Data Ingestion** (`app/api/{...}/sync`)
   - Sync routes pull data from external sources (GitHub issues/PRs, Gmail messages, Notion pages)
   - Data stored in item models: `GitHubItem`, `Email`, `NotionPage`, `CustomDocument`
   - Items track pipeline status (`PENDING → RUNNING → COMPLETED` or `FAILED`)
   - Pipeline fields: `status`, `errorMessage`, `queuedAt`, `processedAt`

6. **Workflow Execution** (`actions/workflows/runWorkflow.ts`)
   - User clicks "Run" on a workflow
   - Creates `WorkflowExecution` record with `ExecutionPhase` entries (one per phase)
   - Each phase has status tracking: `PENDING → RUNNING → COMPLETED`
   - Queue system (Redis/Celery via Python backend) processes items through pipeline:
     - Normalize text (remove boilerplate, standardize format)
     - Detect & anonymize PII (spacy + presidio)
     - Chunk text into semantic blocks
     - Generate embeddings (sentence-transformers)
     - Publish to Qdrant vector DB

7. **Chat / Interactive Query** (real RAG — no longer simulated)
   - Two entry points share one RAG core (`lib/chat/rag.ts`):
     - `POST /api/chat` — legacy chat surface (`/app/activity`)
     - `POST /api/prompt` — the interactive intelligence layer (see below)
   - Flow: retrieve chunks from Qdrant via the **Python search-api** → regroup chunks into whole documents → synthesize a grounded answer with the Anthropic SDK (`@anthropic-ai/sdk`) → cite every document used. Streamed to the client as SSE frames.
   - LLM calls are guarded by `lib/chat/llmAvailability.ts` (config + circuit-breaker); when the LLM is unavailable it falls back to extractive answers.
   - Conversations persist as `ChatConversation` / `ChatMessage` (citations captured at answer time).

### Newer Subsystems (not in the original flow above)

- **Interactive intelligence layer** (`lib/interactive/`, `POST /api/prompt`) — accepts a structured `@`-mention submission `{ text, references, inputMethod, conversationId }`, classifies intent into **QUERY / CONFIG / WRITE** (`intentClassifier.ts`), audits it as a `PromptEvent`, then routes:
  - `QUERY` → RAG (read-only)
  - `CONFIG` → `agentConfigurator.ts` creates a standing `AgentConfig` rule (event-driven, e.g. "summarise every meeting into the brain")
  - `WRITE` → `pageMutation.ts` writes a `BrainBlock`
- **The Brain** (`BrainBlock` model, `/app/brain`) — derived knowledge with provenance (`sourceRefs`), confidence, and **append-only versioning**: an edit inserts a new row with `version+1` and sets `supersededById` on the old row. Never mutate a superseded block in place.
- **Connector auto-sync scheduler** (`lib/connector/sync/`, `POST /api/cron/sync`) — a single "dumb" endpoint poked frequently; `runner.ts` decides what's actually due per `policy.ts` cadence (Gmail ~5 min, Notion/Slack/Drive ~3 h) and locks each connection in `ConnectorSyncState` before running. Auth is machine-to-machine via `Bearer $CRON_SECRET` (never cookies). Triggered by **Vercel Cron** in prod (`vercel.json`) or **Celery Beat** locally.
- **Sources / uploads** (`lib/sources/`, `SourceFile`, `/app/sources`) — user-uploaded files stored in **MinIO** object storage; text extracted (`pdf-parse`, `mammoth`) and pushed through the same ingest pipeline. `scope` is `"unified"` or `"isolated:<name>"`.
- **Workflow knowledge links** (`WorkflowLink`, `lib/workflow/knowledgeScope.ts`) — a directed, transitive, **acyclic** graph letting one workflow search another's ingested knowledge (`source -> target` means target may read source).
- **Onboarding** (`lib/onboarding/`, `CompanyProfile`, `/app/onboarding`) — captured once after signup; drives an auto-generated starter workflow.

### Key Models & Relationships

**Core Workflow:**
- `Workflow` — user-created pipeline definition (name, userId, definition JSON)
- `WorkflowExecution` — individual run record (workflow + timestamp + status)
- `ExecutionPhase` — phase tracking within execution (phase num + status)

**Connectors & Auth:**
- `*Connection` (GitHub, Gmail, Notion, Custom) — stores oauth token + config
- `*Item` (GitHubItem, Email, NotionPage, CustomDocument) — ingested data + pipeline status

**Infrastructure:**
- `CustomSyncCursor` — tracks last-seen ID for incremental syncing

### Important Architectural Patterns

#### 1. **Node-Based Flow Editor**
   - Uses `@xyflow/react` for drag-drop UI in `/app/connectors/[workflowId]`
   - Flow is serialized as nodes + edges in `Workflow.definition`
   - Nodes carry task type + inputs; edges define dependencies
   - Visual feedback for connection validation + missing inputs

#### 2. **Pipeline Status Tracking**
   - Every ingested item has `status`, `errorMessage`, `queuedAt`, `processedAt`
   - Allows monitoring & retry of failed items
   - Phases in execution have same tracking (prevents re-running completed phases)

#### 3. **Multi-Tenant Data Isolation**
   - All models have `userId` field
   - Workflows, connections, and executions scoped to user
   - API routes validate user ownership before allowing operations

#### 4. **Asynchronous Processing**
   - Ingestion and processing jobs queued to Redis/Celery
   - Backend Python workers (normalizer, embedder) run asynchronously
   - UI polls status via API (`/api/{connector}/status`)

#### 5. **OAuth Credential Storage**
   - Credentials stored in DB (not secure for production — needs encryption)
   - Each connector has unique client ID/secret pair for webhook ingest
   - Connection tied to both workflow + specific node (allows reuse + swapping)

---

## File Organization

```
proxy.ts                     # Next.js 16 middleware (Edge): optimistic session-cookie gate
app/
  (auth)/                    # Better Auth pages (sign-in, sign-up)
  (dashboard)/               # Protected dashboard routes
  activity/                  # Chat & chat logs
  onboarding/                # First-run company profile → starter workflow
  connectors/                # Workflow editor + visual flow builder
  api/                       # Auth, connector OAuth/sync, prompt, cron, sources, stt…
  layout.tsx                 # Root layout (AppProviders)
lib/
  auth.ts                    # Better Auth instance (raw pg Pool → Neon)
  auth-client.ts             # Better Auth React client
  get-session.ts             # getSession / getCurrentUserId helpers (server)
  interactive/               # @-mention parsing, intent routing, agent rules, brain writes
  chat/                      # RAG core, retrieval, source intent, LLM availability
  connector/sync/            # Auto-sync scheduler (runner, policy, per-source)
  
lib/
  prisma.ts                  # Singleton Prisma client
  workflow/
    executionPlan.ts         # Flow → execution plan (topology sort + validation)
  connector/
    task/
      registry.ts            # Task type registry (GitHub, Gmail, Notion, Custom)
    createFlowNode.ts        # Factory for creating nodes
  queue/
    publisher.ts             # Redis queue publisher
  utils.ts                   # Shared utilities
  
types/
  appNode.ts                 # Node interface (extends @xyflow/react)
  task.ts                    # TaskType, TaskParam, TaskRegistry definitions
  workflow.ts                # Workflow, ExecutionPlan, Phase definitions
  
actions/
  workflows/                 # Server actions: CRUD, run, execution planning
  
prisma/
  schema.prisma              # Database schema (models + relations)
  
components/
  providers/
    AppProviders.tsx         # Wraps app with QueryProvider, ThemeProvider, etc.
  
backend/
  python/                    # Processing pipeline (normalizer, embedder, etc.)
  cpp/                       # Performance utilities (TBD)
```

---

## Key Technologies & Considerations

**Frontend (Next.js 16 + React 19):**
- App Router only (no Pages Router)
- Server Actions for mutations (`actions/workflows/*`)
- Server Components by default; use `"use client"` for interactive UI
- Prisma client runs only in server code (lib/prisma.ts + actions)
- Middleware lives in `proxy.ts` (Next.js 16 renamed `middleware.ts` → `proxy.ts`), runs on Edge, and only does an optimistic cookie check — it cannot import the pg-backed `auth`. Real session validation happens in Server Components/Actions via `lib/get-session.ts`, and API routes self-protect with `auth.api.getSession()`.

**Auth (Better Auth):**
- Email/password + optional Google/GitHub social login, gated on env vars being present
- `auth` in `lib/auth.ts` may be `null` if env is missing — call sites null-check it
- Sessions are cookie-based; server code reads them through `getSession()` / `getCurrentUserId()`

**Database:**
- PostgreSQL 15 with Prisma ORM v7.8.0
- Uses `@prisma/adapter-pg` (new Postgres driver, not pg/pgbouncer)
- Prisma generates client to `lib/generated/prisma/` on postinstall/build
- Schema defines both relationships + pipeline tracking fields

**Task Registry & Extensibility:**
- New connector types must be registered in `TaskRegistry`
- Each task type specifies: input params, output structure, whether it's entry point
- Node serialization preserves task type + user inputs for re-execution

**Vector Search (Qdrant):**
- Processed documents stored as embeddings in Qdrant
- Retrieval goes through the **Python search-api**, not directly from Next.js
- Powers the live RAG chat/prompt surfaces (`lib/chat/rag.ts`)

---

## AGENTS.md Context

This codebase uses Next.js 16, which has breaking changes from standard Next.js patterns. Before writing code:
1. Check `node_modules/next/dist/docs/` for current API signatures
2. Read deprecation notices — patterns from your training data may not apply
3. Verify App Router semantics (Server vs Client Components, Server Actions syntax)

---

## Common Tasks

### Adding a New Connector Type

1. Create task definition in `lib/connector/task/` with input/output metadata
2. Register in `TaskRegistry` with type name + entry point flag
3. Add OAuth routes in `app/api/{connector}/auth` and `app/api/{connector}/callback`
4. Add sync route `app/api/{connector}/sync` that ingests data
5. Add Prisma models for connection + items (with status tracking fields)
6. Update database schema: `prisma/schema.prisma` + run migrations
7. Backend Python workers process items through pipeline stages

### Debugging Workflow Execution

1. Check `WorkflowExecution` + `ExecutionPhase` records in DB for status
2. Look at individual item status: `CustomDocument.status`, `GitHubItem.status`, etc.
3. `errorMessage` field captures pipeline failures
4. Redis queue: check with `app/api/queue/flush` or inspect Celery logs
5. Frontend execution view: `/app/connectors/runs/[workflowId]/[executionId]`

### Running Workflows Locally

- Requires Docker Compose stack: PostgreSQL, Redis, Qdrant running
- Backend Python workers must be running (see `backend/python/`)
- Webhook testing: use ngrok or similar to expose local server for OAuth callbacks

---

## Known Limitations & TODOs

- Credentials stored in plaintext (needs encryption at rest)
- No error recovery / retry mechanism for failed pipeline stages
- Multi-tenant auth enforced at application level, not DB-level
- Python backend has no tests yet (TS side uses Vitest)
- Business DB references auth users by `userId` string only — no cross-DB foreign keys

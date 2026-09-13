# CoBrain — Engineering Documentation

> A company brain: connect your data sources, ingest them into a vector store,
> then **ask questions**, **cite answers back to the original document**, and let
> the AI **write what it learns** onto a durable Brain page.

This folder is the reference for maintaining and extending the system. It is
written for an engineer who has **never seen this codebase before**.

## Read in this order

| # | Document | What it answers |
|---|----------|-----------------|
| 1 | [01-architecture.txt](./01-architecture.txt) | What are the moving parts, and how do they fit together? |
| 2 | [02-ingestion-pipeline.txt](./02-ingestion-pipeline.txt) | How does a Gmail message / Notion page / uploaded PDF become searchable? |
| 3 | [03-intelligence-layer.txt](./03-intelligence-layer.txt) | How does a question become a cited answer? How does the AI write to the Brain? |
| 4 | [04-file-reference.txt](./04-file-reference.txt) | What is every file, and what depends on what? |
| 5 | [05-data-model.txt](./05-data-model.txt) | What does the database look like? |
| 6 | [06-operations.txt](./06-operations.txt) | How do I run it, deploy it, and what env keys exist? |
| 7 | [07-testing.txt](./07-testing.txt) | How is it tested, and how do I add tests? |

## The 60-second version

```mermaid
flowchart LR
    subgraph Sources
        GM[Gmail]
        NO[Notion]
        GH[GitHub]
        UP[Uploaded files]
    end

    subgraph Ingestion["Ingestion (Python)"]
        Q[(Redis queue)]
        P[normalize → PII scrub →<br/>dedupe → chunk → embed]
    end

    subgraph Stores
        PG[(Postgres<br/>source of truth)]
        QD[(Qdrant<br/>vectors)]
        MI[(MinIO<br/>files)]
    end

    subgraph Brain["Intelligence (Next.js)"]
        CH[Chat / Prompt]
        BR[Brain page]
    end

    GM & NO & GH --> PG
    UP --> MI
    UP --> PG
    PG --> Q --> P --> QD
    CH -->|retrieve| QD
    QD -->|resolve doc ids| PG
    CH -->|cited answer| BR
    BR -->|dual-write| Q
```

**The one idea that explains the design:** Postgres is the *source of truth*;
Qdrant only holds *vectors plus a document id*. Every answer retrieves from
Qdrant, then resolves those ids back to Postgres to produce a **citation with a
real link**. Nothing the AI says is unattributable.

## Vocabulary

| Term | Meaning |
|------|---------|
| **Source** | Where knowledge came from: `gmail`, `notion`, `github`, `slack`, `drive`, `upload`, `brain`, `custom`. This string is a payload field in Qdrant and drives all scoping. |
| **Chunk** | A slice of a document, embedded as one vector. |
| **Document** | The original record (an email, a Notion page, a PDF). Chunks are regrouped back into documents before synthesis. |
| **Namespace** | `userId:source` — the RBAC boundary stored on every vector. |
| **Reference / @-mention** | A *structured token* (`@notion`, `@brain`) the user picks from a dropdown. Never regex-parsed from text. |
| **Intent** | `QUERY` (read), `CONFIG` (standing rule), or `WRITE` (change the Brain). |
| **BrainBlock** | A durable unit of derived knowledge on the Brain page (a decision, a learned fact, a summary). |
| **Workflow** | A user-built pipeline of connector nodes. Workflows can be *linked* so one can read another's knowledge. |

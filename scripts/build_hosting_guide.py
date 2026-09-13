"""
Generate docs/CoBrain-Hosting-Guide.pdf.

    python scripts/build_hosting_guide.py

Content is grounded in this repository as it stands: docker-compose.prod.yml,
the Python worker set, and the service URLs the Next app actually reads.
"""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_pdf import Pdf  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "CoBrain-Hosting-Guide.pdf"


def build() -> None:
    p = Pdf("CoBrain — Hosting Guide")

    # ── cover ───────────────────────────────────────────────────────────────
    p.space(90)
    p.h1("CoBrain - Hosting Guide")
    p.body(
        "How to host this platform, which providers fit each piece, and the order "
        "they have to come up in. Written against this repository as it stands: "
        "docker-compose.prod.yml, the Python worker set, and the service URLs the "
        "Next.js app actually reads at runtime."
    )
    p.space(6)
    p.body("Domain: cobrain.co", 0.4)
    p.page_break()

    # ── 1. what you are hosting ─────────────────────────────────────────────
    p.h1("1. What you are actually hosting")
    p.body(
        "CoBrain is not one app. It is a web tier and a worker tier that share a "
        "queue and a database, plus four data services. Most hosting mistakes come "
        "from treating it as a single Next.js app and discovering the second half "
        "later."
    )

    p.h2("The two halves")
    p.row("Web tier (Next.js)", "UI, API routes, OAuth callbacks, RAG orchestration. "
          "Stateless - it holds nothing that cannot be rebuilt.", bold_left=True)
    p.row("Worker tier (Python)", "ingest (consumes the queue, embeds into Qdrant), "
          "worker + beat (Celery), search-api (vector retrieval), forecast-api (TFT).",
          bold_left=True)
    p.space(4)
    p.body(
        "The worker tier is not optional and not an add-on. The web tier only ever "
        "pushes onto Redis; if nothing consumes that queue, every upload and every "
        "connector sync succeeds, enqueues, and is never embedded. The app looks "
        "healthy while learning nothing."
    )

    p.h2("The four data services")
    p.row("PostgreSQL (business)", "Workflows, connections, ingested items, brain blocks.", bold_left=True)
    p.row("PostgreSQL (auth)", "Better Auth's own tables. Deliberately a separate database.", bold_left=True)
    p.row("Redis", "The ingest queue. Web pushes, Python pops.", bold_left=True)
    p.row("Qdrant", "Vector store. Written and read by Python only.", bold_left=True)
    p.row("Object storage", "Uploaded documents and extracted images (S3-compatible).", bold_left=True)

    # ── 2. topologies ───────────────────────────────────────────────────────
    p.page_break()
    p.h1("2. Three ways to host it")

    p.h2("A. Single host, everything in Docker  (recommended)")
    p.body(
        "One VPS running docker-compose.prod.yml. Caddy terminates TLS on 443; every "
        "other service binds to localhost or stays on the compose network. This is "
        "what the repository is already built for."
    )
    p.bullet("Cost: roughly $20-40/month for 4-8 GB RAM (Hetzner, DigitalOcean, Linode).")
    p.bullet("Web and workers share a private network - no public hop, no egress cost.")
    p.bullet("One deploy target, one secret store, one place to read logs.")
    p.bullet("Against it: you own the machine. Backups, patching, and a reboot are yours.")
    p.bullet("Scaling is vertical until it isn't - a bigger box, not more boxes.")

    p.h2("B. Managed everything, split tiers")
    p.body(
        "Vercel for the web tier, a PaaS for the Python tier, and managed data "
        "services. No servers to patch, at the cost of six vendors and public hops "
        "between tiers that used to be private calls."
    )
    p.bullet("Cost: realistically $60-120/month once past free tiers.")
    p.bullet("Vercel Hobby cannot run this: crons are once-daily and functions cap at 60s.")
    p.bullet("Every tier boundary becomes an authenticated internet call.")
    p.bullet("For it: genuinely no ops, and the web tier autoscales.")

    p.h2("C. One PaaS for everything")
    p.body(
        "Railway or Render running the web tier, the Python services, and managed "
        "Postgres and Redis in one project, on one private network."
    )
    p.bullet("Cost: roughly $40-80/month.")
    p.bullet("Keeps private networking and a single vendor; skips server maintenance.")
    p.bullet("The reasonable middle if you do not want to own a VPS.")

    p.space(6)
    p.h3("Recommendation")
    p.body(
        "Start with A. The compose file, the TLS proxy, the health gate and the "
        "rollback path already exist and are tested. Move to C if machine "
        "maintenance becomes the thing you dislike most. Choose B only if something "
        "outside engineering requires Vercel."
    )

    # ── 3. boot order ───────────────────────────────────────────────────────
    p.page_break()
    p.h1("3. The order things must come up in")
    p.body(
        "This is a dependency chain, not a checklist you can shuffle. Each step "
        "assumes the one above it is already answering."
    )

    steps = [
        ("1. DNS",
         "A records for cobrain.co and www -> the host. Do this first: TLS is issued "
         "on the first request, so a certificate cannot be obtained before the name "
         "resolves."),
        ("2. PostgreSQL (both)",
         "Business and auth databases reachable. Nothing else starts cleanly without "
         "them - /api/health returns 503 when Postgres is down, by design."),
        ("3. Migrations",
         "prisma migrate deploy runs to completion BEFORE the web tier starts. In "
         "compose this is the `migrate` service and the app waits on it. An app "
         "started against an older schema fails at the first query, not at boot."),
        ("4. Redis",
         "The queue must exist before either tier runs, or enqueues fail and syncs "
         "report success having stored nothing."),
        ("5. Qdrant + object storage",
         "The collection and the bucket. Workers create what they need on first use, "
         "but the endpoints have to answer."),
        ("6. Python workers",
         "search-api first (the web tier's RAG calls it), then ingest, worker, beat. "
         "Bring ingest up before opening the app to users, or the queue only grows."),
        ("7. Web tier",
         "Last. It depends on every one of the above. Point PYTHON_BACKEND_URL at "
         "search-api."),
        ("8. TLS / reverse proxy",
         "Caddy in front of the web tier. Only this process should publish ports."),
        ("9. Scheduler",
         "Celery beat pokes /api/cron/sync and /api/cron/extract every 5 minutes. If "
         "beat is not running, use an external pinger with the CRON_SECRET bearer "
         "token. Without this, connectors never refresh and uploads are never read."),
        ("10. OAuth registration",
         "Register every callback with each provider against the final domain. Do it "
         "last, because the URLs depend on the domain being settled."),
    ]
    for title, text in steps:
        p.h3(title)
        p.body(text)

    # ── 4. per-service picks ────────────────────────────────────────────────
    p.page_break()
    p.h1("4. What to use for each piece")

    p.h2("If you self-host (A)")
    p.row("Host", "Hetzner CX32/CX42, DigitalOcean, or Linode. 4-8 GB RAM.", bold_left=True)
    p.row("Everything else", "The bundled containers: Postgres, Redis, Qdrant, MinIO.", bold_left=True)
    p.row("Auth database", "Neon, kept separate as the schema already assumes.", bold_left=True)
    p.row("TLS", "Caddy - certificates are automatic and renewals need no cron.", bold_left=True)
    p.row("Backups", "Nightly pg_dump plus a volume snapshot. Untested backups are not backups.", bold_left=True)

    p.h2("If you split across managed services (B or C)")
    p.row("Web tier", "Vercel, Railway, or Render.", bold_left=True)
    p.row("Python tier", "Railway, Render, or Fly.io. Must be reachable over HTTPS.", bold_left=True)
    p.row("PostgreSQL", "Neon or Supabase.", bold_left=True)
    p.row("Redis", "Upstash - the existing ioredis client speaks its rediss:// endpoint.", bold_left=True)
    p.row("Qdrant", "Qdrant Cloud. Set on the Python side only; the web tier never queries it.", bold_left=True)
    p.row("Object storage", "Cloudflare R2 or S3. R2 has no egress fees.", bold_left=True)

    p.space(6)
    p.h3("The trap in this column")
    p.body(
        "In development every one of these points at localhost. On a split "
        "deployment localhost means the container itself, so REDIS_URL, "
        "PYTHON_BACKEND_URL and MINIO_ENDPOINT must all be changed. Miss one and "
        "the failure is partial: the app loads, sign-in works, and only chat or "
        "only uploads are broken."
    )

    # ── 5. what breaks ──────────────────────────────────────────────────────
    p.page_break()
    p.h1("5. Failure modes worth knowing before they happen")

    p.h3("The queue with no consumer")
    p.body(
        "Web tier up, ingest worker down. Uploads return 200, connectors report items "
        "synced, and nothing is ever embedded or answerable. Nothing errors. Check "
        "the queue depth on /brain/visualize, or LLEN company_brain:ingest."
    )

    p.h3("Nothing pokes the cron")
    p.body(
        "Connectors only refresh when /api/cron/sync is called, and uploads are only "
        "read when /api/cron/extract is. On Vercel Hobby, crons run once a day, which "
        "is not a schedule this app can use. Beat or an external pinger is mandatory."
    )

    p.h3("A localhost OAuth redirect in production")
    p.body(
        "The button works, the request leaves, and the user lands on the provider's "
        "error page. Nothing in this app logs it. Redirects are now derived from "
        "APP_URL and the boot check refuses to start if one still points at "
        "localhost or plain http."
    )

    p.h3("Migrations racing the app")
    p.body(
        "Start the web tier and the migration at once and the app serves requests "
        "against a schema mid-change. Compose orders this correctly; a manual deploy "
        "must too."
    )

    p.h3("The model bill")
    p.body(
        "Ingestion calls Claude per document. Roughly $0.17 for a 27-page PDF on "
        "Opus, about $0.03 on Haiku. Set a spend limit in the Anthropic console "
        "before connecting a large workspace, not after."
    )

    # ── 6. costs ────────────────────────────────────────────────────────────
    p.page_break()
    p.h1("6. Rough monthly cost")
    p.body("Excluding model usage, which is per-document and per-question.")
    p.space(4)
    p.row("A. Single VPS", "$20-40 - one box, all services", bold_left=True)
    p.row("C. One PaaS", "$40-80 - managed, private networking, one vendor", bold_left=True)
    p.row("B. Fully split", "$60-120 - six vendors, most operational surface", bold_left=True)
    p.space(6)
    p.body(
        "Model usage sits on top of all three and is the line most likely to "
        "surprise you. A demo is a few dollars; a large workspace ingested in one "
        "pass is not."
    )

    p.h2("Final checklist")
    for item in [
        "DNS resolves for the apex and www before the first deploy.",
        "Migrations run to completion before the web tier starts.",
        "The ingest worker is running - not just search-api.",
        "Something pokes both /api/cron/* endpoints every few minutes.",
        "No REDIS_URL, PYTHON_BACKEND_URL or MINIO_ENDPOINT still says localhost.",
        "Every OAuth callback registered against the production domain.",
        "A spend limit set in the Anthropic console.",
        "A backup taken, and restored once to prove it works.",
    ]:
        p.bullet(item)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    size = p.save(str(OUT))
    print(f"{OUT.relative_to(ROOT)}  {size:,} bytes  {len(p.pages)} pages")


if __name__ == "__main__":
    build()

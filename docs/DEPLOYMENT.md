# Production deployment — cobrain.co

Push to `main` → CI runs → images are built and pushed to GHCR → the host pulls
them, applies migrations, and restarts. If `https://cobrain.co/api/health` does
not return 200 within five minutes, the previous release is put back.

```
push to main
   └─ CI (.github/workflows/ci.yml)
        ├─ web:    tsc · lint · vitest · migration-drift check
        ├─ python: compileall · pytest
        └─ images: docker build (not pushed — proves the Dockerfiles still work)
             └─ Deploy (.github/workflows/deploy.yml)  ← only if CI succeeded
                  ├─ build & push web / migrate / backend, tagged :<sha> and :latest
                  ├─ ssh → pull → compose up (migrations gate the app start)
                  ├─ verify https://cobrain.co/api/health
                  └─ on failure: restore the previous release
```

## Why it deploys to a host rather than Vercel

`docker-compose.prod.yml` runs the Next.js app next to the Python services and
wires them together privately (`PYTHON_BACKEND_URL: http://search-api:8000`).
The app cannot be split onto Vercel without exposing the search API to the
internet, so the whole stack ships together.

One consequence worth knowing: **`vercel.json` no longer declares any crons.**
Scheduled work is Celery Beat's job in the `beat` service, which pokes
`/api/cron/sync` and `/api/cron/extract` every 5 minutes. Both paths are
covered; nothing is missing.

## If you deploy the web app to Vercel Hobby

Two Hobby limits bite, and both fail the *build* rather than showing up later:

1. **Crons run once per day.** `*/5 * * * *` is rejected outright with
   *"Hobby accounts are limited to daily cron jobs."* A once-daily Gmail sync is
   not worth having, so the `crons` block is gone rather than downgraded.
2. **Functions cap at 60 seconds** (Pro allows 300). Every `maxDuration` here is
   60 for that reason.

The scheduler was always designed to be driven from outside — `/api/cron/*`
takes a `Bearer $CRON_SECRET` and decides for itself what is due — so losing
Vercel's crons costs nothing. Pick whichever already applies:

**You already run the Python stack** (you must, for search). Point Celery Beat
at the Vercel deployment: set `APP_URL=https://cobrain.co` and `CRON_SECRET` on
the `beat` service. Nothing else to do — it pokes both endpoints every 5
minutes already.

**You don't run Beat.** Use an external pinger against both URLs, every 5
minutes, with header `Authorization: Bearer <CRON_SECRET>`:

- **cron-job.org** — free, 1-minute resolution, purpose-built for this.
- **Upstash QStash** — free tier includes schedules.
- **GitHub Actions `schedule`** — works, but check the cost first: every 5
  minutes is ~8,600 billable minutes/month against a 2,000-minute free
  allowance on a *private* repo. Free only if the repo is public, or at a much
  longer interval.

Because a poke now has 60 seconds rather than 300, `runPendingExtractions`
reads **one** document per tick instead of three — one document is up to ten
sequential model calls, and a batch reliably overran the limit. Throughput is
unchanged as long as something pokes every few minutes.

## Required GitHub secrets

Repository → Settings → Secrets and variables → Actions.

| Secret | What it is |
|---|---|
| `DEPLOY_HOST` | Host running the stack (IP or DNS name) |
| `DEPLOY_USER` | SSH user; must be in the `docker` group |
| `DEPLOY_SSH_KEY` | Private key for that user. Give it its own keypair — not your personal one |
| `DEPLOY_PATH` | Directory on the host holding `.env.production` (e.g. `/srv/cobrain`) |

`GITHUB_TOKEN` is provided automatically and is what pushes to GHCR — no PAT
needed.

If you want a human gate before production, add required reviewers to the
`production` environment; the deploy job already targets it.

## Host setup (once)

1. Docker Engine + the compose plugin.
2. DNS: `A` records for `cobrain.co` **and** `www.cobrain.co` → the host. Caddy
   provisions certificates on first request, so DNS must resolve before the
   first deploy or certificate issuance fails.
3. Open 80 and 443. Nothing else needs to be public — every other service binds
   to localhost or stays on the compose network.
4. Create `$DEPLOY_PATH/.env.production` (below). It is **never** committed and
   never copied by CI; it lives only on the host.

## `.env.production`

```ini
APP_URL=https://cobrain.co          # Better Auth issues cookies for this origin
DATABASE_URL=postgresql://…         # business DB
AUTH_DATABASE_URL=postgresql://…    # Better Auth's separate Neon DB
BETTER_AUTH_SECRET=…                # openssl rand -base64 32
REDIS_URL=redis://redis:6379
QDRANT_URL=http://qdrant:6333
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=…
MINIO_SECRET_KEY=…
MINIO_BUCKET=cobrain
POSTGRES_USER=…
POSTGRES_PASSWORD=…
POSTGRES_DB=company_brain
CRON_SECRET=…                       # Bearer token for /api/cron/*
ANTHROPIC_API_KEY=…
# Connectors — client id/secret only. Redirect URIs are NOT set here.
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
NOTION_CLIENT_ID=…
NOTION_CLIENT_SECRET=…
GITHUB_CLIENT_ID=…
GITHUB_CLIENT_SECRET=…
SLACK_CLIENT_ID=…
SLACK_CLIENT_SECRET=…
```

### OAuth redirects are derived, not configured

Each callback is computed from `APP_URL` as `<APP_URL>/api/<provider>/callback`,
so production resolves to `https://cobrain.co/...` and development to
`http://localhost:3000/...` from the same code path. There is nothing per-environment
to keep in sync, which is the point: five separate `*_REDIRECT_URI` values are
five chances to copy a dev value into production, and the symptom is a
provider-side error page this app never sees.

`assertProductionConfig()` refuses to boot in production if any redirect
resolves to localhost or plain `http`, so a stale override fails at start-up
rather than at a user's first click.

The `*_REDIRECT_URI` overrides still exist for a provider whose registered URI
cannot match the derived shape. **Leave them unset unless you need one.**

You must still register each derived URI with the provider:

| Provider | Register this |
|---|---|
| Google (Gmail) | `https://cobrain.co/api/gmail/callback` |
| Google (Drive) | `https://cobrain.co/api/drive/callback` |
| Notion | `https://cobrain.co/api/notion/callback` |
| GitHub | `https://cobrain.co/api/github/callback` |
| Slack | `https://cobrain.co/api/slack/callback` |

Gmail and Drive are separate callbacks on purpose. They share one Google OAuth
client, but landing a Drive grant on Gmail's callback would store it as a
GmailConnection.

## Rolling back

The health gate does it automatically. To go back further, run the **Deploy**
workflow manually and pass the commit SHA — every release is tagged in GHCR, so
this repoints images without rebuilding or reverting the branch.

## What CI deliberately does not do

- **No deploy from a PR.** Only `main` reaches the host.
- **No end-to-end connector tests.** Those need real OAuth grants; CI covers the
  logic below the provider boundary and the deploy is gated on `/api/health`.
- **No database seeding or destructive migration.** `prisma migrate deploy`
  applies committed migrations only; it never generates or resets.

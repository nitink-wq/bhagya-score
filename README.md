# Bhagya Score

AstroLokal's daily "Bhagya Score" mobile webview + its backing API. A stateless
Node.js (LTS **24**) + TypeScript service that serves the page and reads/writes a
**Postgres-compliant** database. Built to run as multiple pods on Kubernetes.

```
src/            TypeScript service (Fastify)
  config.ts     12-factor env config
  db/           generic Postgres client + repositories
  services/     business logic (IST date, content resolution, Gemini generator)
  jobs/         generateDailyContent.ts — one-shot nightly job entrypoint
  scheduler.ts  optional in-process nightly scheduler (multi-pod safe)
  routes/       /api/*, health probes, /internal/* (token-guarded)
  app.ts        Fastify app factory
  server.ts     entrypoint + graceful shutdown
migrations/     node-pg-migrate migrations (one file per DB change)
public/         the webview (index.html — single variant)
k8s/            Deployment, Service, HPA, ConfigMap, Secret, migration Job, CronJob
docs/           CONTENT_GENERATION.md — how the nightly Gemini pipeline works
Dockerfile      multi-stage, Node 24, non-root
docker-compose.yml  postgres + one-shot migrate + app (+ `generate` tool)
DEPLOYMENT_DEVTRON.md  step-by-step go-live guide for Devtron
```

> **Deploying on Devtron?** Start with **[DEPLOYMENT_DEVTRON.md](DEPLOYMENT_DEVTRON.md)** —
> it maps the Lokal Devtron flow onto this repo step by step.

## Run locally

```bash
docker compose up --build
# → http://localhost:3000            (Variant A)
```

Compose starts Postgres, runs the migrations **once** (`migrate` service), then starts the app.

### Without Docker

```bash
nvm use                 # Node 24 (.nvmrc)
npm install
cp .env.example .env     # point DATABASE_URL at any Postgres
npm run migrate:up       # apply migrations
npm run dev              # hot-reload dev server
```

## How each requirement is met

| Requirement | Where |
|---|---|
| **Generic client for any Postgres-compliant DB** | `src/db/client.ts` — thin `pg` (node-postgres) wrapper driven only by `DATABASE_URL`. No vendor SDK; works with RDS/Aurora, Cloud SQL, Supabase, self-hosted, etc. |
| **Kubernetes, multiple pods** | Stateless app; `k8s/deployment.yaml` runs `replicas: 3` with readiness (`/readyz`) + liveness (`/healthz`) probes, rolling updates, non-root/read-only container, graceful SIGTERM shutdown (`src/server.ts`), and `k8s/hpa.yaml` for autoscaling. Pool sized per pod via `DB_POOL_MAX`. |
| **Docker Compose for local testing** | `docker-compose.yml` — postgres + one-shot `migrate` + app. |
| **A migration for every DB change** | `migrations/` using **node-pg-migrate** (the standard migration framework for the pg ecosystem). Add one with `npm run migrate:create -- my-change`. |
| **A migrate script that runs once on deploy (official method)** | `node-pg-migrate up`, invoked by `k8s/migration-job.yaml` (a K8s `Job`) — runs once per deploy, tracks applied migrations in `pgmigrations`, and takes a Postgres advisory lock so concurrent pods never double-apply. |
| **Latest LTS runtime** | Node **24** — `.nvmrc`, `engines` in `package.json`, `node:24-alpine` base image. |

## Page capabilities

| Capability | Where |
|---|---|
| **Daily content via Gemini → DB → page** | Generated nightly and stored in `daily_content`; the page only reads it. See **[docs/CONTENT_GENERATION.md](docs/CONTENT_GENERATION.md)**. Code: `src/services/contentGenerator.ts`, `src/jobs/generateDailyContent.ts`, `src/scheduler.ts`. |
| **`?user_id=` passthrough on redirect** | The page reads `user_id` from its URL, never displays it, and carries it into every analytics event and into the CTA deep link. |
| **CTA deep-links into the app** | "Talk to an astrologer" navigates to `astrolokal://HomeScreen?source=bhagya_score&user_id=…&rashi=…` (one editable line, `DEEPLINK_SCHEME`, in `public/index.html`). |
| **Edge-case states** | No `user_id` → **login gate** (bypass with `?preview=1`). Every user lands on a **default sign** (Aries) and switches via the **rashi pill → bottom sheet** (the page takes only `user_id` — no `dob`). While loading → **shimmer** skeletons. DB unreachable → **saved content + "Retry" nudge** (6s fetch timeout). Nothing renderable → **error screen + Try again**. |

## Migrations

node-pg-migrate is the official migration workflow used here.

```bash
npm run migrate:create -- add-something   # scaffold migrations/<ts>_add-something.js
npm run migrate:up                        # apply pending
npm run migrate:down                      # roll back the last one
```

- Every schema/data change = a new file in `migrations/`. Nothing is applied ad-hoc.
- Applied migrations are recorded in the `pgmigrations` table, so `up` is idempotent.

### Run-once-on-deploy

Migrations are **not** run from the app pods (N pods would race). They run as a
single Kubernetes `Job`:

```bash
kubectl apply -f k8s/migration-job.yaml
kubectl wait --for=condition=complete job/bhagya-score-migrate --timeout=120s
kubectl apply -f k8s/deployment.yaml -f k8s/service.yaml -f k8s/hpa.yaml
```

With Helm, uncomment the `helm.sh/hook: pre-install,pre-upgrade` annotations in
`migration-job.yaml` to run it automatically on every release. Even if it is
retried or two run at once, the advisory lock + `pgmigrations` table keep it safe.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/daily-content?lang=en&date=YYYY-MM-DD` | Today's payload (IST); falls back to the latest row on-or-before the date; `404` if none. |
| POST | `/api/events` | Insert one analytics event `{event,user_id,rashi,lang,props}`. |
| POST | `/internal/generate-content` | Token-guarded (`x-internal-token`). Trigger a Gemini generation on demand; `404` when `INTERNAL_TOKEN` is unset. |
| GET | `/healthz` | Liveness (no DB). |
| GET | `/readyz` | Readiness (DB round-trip). |

The webview calls these on the same origin, so no credentials live in the browser.
If the API is unreachable it renders its embedded fallback content — never a blank screen.

## Deploy

- **Devtron (Lokal):** follow **[DEPLOYMENT_DEVTRON.md](DEPLOYMENT_DEVTRON.md)**.
- **Raw kubectl (reference):**
  1. Build & push the image: `docker build -t <registry>/bhagya-score:<tag> .`
  2. Set image in `k8s/migration-job.yaml`, `k8s/deployment.yaml`, `k8s/cronjob.yaml`.
  3. Create the real secret (`DATABASE_URL`, `GEMINI_API_KEY`) — see `k8s/secret.example.yaml`.
  4. `kubectl apply -f k8s/configmap.yaml -f <your-secret>.yaml`
  5. Run the migration Job, wait for completion, then apply the Deployment/Service/HPA/CronJob.

# Going Live on Devtron — a step-by-step for the Bhagya Score page

This is written for a **PM doing this for the first time**. It maps the Lokal Devtron
guide you shared onto *this* codebase, tells you exactly what to type where, and lists
what you must get from other teams (DevOps / C2S / the app developers).

> Naming used below (confirm the **project** name with your team — it's the Devtron
> "project" your app lives under, like `dostt` or `eaze` in the examples):
>
> | Thing | Value |
> |---|---|
> | project_name | `astrolokal` *(confirm)* |
> | app_name | `bhagya-score` |
> | Devtron app name | `astrolokal-bhagya-score` |
> | Container port | **3000** (already set in this codebase) |
> | DB name / user | `astrolokal_bhagya_score` (hyphens → underscores) |
> | Internal URL | `dev-astrolokal-bhagya-score.internal.getlokalapp.com` |
> | Service name | `astrolokal-bhagya-score-astrolokal-service` |

---

## The big picture (how Devtron deploys this)

```
  your Git repo  ──►  Devtron BUILD  ──►  Docker image  ──►  Devtron DEPLOY
   (Dockerfile)        (arm64)            (in registry)       (Lokal custom chart)
                                                                    │
                                                                    ▼
                                                          Kubernetes pods (2)
                                                                    │
   C2S team creates:  Postgres DB  +  internal URL routing  +  SSO (pomerium) role
```

Devtron replaces the raw Kubernetes files in `k8s/` — you **don't** apply those by hand.
`k8s/` stays in the repo only as reference for what Devtron's custom chart is doing for you.
What Devtron *does* use from the repo is the **Dockerfile**.

---

## Before you start (prerequisites)

1. **A Git repo in the Lokal org.** Right now this folder isn't a git repo yet.
   You (or a dev) must push it to the **private Lokal org git account** and use the **SSH** URL.
   Ask a dev to run `npm install` once and **commit the generated `package-lock.json`** — it
   makes builds reproducible (the Dockerfile still builds without it, but you want it committed).
2. **A Gemini API key** from Google AI Studio (for nightly content). Ask whoever owns the
   Google Cloud / AI Studio billing to issue one. You'll paste it into a Devtron *secret*.
3. **The exact app deep link** for the "Talk to an astrologer" button. I've set it to
   `astrolokal://HomeScreen` — **confirm the real scheme/path with the app developer** (see
   "Deep link" section below).

---

## Step 1 — Create the application

- Devtron → **Applications → Create → Custom app**
- Name: `astrolokal-bhagya-score` (pattern `{project}-{app}`)
- Project: choose `astrolokal` (your relevant project)

## Step 2 — Git repository

- Add the repo URL.
- Org git account → **private** → use the **SSH** URL.

## Step 3 — Build configuration

- Dockerfile path: `Dockerfile` (repo root). ✅ already present.
- Container repository: `dev/astrolokal-bhagya-score`
- **Advanced → Target platform: `arm64`** (matches the guide).

## Step 4 — Base deployment configuration (the custom chart)

- Choose **"Lokal Deployment custom chart"** from the dropdown (Dev).
- Update these fields — **the container port for this app is `3000`**:

  - **ContainerPort** → `3000`
  - **LivenessProbe** → port `3000` (this app answers `/healthz`)
  - **ReadinessProbe** → port `3000` (this app answers `/readyz`)
  - **Host** (Istio gateway) / Public URL pattern:
    - Internal tool pattern: `dev-astrolokal-bhagya-score.internal.getlokalapp.com`
  - **Service name** (virtual service route destination):
    `astrolokal-bhagya-score-astrolokal-service`

> This app exposes proper health endpoints so the probes are meaningful:
> `/healthz` = "process alive" (no DB), `/readyz` = "can reach Postgres" (returns 503 if not).
> Keep `tcp: true` probes if you prefer, but HTTP probes to `/healthz` and `/readyz` are better.

## Step 5 — Secrets (env variables)

Create **one secret** (pattern `astrolokal-bhagya-score`) and add these via the **GUI**
(avoids YAML syntax mistakes):

| Key | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://astrolokal_bhagya_score:<password>@<host>:5432/astrolokal_bhagya_score` | C2S gives you host/password. Add `?sslmode=require` if they say so. |
| `GEMINI_API_KEY` | `AIza…` | From Google AI Studio. |
| `CONTENT_SCHEDULER_ENABLED` | *(not needed — already the default)* | Nightly generation is ON by default when `GEMINI_API_KEY` is set. |
| `CONTENT_RUN_HOUR_IST` | `1` | Runs at 01:00 IST. |
| `CONTENT_LANGS` | `en` | Comma-separated if you add languages later. |
| `INTERNAL_TOKEN` | *(a long random string)* | Lets you trigger a manual content refresh for testing. Optional. |

`NODE_ENV`, `PORT=3000`, `LOG_LEVEL`, etc. can go in the ConfigMap/base config (see `k8s/configmap.yaml` for the full list) — but if in doubt, put `PORT=3000` in the secret/env too.

## Step 6 — Database migrations (run once per deploy)

The schema (tables) is created by **migrations**, using the official `node-pg-migrate` tool.
The command is always: `npx node-pg-migrate up` (idempotent — safe to re-run; it only applies
what's new and takes a DB lock so two runs can't clash).

You have two ways to run it on Devtron — **coordinate this one with DevOps**:

- **Preferred:** ask DevOps to add a **pre-deployment stage** to the CD pipeline that runs
  `npx node-pg-migrate up`. Then it runs automatically, once, before each rollout.
- **If pre-deploy isn't available yet:** after C2S creates the DB (Step 9) and your secret is
  set, ask DevOps to run it once against the deployed image, e.g.
  `kubectl exec <a-pod> -- npx node-pg-migrate up` (or run the same image as a one-off Job —
  see `k8s/migration-job.yaml`).

> **Chicken-and-egg to expect:** in the Lokal flow you deploy first, *then* C2S creates the DB.
> So your pods may crash-loop on the very first deploy until the DB exists and migrations have
> run. That's normal. Order for go-live: deploy → C2S creates DB → set `DATABASE_URL` →
> run migrations → pods go healthy.

## Step 7 — Nightly content generation

Already wired. With `CONTENT_SCHEDULER_ENABLED=true` (Step 5), each night at 01:00 IST the app
calls Gemini, writes tomorrow's content to the DB, and the page reads from the DB. Nothing else
to configure. (If you'd rather run it as a separate Kubernetes CronJob instead of inside the app,
`k8s/cronjob.yaml` is ready — but the in-app scheduler is the simplest for launch.)
See `docs/CONTENT_GENERATION.md` for how it works and how to verify it.

## Step 8 — Workflow

- Create a new workflow → **Build & Deploy from source code**.
- Click the **Build** block → set trigger to **Manual**.

## Step 9 — Deploy

- **Build & Deploy** tab → **Select Material** on the Build block → pick the git commit → **Start Build**.
- After build, run the Deploy block.
- In future: **code change → start from Build block**; **only Devtron config change → start from Deploy block**.

## Step 10 — Message the C2S / DevOps team (after first deploy)

> Remove hyphens (use underscores) in db_name/username before sending.

**DB creation:**
```
@here C2S Team, please create the following in the DEV environment for our new Devtron app.
Database in internal-tools postgres:

db_name  - astrolokal_bhagya_score
username - astrolokal_bhagya_score

CREATE USER astrolokal_bhagya_score WITH PASSWORD '<password>';
CREATE DATABASE astrolokal_bhagya_score OWNER astrolokal_bhagya_score;
GRANT ALL PRIVILEGES ON DATABASE astrolokal_bhagya_score TO astrolokal_bhagya_score;
ALTER DATABASE astrolokal_bhagya_score OWNER TO astrolokal_bhagya_score;
```

**Internal URL + SSO role (this is an internal tool):**
```
@here C2S Team, please create an internal URL to route to this new application in dev,
created through Devtron. Virtual service in Istio is already created.

url     - dev-astrolokal-bhagya-score.internal.getlokalapp.com
service - astrolokal-bhagya-score-astrolokal-service

Please also create a pomerium/keycloak role mapping and assign it to this group - <group_name>
Role_name - astrolokal-bhagya-score-dev-readonly
```

> If this page is meant to be opened by end users inside the AstroLokal app (not just internal
> staff), tell C2S it needs a **public** URL instead, and skip the pomerium role. Decide this early.

---

## What's still remaining to go live — checklist

**Product/decisions (you):**
- [ ] Confirm the Devtron **project** name (`astrolokal`?).
- [ ] Confirm **content languages** (currently `en` only).
- [ ] Confirm the **deep link** the CTA should open (currently `astrolokal://HomeScreen`) — get the
      exact scheme + path from the app dev, and confirm the app passes `user_id`/`source` through.

**Access / infra (other teams):**
- [ ] Push the code to the **Lokal org git repo** (SSH).
- [ ] Get a **Gemini API key**.
- [ ] C2S: **create the DB** (Step 10).
- [ ] C2S/DevOps: **run migrations once** (Step 6).
- [ ] C2S: **internal (or public) URL** + **pomerium role** (Step 10).

**Verify after deploy:**
- [ ] Open the internal URL → the page loads and shows a rashi + score.
- [ ] Open it **without** `?user_id` → you get the **login gate** ("Open AstroLokal app"). Add `?preview=1` to bypass the gate for internal viewing/testing.
- [ ] `?user_id=test123` → lands on the default sign (Aries); the rashi pill opens the "Choose your Rashi" sheet (the page only reads `user_id`).
- [ ] `?user_id=test123` in the URL → CTA opens the app (`astrolokal://HomeScreen`) and carries `user_id` through.
- [ ] Tap "Talk to an astrologer" → app opens the feed.
- [ ] Next morning: `SELECT * FROM content_generation_runs ORDER BY created_at DESC LIMIT 5;`
      shows a `success` row — nightly Gemini generation ran.
- [ ] `SELECT date, lang FROM daily_content ORDER BY date DESC LIMIT 5;` shows fresh rows.

---

## Deep link (CTA → feed)

The button "Talk to an astrologer" currently navigates to:

```
astrolokal://HomeScreen?source=bhagya_score&user_id=<user_id>&rashi=<rashi>
```

Edit one line in `public/index.html` if the scheme/path differs —
search for `DEEPLINK_SCHEME`. The `user_id` you pass in the page URL (`?user_id=…`) is carried
through automatically; it is never shown on screen.

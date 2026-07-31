# Daily content generation (Gemini → DB → page)

## What happens, in plain words

1. **Every night** (default 01:00 IST) a job wakes up and generates content for that
   same calendar day. The new day goes **live at the 6:00 AM IST cutover** — before 6 AM
   users still see the previous day.
2. It asks **Gemini** for fresh copy for all 12 signs in one call (score, band + reason
   lines, insight, the 3 "Things to look out for" lines, lucky values), passing
   yesterday's scores and the last 3 days of band lines so content doesn't repeat.
3. The job **validates** every sign hard: schema + numeric bounds (score 42-94), length
   limits, and a banned-word / em-dash / theme lint. Signs that fail are **regenerated
   once** (only the offending signs). If anything still fails, the run is **rejected and
   nothing is written** — yesterday's content stays live, so the page never breaks.
4. If valid, it **saves** the payload into the `daily_content` table for the target date.
5. The **web page just reads** from `daily_content` (via `/api/daily-content`). It never talks
   to Gemini itself. If the DB is ever empty/unreachable, the page falls back to the most recent
   day, and finally to copy embedded in the HTML.

```
         ┌─────────── nightly, once ───────────┐
  Gemini ─►  validate ─►  daily_content (DB)  ◄── reads ── the webview (/api/daily-content)
                              ▲
                     content_generation_runs (audit: did it work?)
```

This separation is deliberate: LLM calls are **slow, cost money, and sometimes fail**. Doing them
once per night (not per visitor) makes the page **fast, cheap, and reliable**.

## How the nightly job is triggered — pick ONE

| Option | How | When to use |
|---|---|---|
| **In-process scheduler** (the default — ON out of the box) | Nothing to configure: with `GEMINI_API_KEY` set, every pod ticks at `CONTENT_RUN_HOUR_IST` and a Postgres **advisory lock** ensures only ONE pod actually calls Gemini. Set `CONTENT_SCHEDULER_ENABLED=false` to opt out. | Simplest — no extra Devtron/K8s object. |
| **Kubernetes CronJob** | `k8s/cronjob.yaml` (same image, `node dist/jobs/generateDailyContent.js`). | Cleaner separation; if DevOps prefers a real CronJob. |
| **Manual / on-demand** | `POST /internal/generate-content` with header `x-internal-token: <INTERNAL_TOKEN>`, or `npm run generate` locally. | Testing, back-filling a date, or an external scheduler. |

All three call the **same** `generateAndStore()` function, so behaviour is identical.

## Where you edit the 3 things you asked about

| Thing | Where | How |
|---|---|---|
| **Gemini API key** | env var `GEMINI_API_KEY` (+ `GEMINI_MODEL`) | Local: put it in `.env`. Devtron: add it as a **secret**. Read in `src/config.ts`. The web server boots without it; only the generator needs it. |
| **The prompt** | `src/services/contentGenerator.ts` → **`SYSTEM_PROMPT`** (voice + hard rules) and **`buildUserPrompt()`** (date, schema, yesterday's scores, band history) | Edit the wording/tone/rules here. |
| **The output schema** | `src/services/contentGenerator.ts` → **`RESPONSE_SCHEMA`** (via `signArraySchema()`) | One object per sign: `{sign, score, band, reason, insight, signs[3], lucky:{num,time,cols}}`. Gemini is *forced* to this shape (`responseSchema`), and **`validateSign()`** is the final safety net (bounds, lengths, banned words, one-planet rule, exactly 3 look-out lines with no questions). |

Nothing else is required in code — the app is **self-sufficient**: given a `DATABASE_URL` and a
`GEMINI_API_KEY`, it calls Gemini, validates, writes `daily_content`, and serves the page from it.
The two things it needs from outside are just (1) a Postgres database and (2) the Gemini key.

## Config knobs (env)

| Env | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | — | Required for generation. The web server boots without it. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Change model without touching code. |
| `CONTENT_SCHEDULER_ENABLED` | `true` | Nightly scheduler is ON by default; set `false` only if you run the separate CronJob instead. |
| `CONTENT_RUN_HOUR_IST` | `1` | Hour (IST) to run. |
| `CONTENT_GENERATE_OFFSET_DAYS` | `0` | `0` = the 01:00 IST run generates the same calendar day; it goes live at the 6 AM cutover. |
| `CONTENT_LANGS` | `en` | Comma-separated languages to generate. |
| `INTERNAL_TOKEN` | — | Guards the manual endpoint. Empty = endpoint disabled (404). |

## Try it locally

```bash
# 1. bring up Postgres + run migrations + start the app
docker compose up --build         # page on http://localhost:3000

# 2. generate today/tomorrow's content once, by hand
GEMINI_API_KEY=AIza... docker compose run --rm generate
# or a specific date/langs:
GEMINI_API_KEY=AIza... GENERATE_DATE=2026-07-16 CONTENT_LANGS=en docker compose run --rm generate
```

## Verify it ran (SQL)

```sql
-- did the job run, and did it succeed?
SELECT target_date, lang, status, model, error, created_at
FROM content_generation_runs ORDER BY created_at DESC LIMIT 10;

-- what content is stored?
SELECT date, lang, payload->>'generated_by' AS source
FROM daily_content ORDER BY date DESC LIMIT 10;
```

`status` is one of `success`, `failed` (see `error`), or `skipped_locked` (another pod did it —
expected with multiple replicas).

## Safety properties

- **Never serves half-baked content:** invalid Gemini output is rejected; the previous day stays live.
- **Multi-pod safe:** advisory lock → exactly one generation per (date, lang) even with N pods.
- **Idempotent:** re-running for the same date just refreshes that row (`ON CONFLICT DO UPDATE`).
- **Observable:** every attempt is logged to `content_generation_runs`.
- **Costs are bounded:** one Gemini call per language per night, not per page view.

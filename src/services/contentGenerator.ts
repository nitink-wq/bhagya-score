/**
 * Nightly content generator.
 *
 * Flow:
 *   1. Ask Gemini for fresh copy for all 12 rashis (one call, structured JSON).
 *   2. Validate hard — a malformed/short response is REJECTED, never written.
 *   3. Upsert the validated payload into daily_content for the target date.
 *   4. Record the attempt in content_generation_runs (success / failed / skipped).
 *
 * Safety: a Postgres advisory lock means that even if several web pods run the
 * in-process scheduler, only ONE actually calls Gemini and writes for a given
 * (date, lang). If generation fails, we DO NOT overwrite — the webview keeps
 * serving the most recent good day (and its own embedded fallback as a last resort).
 */
import type { AppConfig } from '../config';
import type { Database } from '../db/client';
import type { DailyContentRepository, DailyPayload } from '../db/repositories/dailyContentRepo';
import type { GenerationRunsRepository } from '../db/repositories/generationRunsRepo';

/** The 12 rashis in fixed order — Gemini fills copy for exactly these, nothing invented. */
export const RASHIS: ReadonlyArray<{ key: string; name: string; date_range: string }> = [
  { key: 'mesh', name: 'Aries', date_range: '21 Mar – 19 Apr' },
  { key: 'vrishabh', name: 'Taurus', date_range: '20 Apr – 20 May' },
  { key: 'mithun', name: 'Gemini', date_range: '21 May – 20 Jun' },
  { key: 'kark', name: 'Cancer', date_range: '21 Jun – 22 Jul' },
  { key: 'simha', name: 'Leo', date_range: '23 Jul – 22 Aug' },
  { key: 'kanya', name: 'Virgo', date_range: '23 Aug – 22 Sep' },
  { key: 'tula', name: 'Libra', date_range: '23 Sep – 22 Oct' },
  { key: 'vrishchik', name: 'Scorpio', date_range: '23 Oct – 21 Nov' },
  { key: 'dhanu', name: 'Sagittarius', date_range: '22 Nov – 21 Dec' },
  { key: 'makar', name: 'Capricorn', date_range: '22 Dec – 19 Jan' },
  { key: 'kumbh', name: 'Aquarius', date_range: '20 Jan – 18 Feb' },
  { key: 'meen', name: 'Pisces', date_range: '19 Feb – 20 Mar' },
];

const INSIGHT_KEYS = ['love', 'career', 'money', 'health', 'travel'] as const;
const VALID_KEYS = new Set(RASHIS.map((r) => r.key));

/**
 * OUTPUT SCHEMA — the exact JSON shape Gemini must return. Passed to the API as
 * `responseSchema`, so the model is constrained to this structure (not just asked
 * nicely). Edit here if you change what each rashi should contain; keep buildPrompt()
 * in sync. Validation in validateAndBuildPayload() is the final safety net.
 */
const INSIGHT_CELL = {
  type: 'object',
  properties: { percent: { type: 'integer' }, text: { type: 'string' } },
  required: ['percent', 'text'],
} as const;

export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    rashis: {
      type: 'array',
      minItems: 12,
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: RASHIS.map((r) => r.key) },
          score: { type: 'integer' },
          overview: { type: 'string' },
          closing_hook: { type: 'string' },
          insights: {
            type: 'object',
            properties: {
              love: INSIGHT_CELL,
              career: INSIGHT_CELL,
              money: INSIGHT_CELL,
              health: INSIGHT_CELL,
              travel: INSIGHT_CELL,
            },
            required: ['love', 'career', 'money', 'health', 'travel'],
          },
        },
        required: ['key', 'score', 'overview', 'closing_hook', 'insights'],
      },
    },
  },
  required: ['rashis'],
} as const;

/** Minimal logger shape satisfied by both Fastify's pino logger and a console wrapper. */
export interface GenLogger {
  info: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

export interface GenerateDeps {
  config: AppConfig;
  db: Database;
  daily: DailyContentRepository;
  runs: GenerationRunsRepository;
  log?: GenLogger;
}

export interface GenerateResult {
  targetDate: string;
  lang: string;
  status: 'success' | 'skipped_locked';
}

/** Human-language name for a lang code, to steer Gemini's output language. */
function languageName(lang: string): string {
  const map: Record<string, string> = {
    en: 'simple, warm English',
    hi: 'simple, warm Hindi (Devanagari script)',
    ta: 'simple, warm Tamil',
    te: 'simple, warm Telugu',
  };
  return map[lang] ?? `simple, warm ${lang}`;
}

function buildPrompt(lang: string, targetDate: string): string {
  const signList = RASHIS.map((r) => `${r.key} (${r.name}, ${r.date_range})`).join('\n');
  return [
    `You are an Indian astrologer writing a daily "Bhagya Score" (luck score) for a mobile app aimed at tier-2/tier-3 India.`,
    `Write for the date ${targetDate}. Output language: ${languageName(lang)}.`,
    ``,
    `For EACH of these 12 rashis (use these exact keys):`,
    signList,
    ``,
    `Produce a JSON object with this EXACT shape and nothing else:`,
    `{`,
    `  "rashis": [`,
    `    {`,
    `      "key": "<one of the keys above>",`,
    `      "score": <integer 0-100, the day's luck score>,`,
    `      "overview": "<4-5 short simple sentences, hopeful and future-oriented, no scary predictions>",`,
    `      "closing_hook": "<1-2 lines teasing something an astrologer could reveal, to invite a consult>",`,
    `      "insights": {`,
    `        "love":   { "percent": <0-100>, "text": "<max 6 words>" },`,
    `        "career": { "percent": <0-100>, "text": "<max 6 words>" },`,
    `        "money":  { "percent": <0-100>, "text": "<max 6 words>" },`,
    `        "health": { "percent": <0-100>, "text": "<max 6 words>" },`,
    `        "travel": { "percent": <0-100>, "text": "<max 6 words>" }`,
    `      }`,
    `    }`,
    `    // ... all 12 rashis, in the order listed above`,
    `  ]`,
    `}`,
    ``,
    `Rules: keep language simple and kind; vary the scores realistically across signs;`,
    `never mention death, disease or disaster; return ONLY the JSON, no markdown fences.`,
  ].join('\n');
}

/** Call Gemini's REST API (no SDK needed — Node 24 has global fetch). Returns raw model text. */
async function callGemini(cfg: AppConfig, prompt: string): Promise<string> {
  const url =
    `${cfg.gemini.apiBase}/models/${encodeURIComponent(cfg.gemini.model)}:generateContent` +
    `?key=${encodeURIComponent(cfg.gemini.apiKey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.gemini.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA, // force the exact output structure
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned no text candidate');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function clampPercent(n: unknown): number {
  const v = typeof n === 'number' ? n : Number.parseInt(String(n), 10);
  if (Number.isNaN(v)) throw new Error('percent is not a number');
  return Math.max(0, Math.min(100, Math.round(v)));
}

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim().length === 0) throw new Error(`missing/empty ${field}`);
  return v.trim();
}

/** Parse + strictly validate Gemini output into the locked payload shape. Throws on anything off. */
export function validateAndBuildPayload(raw: string, lang: string, model: string): DailyPayload {
  // Strip accidental markdown fences if the model added them.
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed: { rashis?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Gemini output was not valid JSON');
  }
  const arr = parsed.rashis;
  if (!Array.isArray(arr) || arr.length !== RASHIS.length) {
    throw new Error(`expected ${RASHIS.length} rashis, got ${Array.isArray(arr) ? arr.length : 'none'}`);
  }

  const byKey = new Map<string, Record<string, unknown>>();
  for (const item of arr) {
    const o = item as Record<string, unknown>;
    const key = str(o.key, 'key');
    if (!VALID_KEYS.has(key)) throw new Error(`unknown rashi key "${key}"`);
    byKey.set(key, o);
  }

  // Rebuild in the canonical order using our fixed metadata (never trust model ordering/names).
  const rashis = RASHIS.map((meta) => {
    const o = byKey.get(meta.key);
    if (!o) throw new Error(`Gemini omitted rashi "${meta.key}"`);
    const insightsIn = (o.insights ?? {}) as Record<string, unknown>;
    const insights: Record<string, { percent: number; text: string }> = {};
    for (const ik of INSIGHT_KEYS) {
      const cell = insightsIn[ik] as Record<string, unknown> | undefined;
      if (!cell) throw new Error(`rashi "${meta.key}" missing insight "${ik}"`);
      insights[ik] = { percent: clampPercent(cell.percent), text: str(cell.text, `${meta.key}.${ik}.text`) };
    }
    return {
      key: meta.key,
      name: meta.name,
      date_range: meta.date_range,
      score: clampPercent(o.score),
      overview: str(o.overview, `${meta.key}.overview`),
      closing_hook: str(o.closing_hook, `${meta.key}.closing_hook`),
      insights,
    };
  });

  return {
    source: 'llm',
    generated_by: `gemini:${model}`,
    generated_at: new Date().toISOString(),
    lang,
    timezone: 'Asia/Kolkata',
    rashis,
  };
}

/**
 * Generate + store content for one (date, lang), guarded by an advisory lock.
 * Returns `skipped_locked` when another pod/process already holds the lock.
 * Throws (after recording `failed`) if Gemini or validation fails.
 */
export async function generateAndStore(
  deps: GenerateDeps,
  targetDate: string,
  lang: string,
): Promise<GenerateResult> {
  const { config: cfg, db, daily, runs, log } = deps;
  const lockKey = `bhagya:gen:${lang}:${targetDate}`;

  return db.withClient(async (client) => {
    const locked = (
      await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [
        lockKey,
      ])
    ).rows[0]?.locked;

    if (!locked) {
      log?.info({ targetDate, lang }, 'content generation skipped — another worker holds the lock');
      await runs.record({ targetDate, lang, model: cfg.gemini.model, status: 'skipped_locked', error: null });
      return { targetDate, lang, status: 'skipped_locked' as const };
    }

    try {
      log?.info({ targetDate, lang, model: cfg.gemini.model }, 'generating daily content via Gemini');
      const raw = await callGemini(cfg, buildPrompt(lang, targetDate));
      const payload = validateAndBuildPayload(raw, lang, cfg.gemini.model);
      await daily.upsert(targetDate, lang, payload);
      await runs.record({ targetDate, lang, model: cfg.gemini.model, status: 'success', error: null });
      log?.info({ targetDate, lang }, 'daily content stored');
      return { targetDate, lang, status: 'success' as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log?.error({ targetDate, lang, err: message }, 'daily content generation FAILED — keeping previous day');
      await runs.record({ targetDate, lang, model: cfg.gemini.model, status: 'failed', error: message.slice(0, 1000) });
      throw err;
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]);
    }
  });
}

/** Target date = IST today + offsetDays, formatted YYYY-MM-DD. */
export function targetDateIST(offsetDays: number, now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}

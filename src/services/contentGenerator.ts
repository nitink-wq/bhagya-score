/**
 * Nightly content generator (Gemini -> validate -> daily_content).
 *
 * Flow:
 *   1. Load context: yesterday's scores + the last 3 days of band lines per sign.
 *   2. Ask Gemini for all 12 signs in ONE call (structured JSON, schema-forced).
 *   3. Validate hard, per sign: schema, numeric bounds, length limits, and a
 *      banned-word / dash / theme lint (see LINT RULES below).
 *   4. If any sign fails, regenerate ONLY the offending signs, once.
 *   5. If anything still fails, REJECT the whole run — nothing is written and
 *      yesterday's row keeps serving (the API falls back to the latest date on
 *      or before the requested one).
 *   6. On success, upsert into daily_content + record the run in content_generation_runs.
 *
 * Cutover: content for date D goes live at 06:00 IST (see bhagyaService.contentDateIST).
 * The nightly job runs at 01:00 IST and generates for that same calendar day, so the
 * new day's content is sitting ready in the DB hours before the 6 AM flip.
 *
 * Safety: a Postgres advisory lock means that even if several web pods run the
 * in-process scheduler, only ONE actually calls Gemini for a given (date, lang).
 */
import type { AppConfig } from '../config';
import type { Database } from '../db/client';
import type { DailyContentRepository, DailyPayload } from '../db/repositories/dailyContentRepo';
import type { GenerationRunsRepository } from '../db/repositories/generationRunsRepo';

/** The 12 signs, fixed order. `sign` is the payload/schema id; `key` is the page's internal id. */
export const RASHIS: ReadonlyArray<{ key: string; sign: string; name: string }> = [
  { key: 'mesh', sign: 'aries', name: 'Aries' },
  { key: 'vrishabh', sign: 'taurus', name: 'Taurus' },
  { key: 'mithun', sign: 'gemini', name: 'Gemini' },
  { key: 'kark', sign: 'cancer', name: 'Cancer' },
  { key: 'simha', sign: 'leo', name: 'Leo' },
  { key: 'kanya', sign: 'virgo', name: 'Virgo' },
  { key: 'tula', sign: 'libra', name: 'Libra' },
  { key: 'vrishchik', sign: 'scorpio', name: 'Scorpio' },
  { key: 'dhanu', sign: 'sagittarius', name: 'Sagittarius' },
  { key: 'makar', sign: 'capricorn', name: 'Capricorn' },
  { key: 'kumbh', sign: 'aquarius', name: 'Aquarius' },
  { key: 'meen', sign: 'pisces', name: 'Pisces' },
];

const ALL_SIGNS = RASHIS.map((r) => r.sign);
const VALID_SIGNS = new Set(ALL_SIGNS);

/* ============================================================================
   OUTPUT SCHEMA — one JSON object per sign. This is what the page consumes.
   Passed to Gemini as `responseSchema` so the model is structurally constrained,
   and re-checked field by field in validateSign() (the real safety net).
============================================================================ */
export function signArraySchema(count: number) {
  return {
    type: 'array',
    minItems: count,
    maxItems: count,
    items: {
      type: 'object',
      properties: {
        sign: { type: 'string', enum: ALL_SIGNS },
        score: { type: 'integer', minimum: 42, maximum: 94 },
        band: { type: 'string' },
        reason: { type: 'string' },
        insight: { type: 'string' },
        signs: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
        lucky: {
          type: 'object',
          properties: {
            num: { type: 'integer' },
            time: { type: 'string' },
            cols: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
          },
          required: ['num', 'time', 'cols'],
        },
      },
      required: ['sign', 'score', 'band', 'reason', 'insight', 'signs', 'lucky'],
    },
  } as const;
}
export const RESPONSE_SCHEMA = signArraySchema(12);

/** Human-readable schema shown to the model inside the user prompt ({schema}). */
const SCHEMA_FOR_PROMPT = `{
  "sign": "aries",
  "score": 78,                    // int 42-94
  "band": "string",               // max 45 chars, short direct curious line under the score
  "reason": "string",             // max 60 chars, exactly one celestial reference
  "insight": "string",            // max 230 chars, 3 to 4 short sentences, ends on a mild open thread
  "signs": ["string","string","string"], // exactly 3 lines, each max 95 chars, each names one specific thing and stops before the answer
  "lucky": { "num": 9, "time": "7:15 AM", "cols": ["#hex","#hex","#hex"] }
}`;

/* ============================================================================
   THE PROMPT — edit the wording here. SYSTEM_PROMPT sets the voice + hard rules;
   buildUserPrompt() carries the date, schema and anti-repetition context.
============================================================================ */
export const SYSTEM_PROMPT = `You write the daily Bhagya Score content for AstroLokal, an astrology app for
users in small Indian cities. Output strict JSON only: an array of 12 objects,
one per zodiac sign, in the provided schema.

LANGUAGE RULES:
- The reader lives in a tier 2 or tier 3 Indian city. English is their second
  or third language and they know only basic English. Use only the most common
  everyday words, the kind seen in WhatsApp messages and TV ads. Class 5 to 6
  reading level. Short sentences, one idea per sentence.
- NO idioms or English phrases that need good English ("close a chapter",
  "silver lining", "on your side", "turn the page"). Say it straight instead:
  "an old problem can end today". If a Hindi-first reader would pause at a
  word, pick an easier word.
- BANNED words (too heavy or too astro-technical): celestial, cosmic, alignment,
  transit, retrograde, dasha, nakshatra, ascendant, aura, energies, manifest,
  destiny, favourable, auspicious (say "good" or "lucky" instead), circling,
  tension, trajectory. If a Class 8 student would not use the word, do not
  use it.
- NEVER use an em dash or en dash anywhere. Use a full stop or a comma instead.
- Planets are named plainly: the Moon, the Sun, Venus, Mercury, Mars, Jupiter,
  Saturn, Rahu. Say what they do in simple words ("the Moon is on your side").
- The voice is a trusted local astrologer talking to you, not a newspaper.

HARD RULES:
- score: integer 42 to 94. Across the 12 signs, spread the scores (no more than
  3 signs within 2 points of each other; at least 2 signs above 80, at most 2
  below 55). Everyone cannot have a great day.
- band: the one line shown right under the score. Short and direct, under 45
  characters. It must be a COMPLETE simple sentence, understood in one read.
  The subject must be a real thing in the reader's life: your work, one
  problem, your money, a talk, a person. The subject must NEVER be "the day",
  "today" or a feeling.
  Good: "Your work is being noticed today", "One old problem can end today".
  Bad: "A slow day is protecting you", "Gentle feelings guide your quiet day",
  "Your inner drive helps things move quickly" (these feel incomplete, nobody
  understands them). No flat verdicts, no questions.
- reason: exactly one planet reference, in simple words. Nothing technical.
- insight: 3 to 4 short sentences, max 230 characters total. It must be easy
  for a class 10 student in a small Indian city, curiosity driven, and led by
  the day's astrology. Talk about 1 or 2 topics only (3 at the very most) and
  go a little deeper on them. Do NOT write one line each about many areas of
  life (work + money + family + health in one insight is wrong). After reading
  it the user should feel "this is about my day" and want to ask an astrologer
  more. Specifics come from times, objects and small actions (by evening, an
  old promise, one phone call).
  Never claim things about the user's actual life (no "your office", "your
  wife"). Must NOT end with full closure ("the day is yours"). Always leave
  one small open thread.
- Ground every sign in the REAL sky for the given date: where the Moon
  actually is that day, which planet is strong, slow or changing. Say it
  plainly ("Mercury is moving slow this week", "the Moon is in your sign
  today"). Do not invent positions you are not sure of; when unsure, speak of
  the day in general terms instead of naming a position.
- signs: exactly 3 short lines per sign, max 95 characters each. Each line
  names ONE specific thing about the day (a person, a choice, money, work, a
  message, a plan) and stops BEFORE the answer. It says WHAT is happening,
  never WHY and never what to do. The missing "why" is what the astrologer
  explains. No questions inside a line. Mix good and watchful, never scary.
  Good: "One friend has gone quiet, and the reason is not what you think."
  Good: "A small yes this week can change your next month."
  Bad (resolves itself): "A friend is upset, so call them and say sorry."
  Bad (too vague): "Something good may happen today."
- BANNED themes everywhere: death, accident, illness or disease names, court
  or police matters, divorce, pregnancy predictions; absolute promises
  ("definitely", "100%", "will surely"); fear words ("beware", "danger",
  "big loss"); do and don't lists; any promise of money gains.
- Low scores are interesting, never scary. A 64 day has something worth
  understanding, not something to fear.`;

export interface PromptContext {
  /** e.g. { aries: 78, taurus: 64, ... } or null on the first run. */
  yesterdayScores: Record<string, number> | null;
  /** Last 3 days of band lines per sign, newest first. Empty when unavailable. */
  bandHistory: Record<string, string[]>;
}

export function buildUserPrompt(targetDate: string, ctx: PromptContext): string {
  const yesterday = ctx.yesterdayScores
    ? JSON.stringify(ctx.yesterdayScores)
    : 'not available (first run, pick any spread that follows the rules)';
  const history =
    Object.keys(ctx.bandHistory).length > 0
      ? JSON.stringify(ctx.bandHistory)
      : 'not available (first run)';
  return `Generate Bhagya Score content for ${targetDate} for all 12 zodiac signs in exactly
this schema: ${SCHEMA_FOR_PROMPT}
Yesterday's scores per sign (today's must differ by 2–12 points per sign):
${yesterday}
The last 3 days of band lines per sign (do not repeat phrasing): ${history}
Return a JSON array of 12 objects. Nothing else.`;
}

/** Second-chance prompt: regenerate ONLY the signs that failed validation. */
export function buildRepairPrompt(
  targetDate: string,
  failures: Array<{ sign: string; error: string }>,
  ctx: PromptContext,
): string {
  const list = failures.map((f) => `- ${f.sign}: ${f.error}`).join('\n');
  return `Your previous output for ${targetDate} failed validation for these signs only:
${list}

Regenerate content ONLY for these ${failures.length} sign(s), for ${targetDate}, in exactly
this schema: ${SCHEMA_FOR_PROMPT}
Fix the listed problems. All other rules still apply.
${ctx.yesterdayScores ? `Yesterday's scores per sign: ${JSON.stringify(ctx.yesterdayScores)}` : ''}
Return a JSON array of exactly ${failures.length} object(s). Nothing else.`;
}

/* ============================================================================
   LINT RULES — mechanical checks mirroring the prompt's language rules.
   A sign that trips any of these is regenerated once, else the run is rejected.
============================================================================ */
const BANNED_WORDS = [
  // heavy / astro-technical
  'celestial', 'cosmic', 'alignment', 'transit', 'retrograde', 'dasha', 'nakshatra',
  'ascendant', 'aura', 'energies', 'manifest', 'destiny', 'favourable', 'auspicious',
  'circling', 'tension', 'trajectory',
  // fear words + absolutes
  'beware', 'danger', 'definitely',
  // banned themes
  'death', 'accident', 'disease', 'divorce', 'pregnant', 'pregnancy', 'police',
];
const BANNED_PHRASES = ['100%', 'will surely', 'big loss', 'consult now'];
const PLANETS = ['moon', 'sun', 'venus', 'mercury', 'mars', 'jupiter', 'saturn', 'rahu'];
const LIMITS: Record<string, number> = { band: 45, reason: 60, insight: 230 };
const SIGN_LINE_MAX = 95;

function lintText(sign: string, field: string, text: string): void {
  if (/[—–]/.test(text)) throw new Error(`${sign}.${field}: contains an em/en dash`);
  const low = ` ${text.toLowerCase()} `;
  for (const w of BANNED_WORDS) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(text)) throw new Error(`${sign}.${field}: banned word "${w}"`);
  }
  for (const p of BANNED_PHRASES) {
    if (low.includes(p.toLowerCase())) throw new Error(`${sign}.${field}: banned phrase "${p}"`);
  }
}

function str(v: unknown, sign: string, field: string): string {
  if (typeof v !== 'string' || v.trim().length === 0) throw new Error(`${sign}.${field}: missing/empty`);
  return v.trim();
}

export interface SignContent {
  sign: string;
  score: number;
  band: string;
  reason: string;
  insight: string;
  /** Exactly 3 "things to look out for" lines. */
  signs: string[];
  lucky: { num: number; time: string; cols: string[] };
}

/** Validate ONE sign object. Throws with a specific reason on any violation. */
export function validateSign(item: unknown): SignContent {
  const o = item as Record<string, unknown>;
  const sign = str(o.sign, '?', 'sign').toLowerCase();
  if (!VALID_SIGNS.has(sign)) throw new Error(`unknown sign "${sign}"`);

  const score = typeof o.score === 'number' ? Math.round(o.score) : Number.parseInt(String(o.score), 10);
  if (Number.isNaN(score) || score < 42 || score > 94) throw new Error(`${sign}.score: must be an integer 42-94, got ${String(o.score)}`);

  const fields: Record<string, string> = {};
  for (const f of ['band', 'reason', 'insight'] as const) {
    const v = str(o[f], sign, f);
    if (v.length > LIMITS[f]) throw new Error(`${sign}.${f}: ${v.length} chars, max ${LIMITS[f]}`);
    lintText(sign, f, v);
    fields[f] = v;
  }

  // signs: exactly 3 curiosity lines — specific, unresolved, no questions
  const rawSigns = Array.isArray(o.signs) ? o.signs : [];
  if (rawSigns.length !== 3) throw new Error(`${sign}.signs: expected exactly 3 lines, got ${rawSigns.length}`);
  const signLines = rawSigns.map((v, i) => {
    const line = str(v, sign, `signs[${i}]`);
    if (line.length > SIGN_LINE_MAX) throw new Error(`${sign}.signs[${i}]: ${line.length} chars, max ${SIGN_LINE_MAX}`);
    if (line.includes('?')) throw new Error(`${sign}.signs[${i}]: questions are not allowed`);
    lintText(sign, `signs[${i}]`, line);
    return line;
  });

  // reason: exactly one plainly named planet
  const planetHits = PLANETS.filter((p) => new RegExp(`\\b${p}\\b`, 'i').test(fields.reason));
  if (planetHits.length !== 1) {
    throw new Error(`${sign}.reason: must name exactly one planet, found [${planetHits.join(', ') || 'none'}]`);
  }

  // insight: 3 to 4 short sentences
  const sentences = (fields.insight.match(/[.!?](\s|$)/g) ?? []).length;
  if (sentences < 3 || sentences > 4) throw new Error(`${sign}.insight: ${sentences} sentences, need 3-4`);

  // lucky
  const lk = (o.lucky ?? {}) as Record<string, unknown>;
  const num = typeof lk.num === 'number' ? Math.round(lk.num) : Number.parseInt(String(lk.num), 10);
  if (Number.isNaN(num) || num < 0 || num > 99) throw new Error(`${sign}.lucky.num: must be an integer 0-99`);
  const time = str(lk.time, sign, 'lucky.time');
  if (!/^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(time)) throw new Error(`${sign}.lucky.time: expected "H:MM AM/PM", got "${time}"`);
  const cols = Array.isArray(lk.cols) ? lk.cols.map(String) : [];
  if (cols.length !== 3 || cols.some((c) => !/^#[0-9a-fA-F]{6}$/.test(c))) {
    throw new Error(`${sign}.lucky.cols: expected exactly 3 "#rrggbb" colours`);
  }

  return {
    sign, score,
    band: fields.band, reason: fields.reason, insight: fields.insight,
    signs: signLines,
    lucky: { num, time: time.toUpperCase(), cols },
  };
}

/** Parse a raw Gemini response and validate every item. Never throws for per-sign
 *  problems — those come back in `failures` so we can regenerate just the bad signs. */
export function validateSigns(raw: string): { valid: Map<string, SignContent>; failures: Array<{ sign: string; error: string }> } {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { valid: new Map(), failures: ALL_SIGNS.map((s) => ({ sign: s, error: 'response was not valid JSON' })) };
  }
  const arr = Array.isArray(parsed) ? parsed : (parsed as { rashis?: unknown[] })?.rashis;
  if (!Array.isArray(arr)) {
    return { valid: new Map(), failures: ALL_SIGNS.map((s) => ({ sign: s, error: 'response was not a JSON array' })) };
  }
  const valid = new Map<string, SignContent>();
  const failures: Array<{ sign: string; error: string }> = [];
  for (const item of arr) {
    try {
      const row = validateSign(item);
      valid.set(row.sign, row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const sign = String((item as Record<string, unknown>)?.sign ?? 'unknown');
      failures.push({ sign, error: msg });
    }
  }
  return { valid, failures };
}

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

/** Call Gemini's REST API (no SDK needed — Node 24 has global fetch). Returns raw model text. */
async function callGemini(cfg: AppConfig, userPrompt: string, expectedCount: number): Promise<string> {
  const url =
    `${cfg.gemini.apiBase}/models/${encodeURIComponent(cfg.gemini.model)}:generateContent` +
    `?key=${encodeURIComponent(cfg.gemini.apiKey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.gemini.timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.9,
          responseMimeType: 'application/json',
          responseSchema: signArraySchema(expectedCount), // force the exact output structure
        },
      }),
    });
  } catch (err) {
    // Network-level failures (blocked egress, DNS, timeout) surface here. Node's
    // fetch throws with a blank top-level message and the real reason in `.cause`,
    // so unwrap it — otherwise the caller sees an empty error and cannot diagnose.
    if (controller.signal.aborted) {
      throw new Error(`Gemini request timed out after ${cfg.gemini.timeoutMs}ms (no response from ${cfg.gemini.apiBase})`);
    }
    const cause = (err as { cause?: unknown }).cause;
    const causeMsg =
      cause instanceof Error ? cause.message :
      cause !== undefined ? String(cause) : '';
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini request failed to reach ${cfg.gemini.apiBase}: ${[base, causeMsg].filter(Boolean).join(' / ') || 'unknown network error'}`);
  } finally {
    clearTimeout(timer);
  }

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
}

/** Yesterday's scores + last-3-days band lines, for the anti-repetition prompt context. */
async function loadPromptContext(
  daily: DailyContentRepository,
  targetDate: string,
  lang: string,
): Promise<PromptContext> {
  const rows = await daily.getRecentRows(lang, targetDate, 4); // up to 3 prior days (+ maybe target itself)
  const prior = rows.filter((r) => r.date < targetDate).slice(0, 3);

  let yesterdayScores: Record<string, number> | null = null;
  const bandHistory: Record<string, string[]> = {};
  for (const [i, row] of prior.entries()) {
    const rashis = (row.payload?.rashis ?? []) as Array<Record<string, unknown>>;
    for (const r of rashis) {
      const sign = String(r.sign ?? '').toLowerCase();
      if (!VALID_SIGNS.has(sign)) continue; // ignore old-schema rows
      if (i === 0 && typeof r.score === 'number') {
        yesterdayScores = yesterdayScores ?? {};
        yesterdayScores[sign] = r.score as number;
      }
      if (typeof r.band === 'string' && r.band) {
        (bandHistory[sign] = bandHistory[sign] ?? []).push(r.band);
      }
    }
  }
  return { yesterdayScores, bandHistory };
}

/**
 * Generate + store content for one (date, lang), guarded by an advisory lock.
 * Per-sign failures get ONE repair call for just those signs; if anything still
 * fails, the run is rejected and the previous day's content stays live.
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
      const ctx = await loadPromptContext(daily, targetDate, lang);
      log?.info({ targetDate, lang, model: cfg.gemini.model }, 'generating daily content via Gemini');

      const raw = await callGemini(cfg, buildUserPrompt(targetDate, ctx), 12);
      const first = validateSigns(raw);
      const rows = first.valid;

      // Signs missing from the response are failures too.
      const missing = ALL_SIGNS.filter((s) => !rows.has(s) && !first.failures.some((f) => f.sign === s));
      let failures = [...first.failures, ...missing.map((s) => ({ sign: s, error: 'missing from response' }))];

      if (failures.length > 0) {
        log?.info({ targetDate, lang, failures }, `regenerating ${failures.length} failed sign(s), one retry`);
        const raw2 = await callGemini(cfg, buildRepairPrompt(targetDate, failures, ctx), failures.length);
        for (const row of validateSigns(raw2).valid.values()) rows.set(row.sign, row);
        failures = ALL_SIGNS.filter((s) => !rows.has(s)).map((s) => ({ sign: s, error: 'still invalid after one repair' }));
      }

      if (failures.length > 0) {
        throw new Error(`rejected after repair; invalid signs: ${failures.map((f) => f.sign).join(', ')}`);
      }

      const payload: DailyPayload = {
        source: 'llm',
        generated_by: `gemini:${cfg.gemini.model}`,
        generated_at: new Date().toISOString(),
        lang,
        timezone: 'Asia/Kolkata',
        rashis: ALL_SIGNS.map((s) => rows.get(s)!),
      };

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

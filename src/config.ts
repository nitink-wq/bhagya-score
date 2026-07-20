/**
 * Central 12-factor configuration. Everything comes from the environment so the
 * same image runs unchanged across local / staging / production and across pods.
 */

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be an integer, got "${raw}"`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export interface AppConfig {
  env: string;
  port: number;
  host: string;
  logLevel: string;
  databaseUrl: string;
  db: {
    poolMax: number;
    idleTimeoutMs: number;
    connectionTimeoutMs: number;
  };
  defaultLang: string;
  shutdownTimeoutMs: number;

  /** Token that guards the /internal/* routes. Empty => those routes are disabled. */
  internalToken: string;

  /** Google Gemini settings for the nightly content generator. */
  gemini: {
    apiKey: string;
    model: string;
    apiBase: string;
    timeoutMs: number;
  };

  /** Nightly content-generation behaviour. */
  content: {
    /** Run an in-process nightly scheduler inside the web pods (multi-pod safe via an advisory lock). */
    schedulerEnabled: boolean;
    /** Hour (0-23, Asia/Kolkata) at which the nightly job runs. */
    runHourIST: number;
    /**
     * How many days ahead to generate. 0 (default) = the 01:00 IST run generates
     * content for that same calendar day, which goes LIVE at the 6 AM IST cutover.
     */
    generateForOffsetDays: number;
    /** Languages to generate each night. */
    langs: string[];
  };
}

export const config: AppConfig = {
  env: process.env.NODE_ENV ?? 'development',
  // Default 3000 to line up with the Lokal Devtron deployment chart (ContainerPort/liveness/readiness use 3000).
  port: int('PORT', 3000),
  host: process.env.HOST ?? '0.0.0.0',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  databaseUrl: process.env.DATABASE_URL ?? '',
  db: {
    poolMax: int('DB_POOL_MAX', 10),
    idleTimeoutMs: int('DB_IDLE_TIMEOUT_MS', 30_000),
    connectionTimeoutMs: int('DB_CONN_TIMEOUT_MS', 5_000),
  },
  defaultLang: process.env.DEFAULT_LANG ?? 'en',
  shutdownTimeoutMs: int('SHUTDOWN_TIMEOUT_MS', 10_000),

  internalToken: process.env.INTERNAL_TOKEN ?? '',

  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
    apiBase: process.env.GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com/v1beta',
    timeoutMs: int('GEMINI_TIMEOUT_MS', 60_000),
  },

  content: {
    // ON by default: with a GEMINI_API_KEY present, every night refreshes all 12 rashis
    // automatically (multi-pod safe). Set CONTENT_SCHEDULER_ENABLED=false to opt out
    // (e.g. when using the separate k8s CronJob instead).
    schedulerEnabled: bool('CONTENT_SCHEDULER_ENABLED', true),
    runHourIST: int('CONTENT_RUN_HOUR_IST', 1), // 01:00 IST by default
    generateForOffsetDays: int('CONTENT_GENERATE_OFFSET_DAYS', 0), // 01:00 run -> live at the 6 AM cutover
    langs: list('CONTENT_LANGS', ['en']),
  },
};

/** Fail fast at boot (web server) if a required setting is missing. */
export function assertRuntimeConfig(cfg: AppConfig = config): void {
  if (!cfg.databaseUrl) {
    throw new Error('DATABASE_URL is required (any Postgres-compliant connection string).');
  }
}

/** Fail fast for the content generator (job / scheduler / internal route) if Gemini is not configured. */
export function assertGeminiConfig(cfg: AppConfig = config): void {
  if (!cfg.gemini.apiKey) {
    throw new Error('GEMINI_API_KEY is required to generate daily content.');
  }
}

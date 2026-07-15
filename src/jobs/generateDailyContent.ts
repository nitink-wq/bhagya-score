/**
 * One-shot content generation job.
 *
 * Run it three ways — all share the same code path:
 *   • Kubernetes CronJob  (recommended in prod): `node dist/jobs/generateDailyContent.js`
 *   • Locally / manually:  `npm run generate`
 *   • Ad-hoc for a date:   `GENERATE_DATE=2026-07-20 GENERATE_LANGS=en,hi npm run generate`
 *
 * Exits 0 only if every requested (date, lang) either succeeded or was skipped
 * because another worker already did it; exits 1 if any generation actually failed,
 * so a CronJob/Devtron pipeline surfaces the failure.
 */
import { assertGeminiConfig, assertRuntimeConfig, config } from '../config';
import { Database } from '../db/client';
import { DailyContentRepository } from '../db/repositories/dailyContentRepo';
import { GenerationRunsRepository } from '../db/repositories/generationRunsRepo';
import { generateAndStore, targetDateIST, type GenerateDeps } from '../services/contentGenerator';

const log = {
  info: (o: unknown, m?: string) => console.log(JSON.stringify({ level: 'info', msg: m, ...(o as object) })),
  error: (o: unknown, m?: string) => console.error(JSON.stringify({ level: 'error', msg: m, ...(o as object) })),
};

async function main(): Promise<void> {
  assertRuntimeConfig();
  assertGeminiConfig();

  const langs = (process.env.GENERATE_LANGS?.split(',').map((s) => s.trim()).filter(Boolean)) ?? config.content.langs;
  const date = process.env.GENERATE_DATE?.trim() || targetDateIST(config.content.generateForOffsetDays);

  const db = new Database(config);
  const deps: GenerateDeps = {
    config,
    db,
    daily: new DailyContentRepository(db),
    runs: new GenerationRunsRepository(db),
    log,
  };

  let failures = 0;
  try {
    for (const lang of langs) {
      try {
        const r = await generateAndStore(deps, date, lang);
        log.info({ date, lang, status: r.status }, 'generation result');
      } catch (err) {
        failures += 1;
        log.error({ date, lang, err: err instanceof Error ? err.message : String(err) }, 'generation error');
      }
    }
  } finally {
    await db.close();
  }

  if (failures > 0) {
    log.error({ failures }, 'content generation completed with failures');
    process.exit(1);
  }
  log.info({ date, langs }, 'content generation completed');
  process.exit(0);
}

main().catch((err) => {
  console.error('fatal: content generation job crashed', err);
  process.exit(1);
});

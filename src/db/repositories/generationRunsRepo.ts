import type { Database } from '../client';

export type GenerationStatus = 'success' | 'failed' | 'skipped_locked';

export interface GenerationRun {
  targetDate: string;
  lang: string;
  model: string | null;
  status: GenerationStatus;
  error: string | null;
}

/**
 * Audit trail for the nightly content generator. One row per attempt so you can
 * answer "did last night's Gemini job actually run, and did it succeed?" from SQL
 * or a dashboard without digging through pod logs.
 */
export class GenerationRunsRepository {
  constructor(private readonly db: Database) {}

  async record(run: GenerationRun): Promise<void> {
    await this.db.query(
      `INSERT INTO content_generation_runs (target_date, lang, model, status, error)
       VALUES ($1, $2, $3, $4, $5)`,
      [run.targetDate, run.lang, run.model, run.status, run.error],
    );
  }
}

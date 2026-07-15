import type { Database } from '../client';

/** The `payload` jsonb column — the locked Bhagya Score content schema. */
export type DailyPayload = Record<string, unknown> & { rashis?: unknown[] };

/**
 * Reads from `daily_content (date, lang, payload jsonb)`.
 * Pure data access — no business rules live here.
 */
export class DailyContentRepository {
  constructor(private readonly db: Database) {}

  async getByDate(date: string, lang: string): Promise<DailyPayload | null> {
    const res = await this.db.query<{ payload: DailyPayload }>(
      'SELECT payload FROM daily_content WHERE date = $1 AND lang = $2 LIMIT 1',
      [date, lang],
    );
    return res.rows[0]?.payload ?? null;
  }

  async getMostRecentOnOrBefore(date: string, lang: string): Promise<DailyPayload | null> {
    const res = await this.db.query<{ payload: DailyPayload }>(
      'SELECT payload FROM daily_content WHERE lang = $1 AND date <= $2 ORDER BY date DESC LIMIT 1',
      [lang, date],
    );
    return res.rows[0]?.payload ?? null;
  }

  /**
   * Insert-or-replace the content for a (date, lang). Used by the nightly generator.
   * Idempotent: re-running the generator for the same day just refreshes the row.
   */
  async upsert(date: string, lang: string, payload: DailyPayload): Promise<void> {
    await this.db.query(
      `INSERT INTO daily_content (date, lang, payload)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (date, lang)
       DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
      [date, lang, JSON.stringify(payload)],
    );
  }
}

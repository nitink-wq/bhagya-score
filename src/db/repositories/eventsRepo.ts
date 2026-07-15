import type { Database } from '../client';

export interface AnalyticsEvent {
  event: string;
  userId?: string | null;
  rashi?: string | null;
  lang?: string | null;
  props?: Record<string, unknown>;
}

/** Insert-only writer for the `events` analytics table. */
export class EventsRepository {
  constructor(private readonly db: Database) {}

  async insert(e: AnalyticsEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO events (event, user_id, rashi, lang, props)
       VALUES ($1, $2, $3, $4, $5)`,
      [e.event, e.userId ?? null, e.rashi ?? null, e.lang ?? null, JSON.stringify(e.props ?? {})],
    );
  }
}

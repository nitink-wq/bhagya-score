import type { DailyContentRepository, DailyPayload } from '../db/repositories/dailyContentRepo';

/** Today's date (YYYY-MM-DD) in Asia/Kolkata, regardless of the pod's timezone. */
export function istToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class BhagyaService {
  constructor(private readonly daily: DailyContentRepository) {}

  /**
   * Resolve the content to serve:
   *   1. exact row for the requested (or IST-today) date,
   *   2. else the most recent row on-or-before that date (never show a stale-future one),
   *   3. else null — the caller returns 404 and the webview uses its embedded fallback.
   */
  async getDailyContent(lang: string, date?: string): Promise<DailyPayload | null> {
    const target = date && ISO_DATE.test(date) ? date : istToday();
    const exact = await this.daily.getByDate(target, lang);
    if (exact) return exact;
    return this.daily.getMostRecentOnOrBefore(target, lang);
  }
}

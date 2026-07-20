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

/** The content day flips at 6:00 AM IST, not midnight. */
export const CUTOVER_HOUR_IST = 6;

/**
 * The date whose content should be LIVE right now: before 6 AM IST users still
 * see the previous day. (Implemented by shifting "now" back 6 hours.)
 */
export function contentDateIST(now: Date = new Date()): string {
  return istToday(new Date(now.getTime() - CUTOVER_HOUR_IST * 60 * 60 * 1000));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class BhagyaService {
  constructor(private readonly daily: DailyContentRepository) {}

  /**
   * Resolve the content to serve:
   *   1. exact row for the requested date (default: the 6 AM IST cutover date),
   *   2. else the most recent row on-or-before that date (never show a stale-future one),
   *   3. else null — the caller returns 404 and the webview uses its embedded fallback.
   */
  async getDailyContent(lang: string, date?: string): Promise<DailyPayload | null> {
    const target = date && ISO_DATE.test(date) ? date : contentDateIST();
    const exact = await this.daily.getByDate(target, lang);
    if (exact) return exact;
    return this.daily.getMostRecentOnOrBefore(target, lang);
  }
}

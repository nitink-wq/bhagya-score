/**
 * Optional in-process nightly scheduler.
 *
 * The simplest way to run the Gemini job without any extra Kubernetes/Devtron
 * object: enable this inside the web pods (CONTENT_SCHEDULER_ENABLED=true). Every
 * pod ticks at the configured IST hour, but the advisory lock in generateAndStore
 * guarantees only ONE pod actually calls Gemini and writes — the rest record
 * `skipped_locked` and move on.
 *
 * For a cleaner separation in production you can instead disable this and run
 * k8s/cronjob.yaml (a separate CronJob using the same image). Either path calls
 * the exact same generateAndStore().
 */
import { targetDateIST, generateAndStore, type GenerateDeps } from './services/contentGenerator';

function istParts(now: Date): { h: number; m: number; s: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => Number.parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  return { h: get('hour'), m: get('minute'), s: get('second') };
}

/** Milliseconds from `now` until the next occurrence of runHourIST:00:00 in Asia/Kolkata. */
export function msUntilNextRun(runHourIST: number, now: Date = new Date()): number {
  const { h, m, s } = istParts(now);
  const secondsNow = h * 3600 + m * 60 + s;
  let delaySec = runHourIST * 3600 - secondsNow;
  if (delaySec <= 0) delaySec += 24 * 3600;
  return delaySec * 1000;
}

export interface Scheduler {
  stop: () => void;
}

export function startScheduler(deps: GenerateDeps): Scheduler {
  const { config: cfg, log } = deps;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const runOnce = async (): Promise<void> => {
    const date = targetDateIST(cfg.content.generateForOffsetDays);
    for (const lang of cfg.content.langs) {
      try {
        await generateAndStore(deps, date, lang);
      } catch (err) {
        // generateAndStore already recorded the failure; keep the scheduler alive.
        log?.error({ date, lang, err: err instanceof Error ? err.message : String(err) }, 'scheduled generation failed');
      }
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    const delay = msUntilNextRun(cfg.content.runHourIST);
    log?.info({ delayMs: delay, runHourIST: cfg.content.runHourIST }, 'nightly content scheduler armed');
    timer = setTimeout(() => {
      void runOnce().finally(schedule); // reschedule for the next night regardless of outcome
    }, delay);
    timer.unref?.(); // never keep the process alive just for the scheduler
  };

  schedule();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

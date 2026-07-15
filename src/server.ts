import { buildApp } from './app';
import { assertRuntimeConfig, config } from './config';
import { Database } from './db/client';
import { startScheduler, type Scheduler } from './scheduler';

async function main(): Promise<void> {
  assertRuntimeConfig();

  const db = new Database(config);
  const app = buildApp(db);

  // Optional in-process nightly content generator (multi-pod safe via advisory lock).
  let scheduler: Scheduler | undefined;
  if (config.content.schedulerEnabled) {
    if (!config.gemini.apiKey) {
      app.log.warn('CONTENT_SCHEDULER_ENABLED is set but GEMINI_API_KEY is missing — scheduler not started');
    } else {
      scheduler = startScheduler(app.contentDeps);
    }
  }

  // Graceful shutdown: on a rolling deploy K8s sends SIGTERM, waits
  // terminationGracePeriodSeconds, then SIGKILL. Stop accepting new connections,
  // let in-flight requests finish, then drain the DB pool.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      app.log.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, config.shutdownTimeoutMs);
    timer.unref();
    try {
      scheduler?.stop();
      await app.close();
      await db.close();
      clearTimeout(timer);
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal: failed to start server', err);
  process.exit(1);
});

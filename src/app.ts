import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config';
import { Database } from './db/client';
import { DailyContentRepository } from './db/repositories/dailyContentRepo';
import { GenerationRunsRepository } from './db/repositories/generationRunsRepo';
import { BhagyaService } from './services/bhagyaService';
import type { GenerateDeps } from './services/contentGenerator';
import apiRoutes from './routes/api';
import healthRoutes from './routes/health';
import internalRoutes from './routes/internal';

// Make our singletons available on the Fastify instance (typed).
declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    bhagya: BhagyaService;
    /** Everything the content generator needs; reused by the internal route + scheduler. */
    contentDeps: GenerateDeps;
  }
}

/**
 * Build the app from an already-constructed Database so tests can inject their own.
 * The app is fully stateless — any pod can serve any request.
 */
export function buildApp(db: Database): FastifyInstance {
  const app = Fastify({
    trustProxy: true,
    logger: {
      level: config.logLevel,
      ...(config.env !== 'production'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
        : {}),
    },
  });

  const daily = new DailyContentRepository(db);
  app.decorate('db', db);
  app.decorate('bhagya', new BhagyaService(daily));
  app.decorate('contentDeps', {
    config,
    db,
    daily,
    runs: new GenerationRunsRepository(db),
    log: app.log,
  } satisfies GenerateDeps);

  app.register(healthRoutes);
  app.register(apiRoutes);
  app.register(internalRoutes);

  // Serve the webview (index.html) as a static asset on the same origin.
  app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
    index: ['index.html'],
    maxAge: '1h',
  });


  return app;
}

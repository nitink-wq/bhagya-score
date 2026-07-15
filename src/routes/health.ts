import type { FastifyInstance } from 'fastify';

/**
 * Kubernetes probes:
 *  - /healthz (liveness): process is up. Never touches the DB, so a DB blip
 *    doesn't get the pod killed.
 *  - /readyz (readiness): pod can serve traffic — verified with a DB round-trip.
 *    On failure it returns 503 and K8s pulls the pod out of the Service.
 */
export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_req, reply) => {
    try {
      await app.db.healthcheck();
      return { status: 'ready' };
    } catch (err) {
      app.log.warn({ err }, 'readiness check failed');
      return reply.code(503).send({ status: 'not_ready' });
    }
  });
}

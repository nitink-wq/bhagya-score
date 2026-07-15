import type { FastifyInstance } from 'fastify';
import { assertGeminiConfig, config } from '../config';
import { generateAndStore, targetDateIST } from '../services/contentGenerator';

interface GenerateBody {
  lang?: string;
  date?: string;
}

/**
 * Internal, token-guarded operations. Enabled only when INTERNAL_TOKEN is set.
 * Use it to trigger a generation on demand (testing / backfill / an external cron):
 *
 *   curl -X POST https://<host>/internal/generate-content \
 *        -H "x-internal-token: $INTERNAL_TOKEN" \
 *        -H "content-type: application/json" \
 *        -d '{"lang":"en","date":"2026-07-16"}'
 */
export default async function internalRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: GenerateBody }>(
    '/internal/generate-content',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            lang: { type: 'string', minLength: 2, maxLength: 8 },
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
        },
      },
    },
    async (req, reply) => {
      // Feature is off unless a token is configured; wrong/missing token looks like 404.
      const token = req.headers['x-internal-token'];
      if (!config.internalToken || token !== config.internalToken) {
        return reply.code(404).send({ error: 'not_found' });
      }

      try {
        assertGeminiConfig();
      } catch {
        return reply.code(503).send({ error: 'gemini_not_configured' });
      }

      const lang = req.body.lang ?? config.defaultLang;
      const date = req.body.date ?? targetDateIST(config.content.generateForOffsetDays);

      try {
        const result = await generateAndStore(app.contentDeps, date, lang);
        return reply.code(200).send(result);
      } catch (err) {
        return reply.code(502).send({
          error: 'generation_failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}

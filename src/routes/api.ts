import type { FastifyInstance } from 'fastify';
import { config } from '../config';

interface DailyQuery {
  lang?: string;
  date?: string;
}

/** Public API consumed by the Bhagya Score webview (same origin). */
export default async function apiRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/daily-content?lang=en&date=YYYY-MM-DD
  app.get<{ Querystring: DailyQuery }>(
    '/api/daily-content',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            lang: { type: 'string', minLength: 2, maxLength: 8 },
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
        },
      },
    },
    async (req, reply) => {
      const lang = req.query.lang ?? config.defaultLang;
      const payload = await app.bhagya.getDailyContent(lang, req.query.date);
      if (!payload) {
        return reply.code(404).send({ error: 'no_content' });
      }
      // Safe to cache briefly at the edge/CDN; content is per-day.
      reply.header('Cache-Control', 'public, max-age=300');
      return payload;
    },
  );

  // NOTE: analytics (POST /api/events) intentionally removed for now.
  // The `events` table + EventsRepository remain in the repo, dormant, for easy re-enable.
}

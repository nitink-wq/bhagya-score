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

  // POST /api/events — fire-and-forget analytics from the webview.
  // Always answers 204 fast; an analytics failure must never affect the page.
  app.post<{ Body: EventBody }>(
    '/api/events',
    {
      schema: {
        body: {
          type: 'object',
          required: ['event'],
          properties: {
            event: { type: 'string', minLength: 1, maxLength: 64 },
            user_id: { type: ['string', 'null'], maxLength: 64 },
            rashi: { type: ['string', 'null'], maxLength: 16 },
            lang: { type: ['string', 'null'], maxLength: 8 },
            ts: { type: ['string', 'null'], maxLength: 40 },
            props: { type: 'object' },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        await app.events.insert({
          event: req.body.event,
          userId: req.body.user_id ?? null,
          rashi: req.body.rashi ?? null,
          lang: req.body.lang ?? null,
          // client_ts = the device's clock; the events.ts column records server time.
          props: { ...(req.body.props ?? {}), client_ts: req.body.ts ?? null },
        });
      } catch (err) {
        req.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'event insert failed');
      }
      return reply.code(204).send();
    },
  );
}

interface EventBody {
  event: string;
  user_id?: string | null;
  rashi?: string | null;
  lang?: string | null;
  ts?: string | null;
  props?: Record<string, unknown>;
}

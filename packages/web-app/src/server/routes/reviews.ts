import { Hono } from 'hono';
import { SupersessionResolutionSchema } from '@cpm/shared';
import type { DB } from '../db/init.js';
import { resolveSupersession } from '../projects/repo.js';
import { requestImmediateFlush } from '../sync/engine.js';

export function reviewsRoutes(db: DB): Hono {
  const app = new Hono();

  app.post('/reviews/:reviewId/resolve', async (c) => {
    const reviewId = c.req.param('reviewId');
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be JSON.' }, 400);
    }
    const parsed = SupersessionResolutionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, 400);
    }
    const ok = resolveSupersession(db, reviewId, parsed.data.resolution);
    if (!ok) return c.json({ error: 'not found or already resolved' }, 404);
    requestImmediateFlush();
    return c.json({ ok: true });
  });

  return app;
}

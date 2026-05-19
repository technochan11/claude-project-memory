import { Hono } from 'hono';
import { forceFlush, getStatus } from '../sync/engine.js';

export function syncRoutes(): Hono {
  const app = new Hono();

  app.get('/sync/status', (c) => c.json(getStatus()));

  app.post('/sync/force', async (c) => {
    const result = await forceFlush();
    if (!result.ok) return c.json({ error: result.error }, 500);
    return c.json({ ok: true, status: getStatus() });
  });

  return app;
}

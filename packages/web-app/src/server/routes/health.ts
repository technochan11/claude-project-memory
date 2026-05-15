import { Hono } from 'hono';
import type { DB } from '../db/init.js';
import { isConfigured } from '../db/init.js';
import { isReady } from '../embeddings/index.js';

export function healthRoutes(db: DB): Hono {
  const app = new Hono();
  app.get('/health', (c) => {
    return c.json({
      status: isConfigured(db) ? 'ok' : 'needs_configuration',
      embeddings_ready: isReady(),
    });
  });
  return app;
}

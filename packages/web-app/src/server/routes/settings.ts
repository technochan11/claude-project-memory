import { Hono } from 'hono';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { DB } from '../db/init.js';
import { getConfig, setConfig } from '../db/init.js';
import { getModelStatus, startDownload, unload } from '../llm/local.js';

const EnabledSchema = z.object({ enabled: z.boolean() });

export function settingsRoutes(db: DB, logger: Logger): Hono {
  const app = new Hono();

  app.get('/settings/ai/status', (c) => {
    const status = getModelStatus();
    const enabled = getConfig(db, 'ai_enabled') === 'true';
    return c.json({ ...status, enabled });
  });

  app.post('/settings/ai/download', (c) => {
    // Fire-and-forget; errors are logged inside startDownload().
    void startDownload(logger).catch((err) => {
      logger.error({ err: String(err?.message ?? err) }, 'settings: ai download failed');
    });
    return c.json(getModelStatus());
  });

  app.post('/settings/ai/unload', (c) => {
    unload();
    return c.json(getModelStatus());
  });

  app.post('/settings/ai/enabled', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be JSON.' }, 400);
    }
    const parsed = EnabledSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, 400);
    }
    setConfig(db, 'ai_enabled', parsed.data.enabled ? 'true' : 'false');
    return c.json({ enabled: parsed.data.enabled });
  });

  return app;
}

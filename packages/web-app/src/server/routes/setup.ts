import { Hono } from 'hono';
import { SetupCompleteRequestSchema } from '@cpm/shared';
import type { DB } from '../db/init.js';
import { setConfig, isConfigured } from '../db/init.js';
import { storeGithubToken } from '../db/crypto.js';
import { ensureRepo, validateToken } from '../sync/github.js';
import type { Logger } from 'pino';

export function setupRoutes(db: DB, logger: Logger): Hono {
  const app = new Hono();

  app.get('/setup/status', (c) => {
    return c.json({ configured: isConfigured(db) });
  });

  app.post('/setup/complete', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be JSON.' }, 400);
    }

    const parsed = SetupCompleteRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        400,
      );
    }
    const { github_token, github_repo } = parsed.data;

    const validation = await validateToken(github_token);
    if (!validation.ok) {
      logger.warn({ error: validation.error }, 'setup: token validation failed');
      return c.json({ error: validation.error ?? 'Token validation failed.' }, 400);
    }

    try {
      const result = await ensureRepo(github_token, github_repo);
      storeGithubToken(db, github_token);
      setConfig(db, 'github_repo', result.full_name);
      logger.info({ repo: result.full_name, created: result.created }, 'setup: complete');
      return c.json({ ok: true, repo: result.full_name, created: result.created });
    } catch (err: any) {
      logger.error({ err: String(err?.message ?? err) }, 'setup: ensureRepo failed');
      return c.json(
        { error: `Failed to ensure repo: ${err?.message ?? String(err)}` },
        500,
      );
    }
  });

  return app;
}

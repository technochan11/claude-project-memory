import { Hono } from 'hono';
import type { DB } from '../db/init.js';
import { keywordSearch, parseProjectPrefix, semanticSearch } from '../search/index.js';
import { isReady as embeddingsReady } from '../embeddings/index.js';

export function searchRoutes(db: DB): Hono {
  const app = new Hono();

  app.get('/search', async (c) => {
    const qRaw = c.req.query('q') ?? '';
    const mode = (c.req.query('mode') ?? 'keyword') as 'keyword' | 'semantic';
    const projectParam = c.req.query('project');
    if (!qRaw.trim()) return c.json({ results: [] });

    const parsed = parseProjectPrefix(qRaw);
    const project = projectParam ?? parsed.project;
    const q = parsed.rest;
    if (!q) return c.json({ results: [] });

    if (mode === 'semantic') {
      if (!embeddingsReady()) return c.json({ error: 'embeddings not ready' }, 503);
      const results = await semanticSearch(db, q, project);
      return c.json({ results });
    }
    const results = keywordSearch(db, q, project);
    return c.json({ results });
  });

  return app;
}

import { Hono } from 'hono';
import type { Logger } from 'pino';
import type { DB } from '../db/init.js';
import {
  EntryCreateRequestSchema,
  EntryUpdateRequestSchema,
  ProjectCreateRequestSchema,
  ProjectUpdateRequestSchema,
} from '@cpm/shared';
import {
  addEntry,
  buildReferenceMarkdownFor,
  createProject,
  deleteEntry,
  deleteProject,
  getEntry,
  getProject,
  listEntries,
  listProjects,
  updateEntry,
  updateProject,
} from '../projects/repo.js';
import { isReady as embeddingsReady } from '../embeddings/index.js';
import { listPendingForProject } from '../projects/supersession.js';
import { listPruned, restoreEntry } from '../projects/pruning.js';
import { requestImmediateFlush } from '../sync/engine.js';

function ensureEmbeddingsReady(c: any): Response | null {
  if (!embeddingsReady()) {
    return c.json(
      { error: 'Embeddings model is still loading. Wait a few seconds and retry.' },
      503,
    );
  }
  return null;
}

export function projectsRoutes(db: DB, _logger: Logger): Hono {
  const app = new Hono();

  app.get('/projects', (c) => c.json({ projects: listProjects(db) }));

  app.post('/projects', async (c) => {
    const block = ensureEmbeddingsReady(c);
    if (block) return block;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be JSON.' }, 400);
    }
    const parsed = ProjectCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, 400);
    }
    try {
      const project = await createProject(db, parsed.data);
      requestImmediateFlush();
      return c.json({ project }, 201);
    } catch (err: any) {
      return c.json({ error: String(err?.message ?? err) }, 400);
    }
  });

  app.get('/projects/:id', (c) => {
    const id = c.req.param('id');
    const project = getProject(db, id);
    if (!project) return c.json({ error: 'not found' }, 404);
    const entries = listEntries(db, id);
    return c.json({ project, entries });
  });

  app.put('/projects/:id', async (c) => {
    const id = c.req.param('id');
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be JSON.' }, 400);
    }
    const parsed = ProjectUpdateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, 400);
    }
    const project = updateProject(db, id, parsed.data);
    if (!project) return c.json({ error: 'not found' }, 404);
    requestImmediateFlush();
    return c.json({ project });
  });

  app.delete('/projects/:id', (c) => {
    const id = c.req.param('id');
    const ok = deleteProject(db, id);
    if (!ok) return c.json({ error: 'not found' }, 404);
    requestImmediateFlush();
    return c.json({ ok: true });
  });

  app.get('/projects/:id/reference', (c) => {
    const id = c.req.param('id');
    const project = getProject(db, id);
    if (!project) return c.json({ error: 'not found' }, 404);
    const md = buildReferenceMarkdownFor(db, id);
    return c.text(md, 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
  });

  app.get('/projects/:id/entries', (c) => {
    const id = c.req.param('id');
    return c.json({ entries: listEntries(db, id) });
  });

  app.post('/projects/:id/entries', async (c) => {
    const block = ensureEmbeddingsReady(c);
    if (block) return block;
    const id = c.req.param('id');
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be JSON.' }, 400);
    }
    const parsed = EntryCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, 400);
    }
    try {
      const entry = await addEntry(db, id, parsed.data, 'dashboard');
      requestImmediateFlush();
      return c.json({ entry }, 201);
    } catch (err: any) {
      return c.json({ error: String(err?.message ?? err) }, 400);
    }
  });

  app.put('/projects/:id/entries/:entryId', async (c) => {
    const block = ensureEmbeddingsReady(c);
    if (block) return block;
    const entryId = c.req.param('entryId');
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be JSON.' }, 400);
    }
    const parsed = EntryUpdateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, 400);
    }
    const existing = getEntry(db, entryId);
    if (!existing) return c.json({ error: 'not found' }, 404);
    const entry = await updateEntry(db, entryId, parsed.data);
    requestImmediateFlush();
    return c.json({ entry });
  });

  app.delete('/projects/:id/entries/:entryId', (c) => {
    const entryId = c.req.param('entryId');
    const ok = deleteEntry(db, entryId);
    if (!ok) return c.json({ error: 'not found' }, 404);
    requestImmediateFlush();
    return c.json({ ok: true });
  });

  app.get('/projects/:id/pruned', (c) => {
    const id = c.req.param('id');
    return c.json({ pruned: listPruned(db, id) });
  });

  app.post('/projects/:id/pruned/:entryId/restore', (c) => {
    const id = c.req.param('id');
    const entryId = c.req.param('entryId');
    const ok = restoreEntry(db, id, entryId);
    if (!ok) return c.json({ error: 'not restorable' }, 404);
    requestImmediateFlush();
    return c.json({ ok: true });
  });

  app.get('/projects/:id/pending-reviews', (c) => {
    const id = c.req.param('id');
    return c.json({ reviews: listPendingForProject(db, id) });
  });

  return app;
}

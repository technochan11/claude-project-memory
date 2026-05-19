import { Hono } from 'hono';
import { ACTIVITY_FEED_LIMIT } from '@cpm/shared';
import type { DB } from '../db/init.js';
import { listRecentEvents } from '../events.js';

export function activityRoutes(db: DB): Hono {
  const app = new Hono();
  app.get('/activity', (c) => {
    const project = c.req.query('project') || undefined;
    const events = listRecentEvents(db, ACTIVITY_FEED_LIMIT, project);
    return c.json({
      events: events.map((e) => ({
        id: e.id,
        type: e.event_type,
        project_id: e.project_id,
        project_display_name: e.project_display_name,
        payload: safeParse(e.payload_json),
        created_at: e.created_at,
      })),
    });
  });
  return app;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}

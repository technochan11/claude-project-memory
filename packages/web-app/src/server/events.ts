import { nanoid } from 'nanoid';
import type { EventType } from '@cpm/shared';
import type { DB } from './db/init.js';
import { getConfig } from './db/init.js';

export interface EventRow {
  id: string;
  event_type: EventType;
  project_id: string | null;
  payload_json: string;
  installation_id: string;
  created_at: number;
  synced_at: number | null;
}

export function enqueueEvent(
  db: DB,
  type: EventType,
  payload: Record<string, unknown>,
  projectId: string | null,
): string {
  const id = `evt_${nanoid(16)}`;
  const installationId = getConfig(db, 'installation_id') ?? 'unknown';
  db.prepare(
    `INSERT INTO events (id, event_type, project_id, payload_json, installation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, type, projectId, JSON.stringify(payload), installationId, Date.now());
  return id;
}

export function listUnsyncedEvents(db: DB, limit = 500): EventRow[] {
  return db
    .prepare<unknown[], EventRow>(
      'SELECT id, event_type, project_id, payload_json, installation_id, created_at, synced_at FROM events WHERE synced_at IS NULL ORDER BY created_at ASC LIMIT ?',
    )
    .all(limit);
}

export function markEventsSynced(db: DB, ids: string[]): void {
  if (ids.length === 0) return;
  const stmt = db.prepare('UPDATE events SET synced_at = ? WHERE id = ?');
  const now = Date.now();
  db.transaction(() => {
    for (const id of ids) stmt.run(now, id);
  })();
}

export function countUnsyncedEvents(db: DB): number {
  const row = db
    .prepare<unknown[], { c: number }>('SELECT COUNT(*) AS c FROM events WHERE synced_at IS NULL')
    .get();
  return row?.c ?? 0;
}

export function listRecentEvents(
  db: DB,
  limit: number,
  projectId?: string | null,
): Array<EventRow & { project_display_name: string | null }> {
  if (projectId) {
    return db
      .prepare<unknown[], EventRow & { project_display_name: string | null }>(
        `SELECT e.id, e.event_type, e.project_id, e.payload_json, e.installation_id, e.created_at, e.synced_at, p.display_name AS project_display_name
         FROM events e LEFT JOIN projects p ON p.id = e.project_id
         WHERE e.project_id = ? ORDER BY e.created_at DESC LIMIT ?`,
      )
      .all(projectId, limit);
  }
  return db
    .prepare<unknown[], EventRow & { project_display_name: string | null }>(
      `SELECT e.id, e.event_type, e.project_id, e.payload_json, e.installation_id, e.created_at, e.synced_at, p.display_name AS project_display_name
       FROM events e LEFT JOIN projects p ON p.id = e.project_id
       ORDER BY e.created_at DESC LIMIT ?`,
    )
    .all(limit);
}

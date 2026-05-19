import { nanoid } from 'nanoid';
import type { DB } from '../db/init.js';
import { enqueueEvent } from '../events.js';
import { countTokens } from './reference.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_AGING_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

interface EntryForScoring {
  id: string;
  category: string;
  content: string;
  confidence: number | null;
  reference_count: number;
  created_at: number;
  last_referenced_at: number | null;
}

function score(entry: EntryForScoring, now: number): number {
  // Recency: 1.0 if referenced today, decays with age in days.
  const lastSeen = entry.last_referenced_at ?? entry.created_at;
  const ageDays = Math.max(0, (now - lastSeen) / (24 * 60 * 60 * 1000));
  const recency = 1 / (1 + ageDays / 14);

  // Reference count: log-scaled.
  const refScore = Math.log1p(entry.reference_count) / Math.log1p(20);

  // Confidence: as-is (default 0.5 if missing).
  const conf = entry.confidence ?? 0.5;

  // TODO aging: after 60d, decay by 0.5 every additional 30d.
  let agingFactor = 1.0;
  if (entry.category === 'todo') {
    const ageMs = now - entry.created_at;
    if (ageMs > SIXTY_DAYS_MS) {
      const periods = Math.floor((ageMs - SIXTY_DAYS_MS) / THIRTY_DAYS_AGING_INTERVAL_MS) + 1;
      agingFactor = Math.pow(0.5, periods);
    }
  }

  return (0.4 * recency + 0.3 * refScore + 0.3 * conf) * agingFactor;
}

export interface PruningResult {
  projectId: string;
  prunedIds: string[];
}

/**
 * If estimated tokens of active entries exceed the project's budget, soft-delete
 * the bottom-scoring entries until the estimate fits within budget.
 */
export function evaluatePruning(db: DB, projectId: string): PruningResult {
  const project = db
    .prepare<unknown[], { reference_token_budget: number }>(
      'SELECT reference_token_budget FROM projects WHERE id = ?',
    )
    .get(projectId);
  if (!project) return { projectId, prunedIds: [] };

  const entries = db
    .prepare<unknown[], EntryForScoring>(
      `SELECT id, category, content, confidence, reference_count, created_at, last_referenced_at
       FROM reference_entries
       WHERE project_id = ? AND pruned_at IS NULL AND superseded_by IS NULL`,
    )
    .all(projectId);
  if (entries.length === 0) return { projectId, prunedIds: [] };

  const now = Date.now();
  let totalTokens = entries.reduce((s, e) => s + countTokens(e.content), 0);
  if (totalTokens <= project.reference_token_budget) return { projectId, prunedIds: [] };

  const scored = entries
    .map((e) => ({ entry: e, score: score(e, now), tokens: countTokens(e.content) }))
    .sort((a, b) => a.score - b.score);

  const prunedIds: string[] = [];
  const tx = db.transaction(() => {
    for (const s of scored) {
      if (totalTokens <= project.reference_token_budget) break;
      softDelete(db, projectId, s.entry.id, 'capacity');
      prunedIds.push(s.entry.id);
      totalTokens -= s.tokens;
    }
  });
  tx();
  return { projectId, prunedIds };
}

export function softDelete(
  db: DB,
  projectId: string,
  entryId: string,
  reason: 'capacity' | 'user_deleted' | 'superseded',
): void {
  const entry = db
    .prepare<unknown[], { content: string; category: string }>(
      'SELECT content, category FROM reference_entries WHERE id = ?',
    )
    .get(entryId);
  if (!entry) return;
  const now = Date.now();
  db.prepare(
    `INSERT INTO pruned_entries (id, original_entry_id, project_id, content, category, pruned_at, pruning_reason, restorable_until)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `prn_${nanoid(12)}`,
    entryId,
    projectId,
    entry.content,
    entry.category,
    now,
    reason,
    now + THIRTY_DAYS_MS,
  );
  db.prepare('UPDATE reference_entries SET pruned_at = ? WHERE id = ?').run(now, entryId);
  enqueueEvent(
    db,
    reason === 'capacity' || reason === 'superseded' ? 'ENTRY_PRUNED' : 'ENTRY_DELETED',
    { entry_id: entryId, reason },
    projectId,
  );
}

export interface PrunedRow {
  id: string;
  original_entry_id: string;
  project_id: string;
  content: string;
  category: string;
  pruned_at: number;
  pruning_reason: string;
  restorable_until: number | null;
}

export function listPruned(db: DB, projectId: string): PrunedRow[] {
  const now = Date.now();
  return db
    .prepare<unknown[], PrunedRow>(
      `SELECT * FROM pruned_entries WHERE project_id = ? AND (restorable_until IS NULL OR restorable_until > ?) ORDER BY pruned_at DESC`,
    )
    .all(projectId, now);
}

export function restoreEntry(db: DB, projectId: string, entryId: string): boolean {
  const found = db
    .prepare<unknown[], { id: string }>(
      'SELECT id FROM pruned_entries WHERE original_entry_id = ? AND project_id = ?',
    )
    .get(entryId, projectId);
  if (!found) return false;
  db.transaction(() => {
    db.prepare('UPDATE reference_entries SET pruned_at = NULL WHERE id = ?').run(entryId);
    db.prepare('DELETE FROM pruned_entries WHERE original_entry_id = ?').run(entryId);
    enqueueEvent(db, 'ENTRY_RESTORED', { entry_id: entryId }, projectId);
  })();
  return true;
}

/** Hard-delete pruned_entries rows past their restorable_until window. */
export function dailySweep(db: DB): { hardDeleted: string[] } {
  const now = Date.now();
  const expired = db
    .prepare<unknown[], { original_entry_id: string }>(
      'SELECT original_entry_id FROM pruned_entries WHERE restorable_until IS NOT NULL AND restorable_until <= ?',
    )
    .all(now);
  if (expired.length === 0) return { hardDeleted: [] };
  const ids = expired.map((e) => e.original_entry_id);
  db.transaction(() => {
    for (const id of ids) {
      db.prepare('DELETE FROM reference_entries WHERE id = ? AND pruned_at IS NOT NULL').run(id);
      db.prepare('DELETE FROM pruned_entries WHERE original_entry_id = ?').run(id);
      db.prepare("DELETE FROM embeddings_index WHERE source_type = 'entry' AND source_id = ?").run(id);
    }
  })();
  return { hardDeleted: ids };
}

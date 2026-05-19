import { nanoid } from 'nanoid';
import { EMBEDDINGS_MODEL } from '@cpm/shared';
import type {
  EntryCreateRequest,
  EntryUpdateRequest,
  ProjectCreateRequest,
  ProjectUpdateRequest,
  ReferenceCategory,
} from '@cpm/shared';
import type { DB } from '../db/init.js';
import { bytesFromVec, embed, weightedCentroid } from '../embeddings/index.js';
import { enqueueEvent } from '../events.js';
import { detectSupersessions } from './supersession.js';
import { softDelete, evaluatePruning } from './pruning.js';
import { countTokens, renderReferenceMarkdown } from './reference.js';

export interface ProjectRow {
  id: string;
  display_name: string;
  description: string | null;
  github_path: string;
  created_at: number;
  last_synced_at: number | null;
  reference_token_budget: number;
  metadata_json: string | null;
}

export interface EntryRow {
  id: string;
  project_id: string;
  category: ReferenceCategory;
  content: string;
  source_prompt_id: string | null;
  confidence: number | null;
  reference_count: number;
  token_count: number | null;
  superseded_by: string | null;
  superseded_at: number | null;
  created_at: number;
  last_referenced_at: number | null;
  pruned_at: number | null;
}

export function listProjects(db: DB): Array<ProjectRow & { entry_count: number; last_activity_at: number }> {
  return db
    .prepare<unknown[], any>(
      `SELECT p.*,
              (SELECT COUNT(*) FROM reference_entries r WHERE r.project_id = p.id AND r.pruned_at IS NULL AND r.superseded_by IS NULL) AS entry_count,
              COALESCE(
                (SELECT MAX(created_at) FROM events e WHERE e.project_id = p.id),
                p.created_at
              ) AS last_activity_at
       FROM projects p ORDER BY last_activity_at DESC`,
    )
    .all();
}

export function getProject(db: DB, id: string): ProjectRow | undefined {
  return db.prepare<unknown[], ProjectRow>('SELECT * FROM projects WHERE id = ?').get(id);
}

export function listEntries(db: DB, projectId: string): EntryRow[] {
  return db
    .prepare<unknown[], EntryRow>(
      `SELECT * FROM reference_entries
       WHERE project_id = ? AND pruned_at IS NULL AND superseded_by IS NULL
       ORDER BY created_at ASC`,
    )
    .all(projectId);
}

export function getEntry(db: DB, entryId: string): EntryRow | undefined {
  return db.prepare<unknown[], EntryRow>('SELECT * FROM reference_entries WHERE id = ?').get(entryId);
}

/* ---------- embeddings_index helpers ---------- */

function upsertEmbedding(
  db: DB,
  sourceType: 'entry' | 'project_description',
  sourceId: string,
  projectId: string,
  vec: Float32Array,
): void {
  db.prepare(
    `INSERT INTO embeddings_index (id, source_type, source_id, project_id, embedding, model_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET embedding = excluded.embedding, model_version = excluded.model_version, created_at = excluded.created_at`,
  ).run(`emb_${sourceType}_${sourceId}`, sourceType, sourceId, projectId, bytesFromVec(vec), EMBEDDINGS_MODEL, Date.now());
}

async function recomputeCentroid(db: DB, projectId: string, description: string | null): Promise<void> {
  const items: { vec: Float32Array; weight: number }[] = [];
  if (description && description.trim().length > 0) {
    const v = await embed(description);
    items.push({ vec: v, weight: 1.0 });
    upsertEmbedding(db, 'project_description', projectId, projectId, v);
  }
  const entries = listEntries(db, projectId);
  for (const e of entries) {
    const row = db
      .prepare<unknown[], { embedding: Buffer }>(
        "SELECT embedding FROM embeddings_index WHERE source_type = 'entry' AND source_id = ?",
      )
      .get(e.id);
    if (row) {
      const buf = Buffer.from(row.embedding);
      items.push({ vec: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4), weight: 1.0 });
    }
  }
  if (items.length === 0) {
    db.prepare('DELETE FROM project_centroids WHERE project_id = ?').run(projectId);
    return;
  }
  const centroid = weightedCentroid(items);
  db.prepare(
    `INSERT INTO project_centroids (project_id, centroid, sample_count, last_updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET centroid = excluded.centroid, sample_count = excluded.sample_count, last_updated_at = excluded.last_updated_at`,
  ).run(projectId, bytesFromVec(centroid), items.length, Date.now());
}

/* ---------- mutations ---------- */

export async function createProject(db: DB, req: ProjectCreateRequest): Promise<ProjectRow> {
  const existing = getProject(db, req.id);
  if (existing) throw new Error(`Project '${req.id}' already exists`);

  const now = Date.now();
  const githubPath = `projects/${req.id}`;

  // Embed first (outside transaction — async work + cache hit).
  const descVec = await embed(req.description);
  const seedVecs = await Promise.all(req.seed_entries.map((e) => embed(e.content)));

  const insertedEntryIds: string[] = [];
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO projects (id, display_name, description, github_path, created_at, reference_token_budget)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(req.id, req.display_name, req.description, githubPath, now, 5000);
    upsertEmbedding(db, 'project_description', req.id, req.id, descVec);

    enqueueEvent(db, 'PROJECT_CREATED', { project_id: req.id, display_name: req.display_name }, req.id);

    req.seed_entries.forEach((e, idx) => {
      const entryId = `ent_${nanoid(16)}`;
      db.prepare(
        `INSERT INTO reference_entries (id, project_id, category, content, confidence, reference_count, token_count, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      ).run(entryId, req.id, e.category, e.content, e.confidence, countTokens(e.content), now);
      upsertEmbedding(db, 'entry', entryId, req.id, seedVecs[idx]!);
      enqueueEvent(
        db,
        'ENTRY_ADDED',
        { entry_id: entryId, category: e.category, content: e.content, source: 'wizard' },
        req.id,
      );
      insertedEntryIds.push(entryId);
    });

    // Compute centroid synchronously inside transaction using the vectors we already have.
    const items: { vec: Float32Array; weight: number }[] = [
      { vec: descVec, weight: 1.0 },
      ...seedVecs.map((v) => ({ vec: v, weight: 1.0 })),
    ];
    const centroid = weightedCentroid(items);
    db.prepare(
      `INSERT INTO project_centroids (project_id, centroid, sample_count, last_updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run(req.id, bytesFromVec(centroid), items.length, now);
  });
  tx();

  return getProject(db, req.id)!;
}

export function updateProject(db: DB, id: string, patch: ProjectUpdateRequest): ProjectRow | undefined {
  const existing = getProject(db, id);
  if (!existing) return undefined;
  const next = {
    display_name: patch.display_name ?? existing.display_name,
    description: patch.description ?? existing.description,
    reference_token_budget: patch.reference_token_budget ?? existing.reference_token_budget,
  };
  db.prepare(
    'UPDATE projects SET display_name = ?, description = ?, reference_token_budget = ? WHERE id = ?',
  ).run(next.display_name, next.description, next.reference_token_budget, id);
  enqueueEvent(db, 'PROJECT_UPDATED', { project_id: id, ...patch }, id);
  return getProject(db, id);
}

export function deleteProject(db: DB, id: string): boolean {
  const existing = getProject(db, id);
  if (!existing) return false;
  db.transaction(() => {
    db.prepare('DELETE FROM embeddings_index WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM project_centroids WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM pending_supersessions WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM pruned_entries WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id); // entries cascade
    enqueueEvent(db, 'PROJECT_DELETED', { project_id: id }, id);
  })();
  return true;
}

export async function addEntry(
  db: DB,
  projectId: string,
  req: EntryCreateRequest,
  source: 'dashboard' | 'wizard' | 'slash_command' | 'auto_prune' | 'sync_engine' = 'dashboard',
): Promise<EntryRow> {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`Project '${projectId}' not found`);
  const vec = await embed(req.content);

  const entryId = `ent_${nanoid(16)}`;
  const now = Date.now();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO reference_entries (id, project_id, category, content, confidence, reference_count, token_count, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(entryId, projectId, req.category, req.content, req.confidence, countTokens(req.content), now);
    upsertEmbedding(db, 'entry', entryId, projectId, vec);
    enqueueEvent(
      db,
      'ENTRY_ADDED',
      { entry_id: entryId, category: req.category, content: req.content, source },
      projectId,
    );
  })();

  detectSupersessions(db, projectId, entryId, vec, req.category);

  // Non-blocking pruning evaluation.
  setTimeout(() => {
    try {
      evaluatePruning(db, projectId);
    } catch {
      /* ignore */
    }
  }, 50);

  // Update centroid (async; don't block the response).
  setTimeout(() => {
    void recomputeCentroid(db, projectId, project.description).catch(() => undefined);
  }, 50);

  return getEntry(db, entryId)!;
}

export async function updateEntry(
  db: DB,
  entryId: string,
  patch: EntryUpdateRequest,
): Promise<EntryRow | undefined> {
  const existing = getEntry(db, entryId);
  if (!existing) return undefined;
  const next = {
    content: patch.content ?? existing.content,
    category: patch.category ?? existing.category,
    confidence: patch.confidence ?? existing.confidence,
  };
  const contentChanged = patch.content !== undefined && patch.content !== existing.content;
  let vec: Float32Array | null = null;
  if (contentChanged) vec = await embed(next.content);

  db.transaction(() => {
    db.prepare(
      'UPDATE reference_entries SET content = ?, category = ?, confidence = ?, token_count = ? WHERE id = ?',
    ).run(next.content, next.category, next.confidence, countTokens(next.content), entryId);
    if (vec) upsertEmbedding(db, 'entry', entryId, existing.project_id, vec);
    enqueueEvent(
      db,
      'ENTRY_EDITED',
      { entry_id: entryId, content: next.content, category: next.category, confidence: next.confidence },
      existing.project_id,
    );
  })();

  return getEntry(db, entryId);
}

export function deleteEntry(db: DB, entryId: string): boolean {
  const existing = getEntry(db, entryId);
  if (!existing || existing.pruned_at) return false;
  softDelete(db, existing.project_id, entryId, 'user_deleted');
  return true;
}

export { recomputeCentroid };

export function buildReferenceMarkdownFor(db: DB, projectId: string): string {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`Project '${projectId}' not found`);
  const entries = listEntries(db, projectId);
  return renderReferenceMarkdown(
    {
      display_name: project.display_name,
      description: project.description,
      reference_token_budget: project.reference_token_budget,
    },
    entries.map((e) => ({ category: e.category, content: e.content })),
  );
}

export function buildMetadataFor(db: DB, projectId: string): Record<string, unknown> {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`Project '${projectId}' not found`);
  const entries = listEntries(db, projectId);
  return {
    id: project.id,
    display_name: project.display_name,
    description: project.description,
    created_at: project.created_at,
    last_synced_at: Date.now(),
    reference_token_budget: project.reference_token_budget,
    entry_count: entries.length,
    schema_version: '1.0',
  };
}

export function resolveSupersession(
  db: DB,
  reviewId: string,
  resolution: 'supersedes' | 'both' | 'not_related',
): boolean {
  const row = db
    .prepare<unknown[], { new_entry_id: string; candidate_entry_id: string; project_id: string; resolved_at: number | null }>(
      'SELECT new_entry_id, candidate_entry_id, project_id, resolved_at FROM pending_supersessions WHERE id = ?',
    )
    .get(reviewId);
  if (!row || row.resolved_at) return false;

  const now = Date.now();
  db.transaction(() => {
    db.prepare('UPDATE pending_supersessions SET resolved_at = ?, resolution = ? WHERE id = ?').run(now, resolution, reviewId);
    if (resolution === 'supersedes') {
      db.prepare('UPDATE reference_entries SET superseded_by = ?, superseded_at = ? WHERE id = ?').run(
        row.new_entry_id,
        now,
        row.candidate_entry_id,
      );
    }
    enqueueEvent(
      db,
      'SUPERSESSION_RESOLVED',
      { review_id: reviewId, resolution, new_entry_id: row.new_entry_id, candidate_entry_id: row.candidate_entry_id },
      row.project_id,
    );
  })();
  return true;
}

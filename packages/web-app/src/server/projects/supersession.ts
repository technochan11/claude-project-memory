import { nanoid } from 'nanoid';
import { SUPERSESSION_SIMILARITY_THRESHOLD } from '@cpm/shared';
import type { DB } from '../db/init.js';
import { cosine, vecFromBytes } from '../embeddings/index.js';
import { enqueueEvent } from '../events.js';

interface PeerRow {
  id: string;
  embedding: Buffer;
}

export interface DetectedReview {
  id: string;
  new_entry_id: string;
  candidate_entry_id: string;
  similarity: number;
}

export function detectSupersessions(
  db: DB,
  projectId: string,
  newEntryId: string,
  newEmbedding: Float32Array,
  category: string,
): DetectedReview[] {
  const peers = db
    .prepare<unknown[], PeerRow>(
      `SELECT r.id, e.embedding FROM reference_entries r
       JOIN embeddings_index e ON e.source_type = 'entry' AND e.source_id = r.id
       WHERE r.project_id = ? AND r.id != ? AND r.category = ? AND r.pruned_at IS NULL AND r.superseded_by IS NULL`,
    )
    .all(projectId, newEntryId, category);

  const detected: DetectedReview[] = [];
  for (const peer of peers) {
    const peerVec = vecFromBytes(peer.embedding);
    const sim = cosine(newEmbedding, peerVec);
    if (sim < SUPERSESSION_SIMILARITY_THRESHOLD) continue;
    const id = `rev_${nanoid(12)}`;
    db.prepare(
      `INSERT INTO pending_supersessions (id, new_entry_id, candidate_entry_id, similarity, project_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, newEntryId, peer.id, sim, projectId, Date.now());
    enqueueEvent(
      db,
      'SUPERSESSION_DETECTED',
      { review_id: id, new_entry_id: newEntryId, candidate_entry_id: peer.id, similarity: sim },
      projectId,
    );
    detected.push({ id, new_entry_id: newEntryId, candidate_entry_id: peer.id, similarity: sim });
  }
  return detected;
}

export function countPendingReviews(db: DB): number {
  const row = db
    .prepare<unknown[], { c: number }>(
      'SELECT COUNT(*) AS c FROM pending_supersessions WHERE resolved_at IS NULL',
    )
    .get();
  return row?.c ?? 0;
}

export function listPendingForProject(db: DB, projectId: string): Array<{
  id: string;
  new_entry_id: string;
  candidate_entry_id: string;
  similarity: number;
  new_entry_content: string;
  new_entry_category: string;
  candidate_entry_content: string;
  candidate_entry_category: string;
}> {
  return db
    .prepare<unknown[], any>(
      `SELECT ps.id, ps.new_entry_id, ps.candidate_entry_id, ps.similarity,
              ne.content AS new_entry_content, ne.category AS new_entry_category,
              ce.content AS candidate_entry_content, ce.category AS candidate_entry_category
       FROM pending_supersessions ps
       JOIN reference_entries ne ON ne.id = ps.new_entry_id
       JOIN reference_entries ce ON ce.id = ps.candidate_entry_id
       WHERE ps.project_id = ? AND ps.resolved_at IS NULL
       ORDER BY ps.created_at DESC`,
    )
    .all(projectId);
}

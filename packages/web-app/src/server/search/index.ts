import { SEMANTIC_SEARCH_LIMIT, SEMANTIC_SEARCH_THRESHOLD } from '@cpm/shared';
import type { DB } from '../db/init.js';
import { cosine, embed, vecFromBytes } from '../embeddings/index.js';

export interface SearchResult {
  entry_id: string;
  project_id: string;
  project_display_name: string;
  category: string;
  content: string;
  score: number;
  snippet?: string;
}

/** FTS5 keyword search. `projectId` (optional) scopes to one project. */
export function keywordSearch(db: DB, query: string, projectId?: string): SearchResult[] {
  // FTS5 doesn't take user input directly — escape double quotes and wrap as a phrase
  // fallback to make special chars safe. For multi-token, split and use OR.
  const sanitized = query
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' OR ');
  if (!sanitized) return [];

  const params: unknown[] = [sanitized];
  let where = '';
  if (projectId) {
    where = 'AND r.project_id = ?';
    params.push(projectId);
  }
  params.push(SEMANTIC_SEARCH_LIMIT);

  const rows = db
    .prepare<unknown[], any>(
      `SELECT r.id AS entry_id, r.project_id, r.category, r.content,
              p.display_name AS project_display_name,
              snippet(reference_entries_fts, 0, '<mark>', '</mark>', '…', 16) AS snippet,
              bm25(reference_entries_fts) AS bm25
       FROM reference_entries_fts
       JOIN reference_entries r ON r.rowid = reference_entries_fts.rowid
       JOIN projects p ON p.id = r.project_id
       WHERE reference_entries_fts MATCH ? AND r.pruned_at IS NULL AND r.superseded_by IS NULL ${where}
       ORDER BY bm25 ASC LIMIT ?`,
    )
    .all(...params);

  return rows.map((r) => ({
    entry_id: r.entry_id,
    project_id: r.project_id,
    project_display_name: r.project_display_name,
    category: r.category,
    content: r.content,
    score: -r.bm25, // bm25 is lower=better; flip for "higher is better"
    snippet: r.snippet,
  }));
}

interface EmbeddingRow {
  source_id: string;
  project_id: string;
  embedding: Buffer;
  content: string;
  category: string;
  project_display_name: string;
}

export async function semanticSearch(
  db: DB,
  query: string,
  projectId?: string,
): Promise<SearchResult[]> {
  const queryVec = await embed(query);
  const params: unknown[] = [];
  let where = "ei.source_type = 'entry' AND r.pruned_at IS NULL AND r.superseded_by IS NULL";
  if (projectId) {
    where += ' AND r.project_id = ?';
    params.push(projectId);
  }

  const rows = db
    .prepare<unknown[], EmbeddingRow>(
      `SELECT ei.source_id, ei.project_id, ei.embedding,
              r.content, r.category, p.display_name AS project_display_name
       FROM embeddings_index ei
       JOIN reference_entries r ON r.id = ei.source_id
       JOIN projects p ON p.id = r.project_id
       WHERE ${where}`,
    )
    .all(...params);

  const scored: SearchResult[] = [];
  for (const row of rows) {
    const vec = vecFromBytes(row.embedding);
    const sim = cosine(queryVec, vec);
    if (sim < SEMANTIC_SEARCH_THRESHOLD) continue;
    scored.push({
      entry_id: row.source_id,
      project_id: row.project_id,
      project_display_name: row.project_display_name,
      category: row.category,
      content: row.content,
      score: sim,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, SEMANTIC_SEARCH_LIMIT);
}

/** Parse leading `project:<slug>` filter out of a query. */
export function parseProjectPrefix(q: string): { project?: string; rest: string } {
  const m = q.match(/^\s*project:([a-z0-9][a-z0-9-]*[a-z0-9])\s+(.*)$/);
  if (!m) return { rest: q };
  return { project: m[1], rest: m[2]!.trim() };
}

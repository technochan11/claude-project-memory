-- Schema version 1.0 — locked. Do not modify without bumping schema_meta.version.

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  github_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_synced_at INTEGER,
  reference_token_budget INTEGER DEFAULT 5000,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT,
  started_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  total_input_tokens INTEGER DEFAULT 0,
  context_injection_status TEXT DEFAULT 'none',
  context_injection_at INTEGER,
  matched_project_id TEXT,
  matched_project_confidence REAL,
  tab_temp_id TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_project ON conversations(project_id, last_active_at DESC);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER,
  topic_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_prompts_conv ON prompts(conversation_id, turn_index);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  label TEXT,
  first_prompt_index INTEGER NOT NULL,
  last_prompt_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS embeddings_index (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  project_id TEXT,
  embedding BLOB NOT NULL,
  model_version TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_embed_project ON embeddings_index(project_id, source_type);

CREATE TABLE IF NOT EXISTS project_centroids (
  project_id TEXT PRIMARY KEY,
  centroid BLOB NOT NULL,
  sample_count INTEGER NOT NULL,
  last_updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reference_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  source_prompt_id TEXT,
  confidence REAL,
  reference_count INTEGER DEFAULT 0,
  token_count INTEGER,
  superseded_by TEXT,
  superseded_at INTEGER,
  created_at INTEGER NOT NULL,
  last_referenced_at INTEGER,
  pruned_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ref_project ON reference_entries(project_id, last_referenced_at DESC);

CREATE TABLE IF NOT EXISTS pruned_entries (
  id TEXT PRIMARY KEY,
  original_entry_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  pruned_at INTEGER NOT NULL,
  pruning_reason TEXT NOT NULL,
  restorable_until INTEGER
);

CREATE TABLE IF NOT EXISTS pending_supersessions (
  id TEXT PRIMARY KEY,
  new_entry_id TEXT NOT NULL,
  candidate_entry_id TEXT NOT NULL,
  similarity REAL NOT NULL,
  project_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  project_id TEXT,
  payload_json TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  synced_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_unsynced ON events(synced_at, created_at);

CREATE TABLE IF NOT EXISTS command_history (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  command TEXT NOT NULL,
  raw_input TEXT NOT NULL,
  result TEXT NOT NULL,
  reversible BOOLEAN DEFAULT 0,
  executed_at INTEGER NOT NULL,
  reverted_at INTEGER
);

CREATE TABLE IF NOT EXISTS orphaned_conversations (
  temp_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  prompt_count INTEGER DEFAULT 0,
  project_id TEXT,
  reason TEXT,
  reviewed_at INTEGER
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Phase 2: FTS5 index over reference_entries.content for keyword search.
-- External-content table; FTS column names must match content table column names
-- (we use `content` and `project_id`, both present on reference_entries).
-- The entry id is reachable via rowid join.
CREATE VIRTUAL TABLE IF NOT EXISTS reference_entries_fts USING fts5(
  content,
  project_id UNINDEXED,
  content='reference_entries',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS reference_entries_ai AFTER INSERT ON reference_entries BEGIN
  INSERT INTO reference_entries_fts(rowid, content, project_id)
  VALUES (new.rowid, new.content, new.project_id);
END;

CREATE TRIGGER IF NOT EXISTS reference_entries_ad AFTER DELETE ON reference_entries BEGIN
  INSERT INTO reference_entries_fts(reference_entries_fts, rowid, content, project_id)
  VALUES('delete', old.rowid, old.content, old.project_id);
END;

CREATE TRIGGER IF NOT EXISTS reference_entries_au AFTER UPDATE ON reference_entries BEGIN
  INSERT INTO reference_entries_fts(reference_entries_fts, rowid, content, project_id)
  VALUES('delete', old.rowid, old.content, old.project_id);
  INSERT INTO reference_entries_fts(rowid, content, project_id)
  VALUES (new.rowid, new.content, new.project_id);
END;

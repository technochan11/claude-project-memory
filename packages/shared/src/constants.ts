export const DEFAULT_PORT = 47823;
export const SCHEMA_VERSION = '1.0';
export const EMBEDDINGS_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const APP_NAME = 'claude-project-memory';
export const LAUNCH_AGENT_LABEL = 'com.claude-project-memory';

export const EVENT_TYPES = [
  // Phase 1 originals (kept for compatibility).
  'EXTRACTION',
  'INJECTION',
  'LINK',
  'PRUNE',
  'RESTORE',
  'SUPERSEDE',
  // Phase 2 additions.
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_DELETED',
  'ENTRY_ADDED',
  'ENTRY_EDITED',
  'ENTRY_DELETED',
  'ENTRY_PRUNED',
  'ENTRY_RESTORED',
  'SUPERSESSION_DETECTED',
  'SUPERSESSION_RESOLVED',
  'PROJECT_LINKED',
  'SYNC_FLUSHED',
  'SYNC_FAILED',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const REFERENCE_CATEGORIES = [
  'decision',
  'specification',
  'constraint',
  'pattern',
  'todo',
] as const;
export type ReferenceCategory = (typeof REFERENCE_CATEGORIES)[number];

export const SUPERSESSION_SIMILARITY_THRESHOLD = 0.7;
export const SEMANTIC_SEARCH_THRESHOLD = 0.5;
export const SEMANTIC_SEARCH_LIMIT = 20;
export const ACTIVITY_FEED_LIMIT = 20;

export const PROJECT_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

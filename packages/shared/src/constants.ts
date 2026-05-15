export const DEFAULT_PORT = 47823;
export const SCHEMA_VERSION = '1.0';
export const EMBEDDINGS_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const APP_NAME = 'claude-project-memory';
export const LAUNCH_AGENT_LABEL = 'com.claude-project-memory';

export const EVENT_TYPES = [
  'EXTRACTION',
  'INJECTION',
  'LINK',
  'PRUNE',
  'RESTORE',
  'SUPERSEDE',
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

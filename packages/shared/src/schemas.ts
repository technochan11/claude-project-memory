import { z } from 'zod';
import { EVENT_TYPES, REFERENCE_CATEGORIES } from './constants.js';

export const HealthStatusSchema = z.object({
  status: z.enum(['ok', 'needs_configuration']),
  embeddings_ready: z.boolean(),
});
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const SetupCompleteRequestSchema = z.object({
  github_token: z.string().min(1, 'GitHub token is required'),
  github_repo: z
    .string()
    .min(1, 'Repository name is required')
    .regex(/^[A-Za-z0-9._-]+$/, 'Repo name may contain letters, digits, "._-" only'),
});
export type SetupCompleteRequest = z.infer<typeof SetupCompleteRequestSchema>;

export const ReferenceEntrySchema = z.object({
  id: z.string(),
  project_id: z.string(),
  category: z.enum(REFERENCE_CATEGORIES),
  content: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  reference_count: z.number().int().nonnegative().default(0),
  token_count: z.number().int().nonnegative().optional(),
  created_at: z.number().int(),
  last_referenced_at: z.number().int().nullable().optional(),
});
export type ReferenceEntry = z.infer<typeof ReferenceEntrySchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  description: z.string().nullable().optional(),
  github_path: z.string(),
  created_at: z.number().int(),
  last_synced_at: z.number().int().nullable().optional(),
  reference_token_budget: z.number().int().positive().default(5000),
});
export type Project = z.infer<typeof ProjectSchema>;

export const EventSchema = z.object({
  id: z.string(),
  ts: z.number().int(),
  schema_version: z.literal('1.0'),
  installation_id: z.string(),
  type: z.enum(EVENT_TYPES),
  payload: z.record(z.unknown()),
});
export type Event = z.infer<typeof EventSchema>;

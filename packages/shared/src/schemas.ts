import { z } from 'zod';
import { EVENT_TYPES, PROJECT_SLUG_REGEX, REFERENCE_CATEGORIES } from './constants.js';

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

export const ProjectSlugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(PROJECT_SLUG_REGEX, 'Slug must be kebab-case (a-z, 0-9, dashes; not at ends)');

export const ReferenceCategorySchema = z.enum(REFERENCE_CATEGORIES);

export const SeedEntryInputSchema = z.object({
  content: z.string().min(1).max(2000),
  category: ReferenceCategorySchema,
  confidence: z.number().min(0).max(1).default(1.0),
});
export type SeedEntryInput = z.infer<typeof SeedEntryInputSchema>;

export const ProjectCreateRequestSchema = z.object({
  id: ProjectSlugSchema,
  display_name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  seed_entries: z.array(SeedEntryInputSchema).min(3).max(10),
});
export type ProjectCreateRequest = z.infer<typeof ProjectCreateRequestSchema>;

export const ProjectUpdateRequestSchema = z.object({
  display_name: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(2000).optional(),
  reference_token_budget: z.number().int().positive().max(50000).optional(),
});
export type ProjectUpdateRequest = z.infer<typeof ProjectUpdateRequestSchema>;

export const EntryCreateRequestSchema = z.object({
  content: z.string().min(1).max(2000),
  category: ReferenceCategorySchema,
  confidence: z.number().min(0).max(1).default(1.0),
});
export type EntryCreateRequest = z.infer<typeof EntryCreateRequestSchema>;

export const EntryUpdateRequestSchema = z.object({
  content: z.string().min(1).max(2000).optional(),
  category: ReferenceCategorySchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type EntryUpdateRequest = z.infer<typeof EntryUpdateRequestSchema>;

export const SupersessionResolutionSchema = z.object({
  resolution: z.enum(['supersedes', 'both', 'not_related']),
});
export type SupersessionResolution = z.infer<typeof SupersessionResolutionSchema>;

export const SearchRequestSchema = z.object({
  q: z.string().min(1).max(500),
  mode: z.enum(['keyword', 'semantic']).default('keyword'),
  project: z.string().optional(),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export const ReferenceEntrySchema = z.object({
  id: z.string(),
  project_id: z.string(),
  category: ReferenceCategorySchema,
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

export const SyncStatusSchema = z.object({
  state: z.enum(['green', 'yellow', 'red']),
  last_sync_at: z.number().int().nullable(),
  pending_event_count: z.number().int().nonnegative(),
  pending_review_count: z.number().int().nonnegative(),
  last_error: z.string().nullable(),
});
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

import type { Logger } from 'pino';
import type { DB } from '../db/init.js';
import { getConfig } from '../db/init.js';
import { getGithubToken } from '../db/crypto.js';
import {
  countUnsyncedEvents,
  listUnsyncedEvents,
  markEventsSynced,
  type EventRow,
} from '../events.js';
import { countPendingReviews } from '../projects/supersession.js';
import {
  buildMetadataFor,
  buildReferenceMarkdownFor,
  getProject,
} from '../projects/repo.js';
import {
  commitBatch,
  getOwnerLogin,
  getFileContent,
  listDirectory,
  type FileChange,
} from './github.js';
import type { SyncStatus } from '@cpm/shared';

const IMMEDIATE_DEBOUNCE_MS = 5_000;
const BASE_BATCHED_INTERVAL_MS = 60_000;
const FAILURE_TOLERANCE_MS = 5 * 60_000;

interface State {
  db: DB;
  logger: Logger;
  state: 'green' | 'yellow' | 'red';
  lastSyncAt: number | null;
  lastError: string | null;
  immediateTimer: NodeJS.Timeout | null;
  batchedTimer: NodeJS.Timeout | null;
  batchedIntervalMs: number;
  flushing: boolean;
  pendingFlush: boolean;
  firstFailureAt: number | null;
  pauseNonImmediateUntil: number | null;
  ownerLogin: string | null;
  repoName: string | null;
  started: boolean;
}

let s: State | null = null;

export function start(db: DB, logger: Logger): void {
  if (s?.started) return;
  s = {
    db,
    logger,
    state: 'green',
    lastSyncAt: null,
    lastError: null,
    immediateTimer: null,
    batchedTimer: null,
    batchedIntervalMs: BASE_BATCHED_INTERVAL_MS,
    flushing: false,
    pendingFlush: false,
    firstFailureAt: null,
    pauseNonImmediateUntil: null,
    ownerLogin: null,
    repoName: null,
    started: true,
  };
  scheduleBatched();
  logger.info({}, 'sync: engine started');
}

export function stop(): void {
  if (!s) return;
  if (s.immediateTimer) clearTimeout(s.immediateTimer);
  if (s.batchedTimer) clearTimeout(s.batchedTimer);
  s.started = false;
  s = null;
}

export function requestImmediateFlush(): void {
  if (!s || !s.started) return;
  if (s.immediateTimer) return; // already coalescing
  s.immediateTimer = setTimeout(() => {
    s!.immediateTimer = null;
    void runFlush('immediate');
  }, IMMEDIATE_DEBOUNCE_MS);
}

function scheduleBatched(): void {
  if (!s) return;
  if (s.batchedTimer) clearTimeout(s.batchedTimer);
  s.batchedTimer = setTimeout(() => {
    s!.batchedTimer = null;
    void runFlush('batched').finally(scheduleBatched);
  }, s.batchedIntervalMs);
}

export async function forceFlush(): Promise<{ ok: boolean; error?: string }> {
  if (!s) return { ok: false, error: 'engine not started' };
  try {
    await runFlush('forced');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

export function getStatus(): SyncStatus {
  if (!s) {
    return { state: 'green', last_sync_at: null, pending_event_count: 0, pending_review_count: 0, last_error: null };
  }
  const pending = s.db ? countUnsyncedEvents(s.db) : 0;
  const reviews = s.db ? countPendingReviews(s.db) : 0;
  return {
    state: s.state,
    last_sync_at: s.lastSyncAt,
    pending_event_count: pending,
    pending_review_count: reviews,
    last_error: s.lastError,
  };
}

async function ensureOwnerAndRepo(): Promise<{ token: string; owner: string; repo: string } | null> {
  if (!s) return null;
  const repoFull = getConfig(s.db, 'github_repo');
  if (!repoFull) return null;
  let token: string;
  try {
    token = getGithubToken(s.db);
  } catch (err: any) {
    s.state = 'red';
    s.lastError = String(err?.message ?? err);
    s.logger.warn({ err: s.lastError }, 'sync: cannot retrieve github token');
    return null;
  }

  let owner: string;
  let repo: string;
  if (repoFull.includes('/')) {
    [owner, repo] = repoFull.split('/', 2) as [string, string];
  } else {
    if (!s.ownerLogin) s.ownerLogin = await getOwnerLogin(token);
    owner = s.ownerLogin;
    repo = repoFull;
  }
  return { token, owner, repo };
}

async function runFlush(kind: 'immediate' | 'batched' | 'forced'): Promise<void> {
  if (!s) return;
  if (s.flushing) {
    s.pendingFlush = true;
    return;
  }
  s.flushing = true;
  try {
    const ctx = await ensureOwnerAndRepo();
    if (!ctx) return;
    const events = listUnsyncedEvents(s.db);
    if (events.length === 0) {
      // Nothing to sync; still treat as healthy.
      if (s.state === 'yellow' && kind !== 'batched') s.state = 'green';
      return;
    }

    const now = Date.now();
    if (
      kind === 'batched' &&
      s.pauseNonImmediateUntil &&
      now < s.pauseNonImmediateUntil
    ) {
      return;
    }

    const start = Date.now();
    const files = await planFiles(events, ctx.token, ctx.owner, ctx.repo);
    if (files.length === 0) {
      markEventsSynced(s.db, events.map((e) => e.id));
      s.lastSyncAt = Date.now();
      s.state = 'green';
      s.lastError = null;
      s.firstFailureAt = null;
      return;
    }

    const message = buildCommitMessage(events);
    const result = await commitBatch(ctx.token, ctx.owner, ctx.repo, files, message);
    markEventsSynced(s.db, events.map((e) => e.id));
    s.lastSyncAt = Date.now();
    s.lastError = null;
    s.state = 'green';
    s.firstFailureAt = null;

    if (result.ratelimit_remaining !== null) {
      if (result.ratelimit_remaining < 200) {
        s.pauseNonImmediateUntil = Date.now() + 10 * 60_000;
      } else if (result.ratelimit_remaining < 1000) {
        s.batchedIntervalMs = BASE_BATCHED_INTERVAL_MS * 2;
      } else {
        s.batchedIntervalMs = BASE_BATCHED_INTERVAL_MS;
        s.pauseNonImmediateUntil = null;
      }
    }
    s.logger.info(
      {
        kind,
        files: result.files_committed,
        events: events.length,
        ratelimit_remaining: result.ratelimit_remaining,
        duration_ms: Date.now() - start,
        commit_sha: result.commit_sha,
      },
      'sync: flush ok',
    );
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const status = err?.status;
    s.lastError = msg;
    s.logger.warn({ err: msg, status }, 'sync: flush failed');
    if (status === 401 || /token/i.test(msg)) {
      s.state = 'red';
    } else {
      if (s.firstFailureAt === null) s.firstFailureAt = Date.now();
      if (Date.now() - s.firstFailureAt > FAILURE_TOLERANCE_MS) {
        s.state = 'yellow';
      }
    }
  } finally {
    s.flushing = false;
    if (s.pendingFlush) {
      s.pendingFlush = false;
      setTimeout(() => void runFlush('immediate'), 100);
    }
  }
}

function buildCommitMessage(events: EventRow[]): string {
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.event_type] = (counts[e.event_type] ?? 0) + 1;
  const summary = Object.entries(counts)
    .map(([t, n]) => `${t}:${n}`)
    .join(', ');
  return `sync: ${events.length} events (${summary})`;
}

async function planFiles(
  events: EventRow[],
  token: string,
  owner: string,
  repo: string,
): Promise<FileChange[]> {
  if (!s) return [];
  const byProject = new Map<string, EventRow[]>();
  for (const e of events) {
    if (!e.project_id) continue;
    const list = byProject.get(e.project_id) ?? [];
    list.push(e);
    byProject.set(e.project_id, list);
  }

  const files: FileChange[] = [];
  for (const [projectId, projEvents] of byProject) {
    const project = getProject(s.db, projectId);
    if (!project) {
      // Project was deleted — remove its directory.
      const dirFiles = await listDirectory(token, owner, repo, `projects/${projectId}`);
      for (const f of dirFiles) {
        files.push({ path: f, content: null });
      }
      // Also clear nested _pruned/_pending if present.
      for (const sub of ['_pruned', '_pending']) {
        const subFiles = await listDirectory(token, owner, repo, `projects/${projectId}/${sub}`);
        for (const f of subFiles) files.push({ path: f, content: null });
      }
      continue;
    }

    const base = `projects/${projectId}`;
    // Reference file + metadata (always regenerate).
    files.push({ path: `${base}/reference.md`, content: buildReferenceMarkdownFor(s.db, projectId) });
    files.push({
      path: `${base}/metadata.json`,
      content: JSON.stringify(buildMetadataFor(s.db, projectId), null, 2) + '\n',
    });

    // Append to _events.jsonl.
    const existing = (await getFileContent(token, owner, repo, `${base}/_events.jsonl`)) ?? '';
    const newLines = projEvents
      .map((e) =>
        JSON.stringify({
          id: e.id,
          ts: e.created_at,
          schema_version: '1.0',
          installation_id: e.installation_id,
          type: e.event_type,
          project_id: e.project_id,
          payload: safeParseJson(e.payload_json),
        }),
      )
      .join('\n');
    files.push({ path: `${base}/_events.jsonl`, content: existing + newLines + '\n' });

    // Pruned/restore handling.
    for (const e of projEvents) {
      const payload = safeParseJson(e.payload_json);
      const entryId = (payload as any)?.entry_id;
      if (!entryId) continue;
      if (e.event_type === 'ENTRY_PRUNED' || e.event_type === 'ENTRY_DELETED') {
        files.push({
          path: `${base}/_pruned/${entryId}.json`,
          content: JSON.stringify({
            entry_id: entryId,
            event: e.event_type,
            ts: e.created_at,
            payload,
          }, null, 2) + '\n',
        });
      } else if (e.event_type === 'ENTRY_RESTORED') {
        files.push({ path: `${base}/_pruned/${entryId}.json`, content: null });
      }
    }
  }
  return dedupeFiles(files);
}

function dedupeFiles(files: FileChange[]): FileChange[] {
  // Last write wins per path.
  const map = new Map<string, FileChange>();
  for (const f of files) map.set(f.path, f);
  return Array.from(map.values());
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}

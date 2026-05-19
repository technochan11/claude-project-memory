import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { DEFAULT_PORT, EMBEDDINGS_MODEL, SCHEMA_VERSION, getDataDir, getDbPath } from '@cpm/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type DB = Database.Database;

let dbInstance: DB | null = null;

function loadSchema(): string {
  // schema.sql ships next to this file in source; resolve relative to compiled location too.
  const candidates = [
    path.join(__dirname, 'schema.sql'),
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'db', 'schema.sql'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  throw new Error(`schema.sql not found. Searched: ${candidates.join(', ')}`);
}

function ensureDataDir(): void {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function generateApiKey(): string {
  return randomBytes(32).toString('base64url');
}

function generateInstallationId(): string {
  return randomBytes(16).toString('hex');
}

function seedConfigIfMissing(db: DB): void {
  const get = db.prepare<{ key: string }, { value: string }>(
    'SELECT value FROM config WHERE key = $key',
  );
  const set = db.prepare(
    'INSERT INTO config (key, value) VALUES ($key, $value) ON CONFLICT(key) DO NOTHING',
  );

  const seed = (key: string, valueFactory: () => string) => {
    const existing = get.get({ key });
    if (!existing) set.run({ key, value: valueFactory() });
  };

  db.transaction(() => {
    seed('installation_id', generateInstallationId);
    seed('api_key', generateApiKey);
    seed('embeddings_model_version', () => EMBEDDINGS_MODEL);
    // Port is written to config so it can be edited later without code changes.
    seed('port', () => String(DEFAULT_PORT));
  })();
}

function seedSchemaMeta(db: DB): void {
  db.prepare(
    "INSERT INTO schema_meta (key, value) VALUES ('version', $v) ON CONFLICT(key) DO NOTHING",
  ).run({ v: SCHEMA_VERSION });
}

function backfillFts(db: DB): void {
  const row = db.prepare<unknown[], { c: number }>('SELECT COUNT(*) AS c FROM reference_entries_fts').get();
  if ((row?.c ?? 0) > 0) return;
  const refRow = db.prepare<unknown[], { c: number }>('SELECT COUNT(*) AS c FROM reference_entries').get();
  if (!refRow || refRow.c === 0) return;
  db.exec(
    'INSERT INTO reference_entries_fts(rowid, content, project_id) SELECT rowid, content, project_id FROM reference_entries',
  );
}

function ensureCleanFts(db: DB): void {
  // FTS5 external-content tables must have column names matching the source table.
  // Older builds may have created the FTS with an `entry_id` column — drop and rebuild.
  const row = db
    .prepare<unknown[], { sql: string | null }>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='reference_entries_fts'",
    )
    .get();
  if (row?.sql && row.sql.includes('entry_id')) {
    db.exec('DROP TRIGGER IF EXISTS reference_entries_ai');
    db.exec('DROP TRIGGER IF EXISTS reference_entries_ad');
    db.exec('DROP TRIGGER IF EXISTS reference_entries_au');
    db.exec('DROP TABLE IF EXISTS reference_entries_fts');
  }
}

export function initDb(): DB {
  if (dbInstance) return dbInstance;
  ensureDataDir();
  const db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureCleanFts(db);
  db.exec(loadSchema());
  seedSchemaMeta(db);
  seedConfigIfMissing(db);
  backfillFts(db);
  dbInstance = db;
  return db;
}

export function getDb(): DB {
  if (!dbInstance) throw new Error('Database not initialized');
  return dbInstance;
}

export function getConfig(db: DB, key: string): string | null {
  const row = db
    .prepare<{ key: string }, { value: string }>('SELECT value FROM config WHERE key = $key')
    .get({ key });
  return row?.value ?? null;
}

export function setConfig(db: DB, key: string, value: string): void {
  db.prepare(
    'INSERT INTO config (key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run({ key, value });
}

export function getPort(db: DB): number {
  const v = getConfig(db, 'port');
  return v ? Number(v) : DEFAULT_PORT;
}

/**
 * Token-retrieval probe registered by initCrypto. Until crypto is initialized this is
 * null, so isConfigured() will conservatively return false. This avoids a circular
 * module-level import between init.ts and crypto.ts.
 */
let tokenRetrievable: ((db: DB) => { ok: boolean; reason?: string }) | null = null;

export function registerTokenRetrievalCheck(
  fn: (db: DB) => { ok: boolean; reason?: string },
): void {
  tokenRetrievable = fn;
}

/**
 * Configuration is "complete" when the github_repo is set AND the github token is
 * *actually retrievable* via the active crypto backend. The marker alone is not
 * enough — if the keychain entry was deleted out from under us, we want
 * `status: 'needs_configuration'`, not a silently-broken `ok`.
 */
export function isConfigured(db: DB): boolean {
  if (!getConfig(db, 'github_repo')) return false;
  if (!getConfig(db, 'github_token_ciphertext')) return false;
  if (!tokenRetrievable) return false; // initCrypto hasn't completed yet
  return tokenRetrievable(db).ok;
}

/** Returns the reason isConfigured() is false (useful for logging). Returns null if configured. */
export function configurationProblem(db: DB): string | null {
  if (!getConfig(db, 'github_repo')) return 'github_repo not set';
  if (!getConfig(db, 'github_token_ciphertext')) return 'github_token_ciphertext not set';
  if (!tokenRetrievable) return 'crypto backend not initialized yet';
  const r = tokenRetrievable(db);
  return r.ok ? null : (r.reason ?? 'token not retrievable');
}

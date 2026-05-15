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

export function initDb(): DB {
  if (dbInstance) return dbInstance;
  ensureDataDir();
  const db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(loadSchema());
  seedSchemaMeta(db);
  seedConfigIfMissing(db);
  dbInstance = db;
  return db;
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

export function isConfigured(db: DB): boolean {
  return Boolean(getConfig(db, 'github_token_ciphertext') && getConfig(db, 'github_repo'));
}

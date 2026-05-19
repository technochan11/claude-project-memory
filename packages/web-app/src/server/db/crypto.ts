import os from 'node:os';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import type { DB } from './init.js';
import { getConfig, setConfig, registerTokenRetrievalCheck } from './init.js';

const SERVICE = 'claude-project-memory';
const ACCOUNT = 'github_token';
const FALLBACK_SALT_KEY = 'crypto_fallback_salt';

type KeyringMod = { Entry: new (service: string, account: string) => {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
} };

type Mode = 'keyring' | 'aes-fallback';
let activeMode: Mode | null = null;
let keyring: KeyringMod | null = null;

export function getActiveCryptoMode(): Mode | null {
  return activeMode;
}

export const KEYRING_MARKER = 'keyring';

async function tryLoadKeyring(): Promise<KeyringMod | null> {
  try {
    const mod = (await import('@napi-rs/keyring')) as unknown as KeyringMod;
    if (!mod || !mod.Entry) return null;
    // Smoke-test access.
    const entry = new mod.Entry(SERVICE, '__cpm_probe__');
    entry.getPassword(); // throws if backend unavailable on this platform
    return mod;
  } catch {
    return null;
  }
}

/** One-time init that decides which encryption path to use. */
export async function initCrypto(
  db: DB,
  logger: { info: (obj: object | string, msg?: string) => void; warn: (obj: object | string, msg?: string) => void },
): Promise<void> {
  keyring = await tryLoadKeyring();
  activeMode = keyring ? 'keyring' : 'aes-fallback';
  if (activeMode === 'keyring') {
    logger.info('crypto: using OS keyring (@napi-rs/keyring)');
  } else {
    if (!getConfig(db, FALLBACK_SALT_KEY)) {
      setConfig(db, FALLBACK_SALT_KEY, randomBytes(32).toString('base64'));
    }
    logger.warn('crypto: falling back to AES-256-GCM with machine-derived key (keyring unavailable)');
  }
  registerTokenRetrievalCheck(canRetrieveGithubToken);

  // One-shot probe: log whether we can actually read the stored token (if any).
  const stored = getConfig(db, 'github_token_ciphertext');
  if (stored) {
    const probe = canRetrieveGithubToken(db);
    if (probe.ok) {
      logger.info(
        { backend: activeMode, marker: stored === KEYRING_MARKER ? 'keyring' : 'aes' },
        'crypto: github token retrievable on startup',
      );
    } else {
      logger.warn(
        { backend: activeMode, reason: probe.reason },
        'crypto: github token NOT retrievable — health will report needs_configuration until fixed',
      );
    }
  }
}

function deriveFallbackKey(db: DB): Buffer {
  const salt = getConfig(db, FALLBACK_SALT_KEY);
  if (!salt) throw new Error('Fallback crypto salt not initialized');
  const machineId = `${os.hostname()}::${os.userInfo().username}`;
  const material = createHash('sha256').update(machineId).digest();
  return scryptSync(material, Buffer.from(salt, 'base64'), 32);
}

function encryptAesGcm(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decryptAesGcm(blob: string, key: Buffer): string {
  const [v, ivB64, tagB64, encB64] = blob.split(':');
  if (v !== 'v1' || !ivB64 || !tagB64 || !encB64) throw new Error('Malformed ciphertext');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const enc = Buffer.from(encB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/** Encrypts and persists the GitHub token. Stores it in keyring when available; otherwise AES-256-GCM ciphertext in config. */
export function storeGithubToken(db: DB, token: string): void {
  if (activeMode === null) throw new Error('crypto not initialized');
  if (activeMode === 'keyring' && keyring) {
    new keyring.Entry(SERVICE, ACCOUNT).setPassword(token);
    setConfig(db, 'github_token_ciphertext', KEYRING_MARKER);
    return;
  }
  const key = deriveFallbackKey(db);
  setConfig(db, 'github_token_ciphertext', encryptAesGcm(token, key));
}

/**
 * Resolves the stored GitHub token to plaintext.
 *
 * - If config holds the `keyring` marker, read from the OS keychain (must be available).
 *   The keychain backend is what holds the real secret; the marker just records *where*
 *   the token lives.
 * - Otherwise treat the stored value as AES-256-GCM ciphertext and decrypt with the
 *   machine-derived fallback key.
 *
 * Throws a descriptive error when the token cannot be retrieved (used by the sync engine
 * + isConfigured check so we never silently report healthy when the secret is unreachable).
 */
export function getGithubToken(db: DB): string {
  const stored = getConfig(db, 'github_token_ciphertext');
  if (!stored) {
    throw new Error('github_token_ciphertext missing from config');
  }
  if (stored === KEYRING_MARKER) {
    if (!keyring) {
      throw new Error(
        'github_token marker is "keyring" but @napi-rs/keyring backend is not loaded. Re-run setup or check OS keychain access.',
      );
    }
    const pw = new keyring.Entry(SERVICE, ACCOUNT).getPassword();
    if (!pw) {
      throw new Error(
        'github_token marker is "keyring" but no entry was found in the OS keychain (service=claude-project-memory, account=github_token). Re-run setup.',
      );
    }
    return pw;
  }
  const key = deriveFallbackKey(db);
  return decryptAesGcm(stored, key);
}

/**
 * Non-throwing variant — returns null if the token cannot be loaded for any reason.
 * Kept for backwards compatibility with existing callers (sync engine handles null
 * by reporting an error state).
 */
export function loadGithubToken(db: DB): string | null {
  try {
    return getGithubToken(db);
  } catch {
    return null;
  }
}

/**
 * True iff the github token is actually retrievable right now. Used by isConfigured so we
 * don't report `status: 'ok'` when the marker exists but the secret can't be read.
 */
export function canRetrieveGithubToken(db: DB): { ok: boolean; reason?: string } {
  try {
    getGithubToken(db);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: String(err?.message ?? err) };
  }
}

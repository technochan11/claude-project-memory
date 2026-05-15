import os from 'node:os';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import type { DB } from './init.js';
import { getConfig, setConfig } from './init.js';

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
    setConfig(db, 'github_token_ciphertext', 'keyring');
    return;
  }
  const key = deriveFallbackKey(db);
  setConfig(db, 'github_token_ciphertext', encryptAesGcm(token, key));
}

export function loadGithubToken(db: DB): string | null {
  const stored = getConfig(db, 'github_token_ciphertext');
  if (!stored) return null;
  if (stored === 'keyring') {
    if (!keyring) return null;
    return new keyring.Entry(SERVICE, ACCOUNT).getPassword();
  }
  const key = deriveFallbackKey(db);
  return decryptAesGcm(stored, key);
}

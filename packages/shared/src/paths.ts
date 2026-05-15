import os from 'node:os';
import path from 'node:path';
import { APP_NAME } from './constants.js';

/** Platform-specific data directory holding the SQLite db and any persisted state. */
export function getDataDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, APP_NAME);
  }
  // macOS (and any other unix-y dev environment falls here)
  return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
}

export function getDbPath(): string {
  return path.join(getDataDir(), 'db.sqlite');
}

/** Platform-specific logs directory. JSON lines, daily rotation, 30-day retention. */
export function getLogsDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, APP_NAME, 'logs');
  }
  return path.join(os.homedir(), 'Library', 'Logs', APP_NAME);
}

/** Launch agent plist path on macOS. */
export function getLaunchAgentPlistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.claude-project-memory.plist');
}

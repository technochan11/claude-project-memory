#!/usr/bin/env node
/* eslint-disable no-console */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const platform = process.platform;
let result;
if (platform === 'darwin') {
  result = spawnSync('bash', [path.join(__dirname, 'setup-mac.sh')], { stdio: 'inherit' });
} else if (platform === 'win32') {
  result = spawnSync(
    'powershell.exe',
    ['-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'setup-windows.ps1')],
    { stdio: 'inherit' },
  );
} else {
  console.error(`Unsupported platform: ${platform}. Only macOS and Windows are supported.`);
  process.exit(1);
}
process.exit(result.status ?? 0);

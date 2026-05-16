#!/usr/bin/env node
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const val = argv[i + 1];
    if (!key || !key.startsWith('--')) continue;
    out[key.slice(2)] = val;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const required = ['node', 'repo', 'logs', 'out'];
for (const k of required) {
  if (!args[k]) {
    console.error(`Missing --${k}`);
    process.exit(2);
  }
}

const nodeBin = args.node;
const repoDir = path.resolve(args.repo);
const logsDir = path.resolve(args.logs);
const outPath = path.resolve(args.out);
const label = args.label || 'com.claude-project-memory';

const tsxBin = path.join(repoDir, 'node_modules', '.bin', 'tsx');
const serverEntry = path.join(repoDir, 'packages', 'web-app', 'src', 'server', 'index.ts');

if (!fs.existsSync(tsxBin)) {
  console.error(`tsx binary not found at ${tsxBin}. Run 'npm install' first.`);
  process.exit(2);
}

const stdoutLog = path.join(logsDir, 'launchd.out.log');
const stderrLog = path.join(logsDir, 'launchd.err.log');

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${tsxBin}</string>
    <string>${serverEntry}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${repoDir}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${stdoutLog}</string>
  <key>StandardErrorPath</key>
  <string>${stderrLog}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
</dict>
</plist>
`;

fs.writeFileSync(outPath, plist, 'utf8');
console.log(`Wrote ${outPath}`);

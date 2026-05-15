#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$HOME/Library/Application Support/claude-project-memory"
LOGS_DIR="$HOME/Library/Logs/claude-project-memory"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENTS_DIR/com.claude-project-memory.plist"
LABEL="com.claude-project-memory"

echo "[setup] repo:  $REPO_DIR"
echo "[setup] data:  $DATA_DIR"
echo "[setup] logs:  $LOGS_DIR"

mkdir -p "$DATA_DIR" "$LOGS_DIR" "$LAUNCH_AGENTS_DIR"

if [ ! -d "$REPO_DIR/node_modules" ]; then
  echo "[setup] node_modules not present — run 'npm install' first."
  exit 1
fi

NODE_BIN="$(command -v node)"
if [ -z "$NODE_BIN" ]; then
  echo "[setup] node not found in PATH."
  exit 1
fi

echo "[setup] generating launchd plist…"
node "$REPO_DIR/scripts/generate-launchd-plist.js" \
  --node "$NODE_BIN" \
  --repo "$REPO_DIR" \
  --logs "$LOGS_DIR" \
  --out "$PLIST_PATH"

echo "[setup] (re)loading launchd agent $LABEL…"
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo
echo "[setup] Done. The app should now be running."
echo "[setup] Initial startup downloads the embeddings model (~20MB, 30s–2min)."
echo "[setup] Open http://localhost:47823/setup to finish configuration."

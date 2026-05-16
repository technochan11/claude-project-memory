#!/usr/bin/env bash
set -euo pipefail

# All variables defined up front. `set -u` would abort if any were
# referenced before assignment.
LABEL="com.claude-project-memory"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$HOME/Library/Application Support/claude-project-memory"
LOGS_DIR="$HOME/Library/Logs/claude-project-memory"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENTS_DIR/${LABEL}.plist"

echo "[setup] label: $LABEL"
echo "[setup] repo:  $REPO_DIR"
echo "[setup] data:  $DATA_DIR"
echo "[setup] logs:  $LOGS_DIR"
echo "[setup] plist: $PLIST_PATH"

mkdir -p "$DATA_DIR" "$LOGS_DIR" "$LAUNCH_AGENTS_DIR"

if [ ! -d "$REPO_DIR/node_modules" ]; then
  echo "[setup] node_modules not present — run 'npm install' first."
  exit 1
fi

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "[setup] node not found in PATH."
  exit 1
fi

echo "[setup] building client bundle…"
(cd "$REPO_DIR" && npm run build --silent)

echo "[setup] generating launchd plist…"
node "$REPO_DIR/scripts/generate-launchd-plist.js" \
  --node "$NODE_BIN" \
  --repo "$REPO_DIR" \
  --logs "$LOGS_DIR" \
  --out "$PLIST_PATH" \
  --label "$LABEL"

echo "[setup] (re)loading launchd agent ${LABEL}…"
launchctl unload -w "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl load -w "$PLIST_PATH"

# Verify the service started by hitting its health endpoint. `launchctl list`
# can lag inside this subshell so we probe the port directly.
CONFIRMED=0
for _i in $(seq 1 20); do
  sleep 1
  if curl -sf -o /dev/null --max-time 1 http://localhost:47823/api/health; then
    echo "[setup] health endpoint responding — service is up."
    CONFIRMED=1
    break
  fi
done
if [ "$CONFIRMED" -ne 1 ]; then
  echo "[setup] WARNING: /api/health did not respond within 20s. Check ${LOGS_DIR}/launchd.err.log."
fi

echo
echo "Setup complete. Open http://localhost:47823 to finish configuration."
echo "(First run downloads the ~20MB embeddings model; expect 30s–2min before /api/health reports embeddings_ready:true.)"

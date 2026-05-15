# Claude Project Memory

Personal-use system that gives Claude long-term project memory. Runs locally on
your machine and pairs with a Chrome extension to inject relevant project
context into messages on claude.ai. Single-user, no distribution.

## Components

- **Web app** (`packages/web-app`) — Hono backend + React/Tailwind dashboard. Holds the SQLite database, runs embeddings, syncs to GitHub.
- **Chrome extension** (`packages/extension`) — Manifest V3 extension (Phase 4, not built yet).
- **Shared** (`packages/shared`) — types, constants, schemas shared across packages.

## Requirements

- Node.js 20+
- macOS or Windows
- A GitHub account (the app creates a private repo to sync your data into)

## Install / first run

```bash
git clone <this repo>
cd claude-project-memory
npm install
npm run setup
```

`npm run setup` will:

1. Create the platform data directory (`~/Library/Application Support/claude-project-memory/` on macOS, `%APPDATA%\claude-project-memory\` on Windows).
2. Initialize the SQLite database with full schema.
3. Generate your `installation_id` and `api_key` and store them in the database.
4. Install a launch agent (macOS) or scheduled task (Windows) so the app starts on login.
5. Start the server and print a URL.

Then open <http://localhost:47823/setup> in your browser to provide your GitHub
token and repo name. The app will validate the token and create the private
data repo before unlocking the rest of the dashboard.

> **First run will be slow.** The app downloads the
> `Xenova/all-MiniLM-L6-v2` embeddings model (~20MB) from Hugging Face on
> first launch. Expect 30 seconds to 2 minutes before `embeddings_ready: true`.
> Subsequent starts use the cached model and are fast.

## Development

```bash
npm run dev       # start web-app in dev mode (Vite + tsx watch)
npm run lint
npm run typecheck
```

## Health check

```bash
curl http://localhost:47823/api/health
# { "status": "ok" | "needs_configuration", "embeddings_ready": true | false }
```

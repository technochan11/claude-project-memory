import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';
import { initDb, getPort } from './db/init.js';
import { initCrypto } from './db/crypto.js';
import { initLogger } from './logging.js';
import { startWarmup } from './embeddings/index.js';
import { corsMiddleware } from './middleware/cors.js';
import { makeAuthMiddleware } from './middleware/auth.js';
import { healthRoutes } from './routes/health.js';
import { setupRoutes } from './routes/setup.js';
import { settingsRoutes } from './routes/settings.js';
import { projectsRoutes } from './routes/projects.js';
import { reviewsRoutes } from './routes/reviews.js';
import { activityRoutes } from './routes/activity.js';
import { searchRoutes } from './routes/search.js';
import { syncRoutes } from './routes/sync.js';
import { start as startSyncEngine } from './sync/engine.js';
import { dailySweep } from './projects/pruning.js';
import { getConfig, isConfigured } from './db/init.js';
import { startDownload as startLlmDownload } from './llm/local.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const logger = initLogger();
  const db = initDb();
  await initCrypto(db, logger);
  startWarmup(logger);

  // Auto-warm the local LLM only if the user has previously opted in via Settings.
  // With a warm Hugging Face cache this resolves in seconds; otherwise it
  // streams weights in the background while the rest of the server starts.
  if (getConfig(db, 'ai_enabled') === 'true') {
    void startLlmDownload(logger).catch((err) => {
      logger.warn({ err: String(err?.message ?? err) }, 'llm: auto-warm failed');
    });
  }

  const port = getPort(db);
  const ownOrigin = `http://localhost:${port}`;

  const app = new Hono();
  app.use('*', corsMiddleware);
  app.use('/api/*', makeAuthMiddleware(db, ownOrigin));

  app.route('/api', healthRoutes(db));
  app.route('/api', setupRoutes(db, logger));
  app.route('/api', settingsRoutes(db, logger));
  app.route('/api', projectsRoutes(db, logger));
  app.route('/api', reviewsRoutes(db));
  app.route('/api', activityRoutes(db));
  app.route('/api', searchRoutes(db));
  app.route('/api', syncRoutes());

  // Start sync engine and run daily sweep once the DB is configured.
  if (isConfigured(db)) {
    startSyncEngine(db, logger);
    try {
      const swept = dailySweep(db);
      if (swept.hardDeleted.length > 0) {
        logger.info({ count: swept.hardDeleted.length }, 'pruning: hard-deleted expired entries on startup');
      }
    } catch (e: any) {
      logger.warn({ err: String(e?.message ?? e) }, 'pruning: dailySweep failed');
    }
  }

  // Static client (built dashboard). In dev, Vite serves the client separately
  // and proxies /api to this server, so the production static-serving block
  // below is only used when running under launchd.
  //
  // Candidates handle both `tsx` (running from src) and compiled (running from
  // dist/server) launches.
  const clientDistCandidates = [
    path.resolve(__dirname, '..', '..', 'dist', 'client'),  // src/server  -> packages/web-app/dist/client
    path.resolve(__dirname, '..', 'client'),                // dist/server -> packages/web-app/dist/client
  ];
  const clientDist = clientDistCandidates.find((p) => fs.existsSync(path.join(p, 'index.html')));

  if (clientDist) {
    const staticRoot = path.relative(process.cwd(), clientDist) || '.';
    app.use(
      '/*',
      serveStatic({
        root: staticRoot,
        // Serve assets directly; everything that doesn't match a file falls
        // through to the SPA fallback handler below.
      }),
    );
    // SPA fallback for client-side routes like /setup, /dashboard, etc.
    app.get('*', (c) => {
      const indexHtml = path.join(clientDist, 'index.html');
      return c.html(fs.readFileSync(indexHtml, 'utf8'));
    });
    logger.info({ clientDist }, 'server: serving client bundle');
  } else {
    logger.warn({ candidates: clientDistCandidates }, 'server: client bundle not found — run `npm run build`');
    app.get('/', (c) =>
      c.text('Server running. Client bundle not built — run `npm run build` (or `npm run dev` for development)'),
    );
  }

  serve({ fetch: app.fetch, port }, (info) => {
    logger.info({ port: info.port }, 'server: listening');
    // Also echo to stdout for the setup script to see.
    // eslint-disable-next-line no-console
    console.log(`claude-project-memory listening at http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal:', err);
  process.exit(1);
});

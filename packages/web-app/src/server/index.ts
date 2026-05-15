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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const logger = initLogger();
  const db = initDb();
  await initCrypto(db, logger);
  startWarmup(logger);

  const port = getPort(db);
  const ownOrigin = `http://localhost:${port}`;

  const app = new Hono();
  app.use('*', corsMiddleware);
  app.use('/api/*', makeAuthMiddleware(db, ownOrigin));

  app.route('/api', healthRoutes(db));
  app.route('/api', setupRoutes(db, logger));

  // Static client (built dashboard). In dev, Vite serves the client separately.
  const clientDist = path.resolve(__dirname, '..', 'client');
  if (fs.existsSync(clientDist)) {
    app.use('/*', serveStatic({ root: path.relative(process.cwd(), clientDist) || '.' }));
    app.get('*', (c) => {
      const index = path.join(clientDist, 'index.html');
      if (fs.existsSync(index)) {
        return c.html(fs.readFileSync(index, 'utf8'));
      }
      return c.text('Dashboard not built. Run `npm run build:client`.', 503);
    });
  } else {
    app.get('/', (c) =>
      c.text('Server running. Dashboard not built. Run `npm run dev` for development.'),
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

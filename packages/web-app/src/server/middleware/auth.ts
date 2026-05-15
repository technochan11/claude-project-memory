import type { MiddlewareHandler } from 'hono';
import type { DB } from '../db/init.js';
import { getConfig } from '../db/init.js';

/**
 * Same-origin requests skip the API-key check. Cross-origin requests must
 * present a valid X-API-Key header matching `config.api_key`.
 *
 * "Same-origin" here means: the request's Origin header matches the server's
 * own origin, OR no Origin header is present (typical for same-origin fetches
 * and curl). The dashboard at http://localhost:<port> falls in the first case.
 */
export function makeAuthMiddleware(db: DB, ownOrigin: string): MiddlewareHandler {
  return async (c, next) => {
    // Always allow health unauthenticated so the extension can probe.
    if (c.req.path === '/api/health') return next();

    const origin = c.req.header('Origin');
    const sameOrigin = !origin || origin === ownOrigin;
    if (sameOrigin) return next();

    const apiKey = getConfig(db, 'api_key');
    const provided = c.req.header('X-API-Key');
    if (!apiKey || !provided || provided !== apiKey) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return next();
  };
}

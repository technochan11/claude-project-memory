import type { MiddlewareHandler } from 'hono';

const ALLOWED_PATTERNS: RegExp[] = [
  /^https:\/\/claude\.ai$/,
  /^https:\/\/[a-z0-9-]+\.claude\.ai$/,
  /^http:\/\/localhost:\d+$/,
];

function isAllowed(origin: string | undefined | null): boolean {
  if (!origin) return false;
  return ALLOWED_PATTERNS.some((re) => re.test(origin));
}

export const corsMiddleware: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header('Origin');
  if (origin && isAllowed(origin)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
    c.header('Access-Control-Allow-Credentials', 'true');
  }
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
};

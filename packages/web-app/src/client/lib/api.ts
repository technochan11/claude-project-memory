async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('Content-Type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof data === 'object' && data && 'error' in data ? (data as any).error : String(data);
    throw new Error(msg || `${method} ${path} failed`);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => req<T>('GET', p),
  getText: async (p: string) => {
    const res = await fetch(p);
    if (!res.ok) throw new Error(`GET ${p} failed`);
    return res.text();
  },
  post: <T>(p: string, b?: unknown) => req<T>('POST', p, b),
  put: <T>(p: string, b?: unknown) => req<T>('PUT', p, b),
  delete: <T>(p: string) => req<T>('DELETE', p),
};

/**
 * Like `api.post`, but accepts an AbortSignal for client-side timeouts.
 * Kept additive so existing call sites of `api.post` are unaffected.
 */
export async function postWithSignal<T>(
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  const ct = res.headers.get('Content-Type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof data === 'object' && data && 'error' in data ? (data as any).error : String(data);
    throw new Error(msg || `POST ${path} failed`);
  }
  return data as T;
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

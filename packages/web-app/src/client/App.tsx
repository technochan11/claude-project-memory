import React, { useEffect, useState } from 'react';
import { Setup } from './pages/Setup.js';

type Health = { status: 'ok' | 'needs_configuration'; embeddings_ready: boolean };

export function App(): React.ReactElement {
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch('/api/health');
      const json = (await res.json()) as Health;
      setHealth(json);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, []);

  if (err) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md bg-white border border-red-200 rounded-lg p-6">
          <h1 className="text-lg font-semibold text-red-700">Cannot reach local server</h1>
          <p className="mt-2 text-sm text-slate-600">{err}</p>
        </div>
      </div>
    );
  }
  if (!health) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>;
  }
  if (health.status === 'needs_configuration') {
    return <Setup onComplete={refresh} embeddingsReady={health.embeddings_ready} />;
  }
  return (
    <div className="min-h-screen p-8 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Claude Project Memory</h1>
        <p className="text-sm text-slate-500">
          Configured. Embeddings:{' '}
          <span className={health.embeddings_ready ? 'text-green-600' : 'text-amber-600'}>
            {health.embeddings_ready ? 'ready' : 'loading…'}
          </span>
        </p>
      </header>
      <p className="text-slate-600">
        Phase 1 foundation is up. Project management, reference files, and the Chrome extension
        come in later phases.
      </p>
    </div>
  );
}

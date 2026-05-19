import React, { useEffect, useState } from 'react';
import { api, timeAgo } from '../lib/api.js';

interface Status {
  state: 'green' | 'yellow' | 'red';
  last_sync_at: number | null;
  pending_event_count: number;
  pending_review_count: number;
  last_error: string | null;
}

export function Settings(): React.ReactElement {
  const [status, setStatus] = useState<Status | null>(null);
  const [forcing, setForcing] = useState(false);

  async function load() {
    setStatus(await api.get<Status>('/api/sync/status'));
  }
  useEffect(() => { void load(); }, []);

  async function force() {
    setForcing(true);
    try {
      await api.post('/api/sync/force', {});
      await load();
    } finally { setForcing(false); }
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">Settings</h1>

      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-2 text-slate-700">Sync</h2>
        <div className="border border-slate-200 rounded-md p-4 text-sm space-y-2">
          <div>State: <span className="font-mono">{status?.state ?? '—'}</span></div>
          <div>Last successful sync: {status?.last_sync_at ? timeAgo(status.last_sync_at) : '—'}</div>
          <div>Pending events: {status?.pending_event_count ?? 0}</div>
          {status?.last_error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-800 break-words">{status.last_error}</div>
          )}
          <button onClick={force} disabled={forcing} className="rounded-md bg-slate-900 text-white text-xs px-2 py-1 disabled:opacity-50">
            {forcing ? 'Syncing…' : 'Force sync now'}
          </button>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-2 text-slate-700">About</h2>
        <div className="border border-slate-200 rounded-md p-4 text-xs text-slate-600">
          Logs: <code>~/Library/Logs/claude-project-memory/</code> (macOS) or <code>%APPDATA%\claude-project-memory\logs\</code> (Windows).
        </div>
      </section>
    </div>
  );
}

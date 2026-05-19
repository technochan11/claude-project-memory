import React, { useEffect, useState } from 'react';
import { api, timeAgo } from '../lib/api.js';

type Status = {
  state: 'green' | 'yellow' | 'red';
  last_sync_at: number | null;
  pending_event_count: number;
  pending_review_count: number;
  last_error: string | null;
};

const dotColor: Record<Status['state'], string> = {
  green: 'bg-green-500',
  yellow: 'bg-amber-500',
  red: 'bg-red-500',
};

export function SyncIndicator(): React.ReactElement {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [forcing, setForcing] = useState(false);

  useEffect(() => {
    const tick = async () => {
      try {
        setStatus(await api.get<Status>('/api/sync/status'));
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  async function force() {
    setForcing(true);
    try {
      await api.post('/api/sync/force', {});
      setStatus(await api.get<Status>('/api/sync/status'));
    } catch (e: any) {
      // ignore — status will reflect error
    } finally {
      setForcing(false);
    }
  }

  if (!status) return <></>;
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 bg-white border border-slate-200 rounded-full px-3 py-1.5 shadow-sm text-xs hover:bg-slate-50"
      >
        <span className={`inline-block h-2 w-2 rounded-full ${dotColor[status.state]}`} />
        <span className="text-slate-700">
          Sync {status.state === 'green' ? 'idle' : status.state}
          {status.pending_event_count > 0 && ` · ${status.pending_event_count} queued`}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 bottom-10 w-80 bg-white border border-slate-200 rounded-lg shadow-lg p-4 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-700">Sync status</span>
            <button onClick={() => setOpen(false)} className="text-slate-400">×</button>
          </div>
          <div className="text-slate-600">
            <div>Last successful sync: {status.last_sync_at ? timeAgo(status.last_sync_at) : '—'}</div>
            <div>Pending events: {status.pending_event_count}</div>
            <div>Pending reviews: {status.pending_review_count}</div>
          </div>
          {status.last_error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-red-800 break-words">
              {status.last_error}
            </div>
          )}
          <button
            onClick={force}
            disabled={forcing}
            className="w-full rounded-md bg-slate-900 text-white py-1.5 text-xs hover:bg-slate-800 disabled:opacity-50"
          >
            {forcing ? 'Syncing…' : 'Force sync now'}
          </button>
          <a href="/settings" className="block text-center text-slate-500 hover:text-slate-800">
            View sync settings →
          </a>
        </div>
      )}
    </div>
  );
}

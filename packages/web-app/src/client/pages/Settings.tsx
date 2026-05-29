import React, { useEffect, useRef, useState } from 'react';
import { api, timeAgo } from '../lib/api.js';

interface Status {
  state: 'green' | 'yellow' | 'red';
  last_sync_at: number | null;
  pending_event_count: number;
  pending_review_count: number;
  last_error: string | null;
}

type AiModelState = 'not_downloaded' | 'downloading' | 'ready' | 'unloaded';

interface AiStatus {
  state: AiModelState;
  progress?: number;
  model?: string;
  enabled: boolean;
}

export function Settings(): React.ReactElement {
  const [status, setStatus] = useState<Status | null>(null);
  const [forcing, setForcing] = useState(false);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    setStatus(await api.get<Status>('/api/sync/status'));
  }
  useEffect(() => { void load(); }, []);

  async function loadAi() {
    try {
      setAi(await api.get<AiStatus>('/api/settings/ai/status'));
    } catch {
      // Ignore — endpoint may briefly be unavailable during startup.
    }
  }
  useEffect(() => { void loadAi(); }, []);

  // Poll while downloading.
  useEffect(() => {
    if (ai?.state === 'downloading') {
      if (!pollRef.current) {
        pollRef.current = setInterval(() => { void loadAi(); }, 1000);
      }
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [ai?.state]);

  async function force() {
    setForcing(true);
    try {
      await api.post('/api/sync/force', {});
      await load();
    } finally { setForcing(false); }
  }

  async function toggleAi(enabled: boolean) {
    setAiBusy(true);
    try {
      await api.post('/api/settings/ai/enabled', { enabled });
      await loadAi();
    } finally { setAiBusy(false); }
  }

  async function downloadModel() {
    setAiBusy(true);
    try {
      await api.post('/api/settings/ai/download', {});
      await loadAi();
    } finally { setAiBusy(false); }
  }

  async function unloadModel() {
    setAiBusy(true);
    try {
      await api.post('/api/settings/ai/unload', {});
      await loadAi();
    } finally { setAiBusy(false); }
  }

  function aiStatusLabel(): string {
    if (!ai) return '—';
    switch (ai.state) {
      case 'not_downloaded': return 'not downloaded';
      case 'downloading': return `downloading ${ai.progress ?? 0}%`;
      case 'ready': return `ready${ai.model ? ` (${ai.model.split('/').pop()})` : ''}`;
      case 'unloaded': return 'unloaded';
    }
  }

  const showDownload =
    !!ai?.enabled && (ai.state === 'not_downloaded' || ai.state === 'unloaded');
  const showUnload = ai?.state === 'ready';

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
        <h2 className="text-sm font-semibold mb-2 text-slate-700">AI Features</h2>
        <div className="border border-slate-200 rounded-md p-4 text-sm space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!ai?.enabled}
              disabled={aiBusy || ai?.state === 'downloading'}
              onChange={(e) => void toggleAi(e.target.checked)}
            />
            <span>Generate seed entries with AI</span>
          </label>
          <div className="text-slate-700">
            Local AI model: <span className="font-mono">{aiStatusLabel()}</span>
          </div>
          <div className="flex gap-2">
            {showDownload && (
              <button
                onClick={downloadModel}
                disabled={aiBusy}
                className="rounded-md bg-slate-900 text-white text-xs px-2 py-1 disabled:opacity-50"
              >
                Download AI model
              </button>
            )}
            {showUnload && (
              <button
                onClick={unloadModel}
                disabled={aiBusy}
                className="rounded-md border border-slate-300 text-slate-700 text-xs px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
              >
                Unload model
              </button>
            )}
          </div>
          <div className="text-xs text-slate-500">
            Local AI uses ~1.5 GB of disk and ~2–3 GB of RAM during generation.
          </div>
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

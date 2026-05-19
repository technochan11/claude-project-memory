import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

interface SearchResult {
  entry_id: string;
  project_id: string;
  project_display_name: string;
  category: string;
  content: string;
  score: number;
  snippet?: string;
}

export function Search(): React.ReactElement {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'keyword' | 'semantic'>('keyword');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ results: SearchResult[] }>(
        `/api/search?q=${encodeURIComponent(q)}&mode=${mode}`,
      );
      setResults(res.results);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-6">Search</h1>
      <form onSubmit={submit} className="flex items-center gap-2 mb-6">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='Search entries… (try "project:my-project keyword")'
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <select value={mode} onChange={(e) => setMode(e.target.value as any)} className="rounded-md border border-slate-300 px-2 py-2 text-sm">
          <option value="keyword">Keyword</option>
          <option value="semantic">Semantic</option>
        </select>
        <button type="submit" className="rounded-md bg-slate-900 text-white text-sm px-3 py-2 hover:bg-slate-800">Search</button>
      </form>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 mb-4">{error}</div>}
      {loading && <p className="text-sm text-slate-500">Searching…</p>}

      {results === null ? (
        <p className="text-sm text-slate-500">Search across all your reference entries and projects.</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-slate-500">No results.</p>
      ) : (
        <ul className="space-y-3">
          {results.map((r) => (
            <li key={r.entry_id} className="border border-slate-200 rounded-md p-3 text-sm">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>
                  <Link to={`/projects/${r.project_id}`} className="hover:underline">{r.project_display_name}</Link>
                  <span className="ml-2 uppercase tracking-wide">{r.category}</span>
                </span>
                <span>score: {r.score.toFixed(3)}</span>
              </div>
              {r.snippet ? (
                <div dangerouslySetInnerHTML={{ __html: r.snippet }} />
              ) : (
                <div>{r.content}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

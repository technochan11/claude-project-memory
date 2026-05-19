import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

const CATEGORIES = ['decision', 'constraint', 'specification', 'pattern', 'todo'] as const;
type Category = (typeof CATEGORIES)[number];

interface SeedEntry {
  content: string;
  category: Category;
  confidence: number;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function ProjectNew(): React.ReactElement {
  const nav = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [id, setId] = useState('');
  const [idDirty, setIdDirty] = useState(false);
  const [description, setDescription] = useState('');
  const [entries, setEntries] = useState<SeedEntry[]>([
    { content: '', category: 'decision', confidence: 1 },
    { content: '', category: 'constraint', confidence: 1 },
    { content: '', category: 'specification', confidence: 1 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugValid = SLUG_RE.test(id);

  function updateEntry(idx: number, patch: Partial<SeedEntry>) {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!slugValid) {
      setError('Project ID must be kebab-case (a-z, 0-9, dashes).');
      return;
    }
    if (entries.length < 3) {
      setError('At least 3 seed entries are required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<{ project: { id: string } }>('/api/projects', {
        id,
        display_name: displayName,
        description,
        seed_entries: entries.map((e) => ({ content: e.content, category: e.category, confidence: e.confidence })),
      });
      nav(`/projects/${res.project.id}`);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-6">New project</h1>
      <form onSubmit={submit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700">Display name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              if (!idDirty) setId(slugify(e.target.value));
            }}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Project ID (slug)</label>
          <input
            type="text"
            value={id}
            onChange={(e) => { setId(e.target.value); setIdDirty(true); }}
            className={`mt-1 w-full rounded-md border px-3 py-2 text-sm font-mono ${slugValid || id === '' ? 'border-slate-300' : 'border-red-400'}`}
            required
          />
          <p className={`mt-1 text-xs ${slugValid || id === '' ? 'text-slate-500' : 'text-red-600'}`}>
            kebab-case: lowercase letters, digits, dashes; cannot start or end with a dash.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="2–3 sentences. This seeds the centroid for similarity matching."
            required
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-slate-700">Seed reference entries ({entries.length})</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEntries((p) => p.length < 10 ? [...p, { content: '', category: 'decision', confidence: 1 }] : p)}
                className="text-xs rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50"
                disabled={entries.length >= 10}
              >
                + Add entry
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500 mb-3">Minimum 3, maximum 10. Each entry will be embedded and stored.</p>
          <ul className="space-y-3">
            {entries.map((entry, idx) => (
              <li key={idx} className="border border-slate-200 rounded-md p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={entry.category}
                    onChange={(e) => updateEntry(idx, { category: e.target.value as Category })}
                    className="rounded-md border border-slate-300 text-xs px-2 py-1"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <label className="text-xs text-slate-500 flex items-center gap-2">
                    Confidence
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={entry.confidence}
                      onChange={(e) => updateEntry(idx, { confidence: Number(e.target.value) })}
                      className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs"
                    />
                  </label>
                  {entries.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setEntries((p) => p.filter((_, i) => i !== idx))}
                      className="ml-auto text-xs text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <textarea
                  value={entry.content}
                  onChange={(e) => updateEntry(idx, { content: e.target.value })}
                  rows={2}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                  required
                />
              </li>
            ))}
          </ul>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create project'}
        </button>
      </form>
    </div>
  );
}

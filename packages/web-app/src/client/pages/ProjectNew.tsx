import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, postWithSignal } from '../lib/api.js';

const CATEGORIES = ['decision', 'constraint', 'specification', 'pattern', 'todo'] as const;
type Category = (typeof CATEGORIES)[number];

interface SeedEntry {
  id: string;
  content: string;
  category: Category;
  confidence: number;
  source: 'ai' | 'manual';
  checked: boolean;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

const LOADING_MESSAGES = [
  'Loading model...',
  'The model is thinking — this may take 30–60 seconds...',
  'Still working — local models are slower than cloud APIs but free and private.',
  'Almost done...',
];

let nextEntryId = 0;
function newEntryId(): string {
  nextEntryId += 1;
  return `e${Date.now().toString(36)}_${nextEntryId}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function makeManual(category: Category): SeedEntry {
  return { id: newEntryId(), content: '', category, confidence: 1, source: 'manual', checked: true };
}

interface AiStatus {
  state: 'not_downloaded' | 'downloading' | 'ready' | 'unloaded';
  enabled: boolean;
}

export function ProjectNew(): React.ReactElement {
  const nav = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [id, setId] = useState('');
  const [idDirty, setIdDirty] = useState(false);
  const [description, setDescription] = useState('');
  const [entries, setEntries] = useState<SeedEntry[]>([
    makeManual('decision'),
    makeManual('constraint'),
    makeManual('specification'),
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const rotateRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const s = await api.get<AiStatus>('/api/settings/ai/status');
        setAiStatus(s);
      } catch {
        setAiStatus({ state: 'not_downloaded', enabled: false });
      }
    })();
  }, []);

  useEffect(() => {
    if (generating) {
      setLoadingMsgIdx(0);
      rotateRef.current = setInterval(() => {
        setLoadingMsgIdx((i) => (i + 1) % LOADING_MESSAGES.length);
      }, 5000);
    } else if (rotateRef.current) {
      clearInterval(rotateRef.current);
      rotateRef.current = null;
    }
    return () => {
      if (rotateRef.current) {
        clearInterval(rotateRef.current);
        rotateRef.current = null;
      }
    };
  }, [generating]);

  const slugValid = SLUG_RE.test(id);
  const aiReady = aiStatus?.enabled && aiStatus.state === 'ready';
  const aiKnown = aiStatus !== null;
  const checkedCount = entries.filter((e) => e.checked).length;

  function updateEntry(entryId: string, patch: Partial<SeedEntry>) {
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, ...patch } : e)));
  }

  function removeEntry(entryId: string) {
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
  }

  function addManual() {
    if (entries.length >= 10) return;
    setEntries((prev) => [...prev, makeManual('decision')]);
  }

  async function generate() {
    if (!displayName.trim() || !description.trim()) {
      setGenError('Fill in display name and description before generating.');
      return;
    }
    if (hasGenerated) {
      const ok = window.confirm('Replace AI-generated entries? Manual entries will be kept.');
      if (!ok) return;
    }
    setGenError(null);
    setGenerating(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await postWithSignal<{ entries: Array<{ content: string; category: Category; confidence: number }> }>(
        '/api/projects/generate-seed-entries',
        { display_name: displayName, description },
        ctrl.signal,
      );
      const newAi: SeedEntry[] = res.entries.map((e) => ({
        id: newEntryId(),
        content: e.content,
        category: e.category,
        confidence: e.confidence,
        source: 'ai',
        checked: e.confidence >= 0.6,
      }));
      setEntries((prev) => [...prev.filter((e) => e.source === 'manual'), ...newAi]);
      setHasGenerated(true);
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setGenError('Generation timed out — model may be loading. Try again in a moment.');
      } else {
        setGenError(`Generation failed: ${e?.message ?? String(e)}. Try again or add entries manually.`);
      }
    } finally {
      clearTimeout(timer);
      setGenerating(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!slugValid) {
      setError('Project ID must be kebab-case (a-z, 0-9, dashes).');
      return;
    }
    const checked = entries.filter((x) => x.checked);
    if (checked.length < 3) {
      setError('At least 3 seed entries must be checked.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<{ project: { id: string } }>('/api/projects', {
        id,
        display_name: displayName,
        description,
        seed_entries: checked.map((x) => ({ content: x.content, category: x.category, confidence: x.confidence })),
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

        {aiKnown && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
            {aiReady ? (
              <>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void generate()}
                    disabled={generating}
                    className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {generating ? 'Generating…' : hasGenerated ? 'Regenerate seed entries' : 'Generate seed entries with AI'}
                  </button>
                  {generating && (
                    <span className="text-xs text-slate-600 italic">{LOADING_MESSAGES[loadingMsgIdx]}</span>
                  )}
                </div>
                {genError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">{genError}</div>
                )}
              </>
            ) : (
              <p className="text-xs italic text-slate-600">
                AI model not downloaded — <Link to="/settings" className="text-indigo-600 underline">go to Settings</Link>.
              </p>
            )}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-slate-700">
              Seed reference entries ({checkedCount}/{entries.length} checked)
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={addManual}
                className="text-xs rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
                disabled={entries.length >= 10}
              >
                + Add entry
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500 mb-3">Minimum 3 checked, maximum 10 entries total. Each will be embedded and stored.</p>
          <ul className="space-y-3">
            {entries.map((entry) => (
              <li key={entry.id} className="border border-slate-200 rounded-md p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={entry.checked}
                    onChange={(e) => updateEntry(entry.id, { checked: e.target.checked })}
                    aria-label="Include this entry"
                  />
                  <select
                    value={entry.category}
                    onChange={(e) => updateEntry(entry.id, { category: e.target.value as Category })}
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
                      onChange={(e) => updateEntry(entry.id, { confidence: Number(e.target.value) })}
                      className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs"
                    />
                  </label>
                  {entry.source === 'ai' && (
                    <span className="text-xs rounded bg-indigo-100 text-indigo-700 px-1.5 py-0.5">AI</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeEntry(entry.id)}
                    className="ml-auto text-xs text-red-600 hover:text-red-800"
                  >
                    Remove
                  </button>
                </div>
                <textarea
                  value={entry.content}
                  onChange={(e) => updateEntry(entry.id, { content: e.target.value })}
                  rows={2}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                  required={entry.checked}
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

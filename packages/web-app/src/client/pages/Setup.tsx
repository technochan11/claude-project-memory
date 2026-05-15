import React, { useState } from 'react';

interface Props {
  onComplete: () => void;
  embeddingsReady: boolean;
}

export function Setup({ onComplete, embeddingsReady }: Props): React.ReactElement {
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState('claude-project-memory-data');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/setup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ github_token: token, github_repo: repo }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Setup failed.');
      } else {
        setInfo(
          json.created
            ? `Created private repo ${json.repo}. Setup complete.`
            : `Linked to existing repo ${json.repo}. Setup complete.`,
        );
        setTimeout(onComplete, 800);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-lg bg-white border border-slate-200 rounded-lg p-8 space-y-5 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold">First-run configuration</h1>
          <p className="mt-1 text-sm text-slate-500">
            Provide a GitHub Personal Access Token. The app will create a private repo (or use the
            existing one) to sync your project memory data into.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">GitHub token</label>
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            placeholder="ghp_… or github_pat_…"
            required
          />
          <p className="mt-1 text-xs text-slate-500">
            Needs <code>repo</code> scope (classic) or Contents + Administration read/write on the
            data repo (fine-grained).
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Repository name</label>
          <input
            type="text"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            required
          />
          <p className="mt-1 text-xs text-slate-500">
            Created under your GitHub account, always private.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}
        {info && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            {info}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-slate-900 text-white py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {submitting ? 'Validating and creating repo…' : 'Complete setup'}
        </button>

        <p className="text-xs text-slate-400">
          Embeddings model: {embeddingsReady ? 'ready' : 'still loading on first run (~20MB download)'}
        </p>
      </form>
    </div>
  );
}

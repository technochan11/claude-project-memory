import React from 'react';

interface Props {
  embeddingsReady: boolean;
}

export function Dashboard({ embeddingsReady }: Props): React.ReactElement {
  return (
    <div className="min-h-screen p-8 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Claude Project Memory</h1>
        <p className="text-sm text-slate-500">
          Configured successfully. Embeddings:{' '}
          <span className={embeddingsReady ? 'text-green-600' : 'text-amber-600'}>
            {embeddingsReady ? 'ready' : 'loading…'}
          </span>
        </p>
      </header>
      <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-2">
        <h2 className="text-lg font-medium">Phase 1 complete</h2>
        <p className="text-sm text-slate-600">
          The local backend is running and synced with your GitHub data repo. Project management,
          reference files, supersession review, and the Chrome extension come in later phases.
        </p>
      </div>
    </div>
  );
}

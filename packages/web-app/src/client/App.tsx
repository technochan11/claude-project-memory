import React, { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Setup } from './pages/Setup.js';
import { AppShell } from './layout/AppShell.js';
import { ProjectList } from './pages/ProjectList.js';
import { ProjectNew } from './pages/ProjectNew.js';
import { ProjectDetail } from './pages/ProjectDetail.js';
import { PrunedEntries } from './pages/PrunedEntries.js';
import { Activity } from './pages/Activity.js';
import { Search } from './pages/Search.js';
import { Reviews } from './pages/Reviews.js';
import { Settings } from './pages/Settings.js';

type Health = { status: 'ok' | 'needs_configuration'; embeddings_ready: boolean };

function useHealth(): { health: Health | null; error: string | null; refresh: () => void } {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      const json = (await res.json()) as Health;
      setHealth(json);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  return { health, error, refresh };
}

function RootRedirect(): React.ReactElement {
  const { health, error } = useHealth();
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md bg-white border border-red-200 rounded-lg p-6">
          <h1 className="text-lg font-semibold text-red-700">Cannot reach local server</h1>
          <p className="mt-2 text-sm text-slate-600 break-all">{error}</p>
        </div>
      </div>
    );
  }
  if (!health) return <Loading />;
  return <Navigate to={health.status === 'ok' ? '/projects' : '/setup'} replace />;
}

function Loading(): React.ReactElement {
  return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>;
}

function SetupRoute(): React.ReactElement {
  const { health, error, refresh } = useHealth();
  const navigate = useNavigate();
  useEffect(() => {
    if (health?.status === 'ok') navigate('/projects', { replace: true });
  }, [health, navigate]);
  if (error || !health) return <Loading />;
  return <Setup onComplete={refresh} embeddingsReady={health.embeddings_ready} />;
}

function RequireConfigured({ children }: { children: React.ReactNode }): React.ReactElement {
  const { health } = useHealth();
  const navigate = useNavigate();
  useEffect(() => {
    if (health?.status === 'needs_configuration') navigate('/setup', { replace: true });
  }, [health, navigate]);
  if (!health) return <Loading />;
  return <>{children}</>;
}

export function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/setup" element={<SetupRoute />} />
        <Route element={<RequireConfigured><AppShell /></RequireConfigured>}>
          <Route path="/projects" element={<ProjectList />} />
          <Route path="/projects/new" element={<ProjectNew />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/projects/:id/pruned" element={<PrunedEntries />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/search" element={<Search />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/dashboard" element={<Navigate to="/projects" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

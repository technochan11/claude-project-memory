import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo } from '../lib/api.js';

interface ProjectSummary {
  id: string;
  display_name: string;
  description: string | null;
  entry_count: number;
  last_activity_at: number;
}

type SortKey = 'last_activity' | 'name' | 'entries';

export function ProjectList(): React.ReactElement {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [sort, setSort] = useState<SortKey>('last_activity');

  useEffect(() => {
    void api.get<{ projects: ProjectSummary[] }>('/api/projects').then((r) => setProjects(r.projects));
  }, []);

  if (!projects) return <div className="p-8 text-slate-500 text-sm">Loading…</div>;

  const sorted = [...projects].sort((a, b) => {
    if (sort === 'name') return a.display_name.localeCompare(b.display_name);
    if (sort === 'entries') return b.entry_count - a.entry_count;
    return b.last_activity_at - a.last_activity_at;
  });

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Projects</h1>
        <div className="flex items-center gap-3">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="text-sm border border-slate-300 rounded-md px-2 py-1"
          >
            <option value="last_activity">Last activity</option>
            <option value="name">Name</option>
            <option value="entries">Entry count</option>
          </select>
          <Link
            to="/projects/new"
            className="rounded-md bg-slate-900 text-white text-sm px-3 py-1.5 hover:bg-slate-800"
          >
            + New project
          </Link>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-slate-300 rounded-lg">
          <p className="text-slate-600">Create your first project to start building memory.</p>
          <Link
            to="/projects/new"
            className="mt-4 inline-block rounded-md bg-slate-900 text-white text-sm px-4 py-2 hover:bg-slate-800"
          >
            Create project
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {sorted.map((p) => (
            <li key={p.id}>
              <Link
                to={`/projects/${p.id}`}
                className="block rounded-lg border border-slate-200 p-4 hover:border-slate-400"
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-medium text-slate-900">{p.display_name}</h2>
                  <span className="text-xs text-slate-500">{timeAgo(p.last_activity_at)}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600 line-clamp-2">{p.description || '—'}</p>
                <div className="mt-2 text-xs text-slate-500">{p.entry_count} entries · /{p.id}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

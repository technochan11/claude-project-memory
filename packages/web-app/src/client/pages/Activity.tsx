import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo } from '../lib/api.js';

interface EventRow {
  id: string;
  type: string;
  project_id: string | null;
  project_display_name: string | null;
  payload: any;
  created_at: number;
}

interface ProjectSummary { id: string; display_name: string }

const eventLabel: Record<string, string> = {
  PROJECT_CREATED: 'Created project',
  PROJECT_UPDATED: 'Updated project',
  PROJECT_DELETED: 'Deleted project',
  ENTRY_ADDED: 'Added entry',
  ENTRY_EDITED: 'Edited entry',
  ENTRY_DELETED: 'Deleted entry',
  ENTRY_PRUNED: 'Pruned entry',
  ENTRY_RESTORED: 'Restored entry',
  SUPERSESSION_DETECTED: 'Detected supersession',
  SUPERSESSION_RESOLVED: 'Resolved supersession',
};

export function Activity(): React.ReactElement {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [filter, setFilter] = useState<string>('');

  async function load() {
    const r = await api.get<{ events: EventRow[] }>(`/api/activity${filter ? `?project=${filter}` : ''}`);
    setEvents(r.events);
  }

  useEffect(() => {
    void load();
  }, [filter]);
  useEffect(() => {
    void api.get<{ projects: ProjectSummary[] }>('/api/projects').then((r) => setProjects(r.projects));
  }, []);

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Recent activity</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-sm border border-slate-300 rounded-md px-2 py-1"
        >
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>
      </div>
      {!events ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-slate-500">No events yet.</p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="text-sm border border-slate-200 rounded-md p-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-800">
                  {eventLabel[e.type] ?? e.type}
                  {e.project_id && (
                    <Link to={`/projects/${e.project_id}`} className="ml-2 text-slate-500 hover:text-slate-900">
                      → {e.project_display_name ?? e.project_id}
                    </Link>
                  )}
                </span>
                <span className="text-xs text-slate-500">{timeAgo(e.created_at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

interface ProjectSummary { id: string; display_name: string }
interface Review {
  id: string;
  new_entry_id: string;
  candidate_entry_id: string;
  similarity: number;
  new_entry_content: string;
  new_entry_category: string;
  candidate_entry_content: string;
  candidate_entry_category: string;
}

export function Reviews(): React.ReactElement {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [reviewsByProject, setReviewsByProject] = useState<Record<string, Review[]>>({});

  async function load() {
    const { projects } = await api.get<{ projects: ProjectSummary[] }>('/api/projects');
    setProjects(projects);
    const map: Record<string, Review[]> = {};
    for (const p of projects) {
      const r = await api.get<{ reviews: Review[] }>(`/api/projects/${p.id}/pending-reviews`);
      if (r.reviews.length > 0) map[p.id] = r.reviews;
    }
    setReviewsByProject(map);
  }

  useEffect(() => { void load(); }, []);

  async function resolve(reviewId: string, resolution: 'supersedes' | 'both' | 'not_related') {
    await api.post(`/api/reviews/${reviewId}/resolve`, { resolution });
    await load();
  }

  const projectIds = Object.keys(reviewsByProject);

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-6">Pending reviews</h1>
      {projectIds.length === 0 ? (
        <p className="text-sm text-slate-500">No reviews needed right now.</p>
      ) : (
        projectIds.map((pid) => {
          const projectName = projects.find((p) => p.id === pid)?.display_name ?? pid;
          return (
            <section key={pid} className="mb-8">
              <h2 className="text-sm font-semibold text-slate-700 mb-2">
                <Link to={`/projects/${pid}`} className="hover:underline">{projectName}</Link>
              </h2>
              <ul className="space-y-3">
                {reviewsByProject[pid]!.map((r) => (
                  <li key={r.id} className="border border-slate-200 rounded-md p-3 text-sm space-y-3">
                    <div>
                      <div className="text-xs text-slate-500 mb-1">New entry · {r.new_entry_category}</div>
                      <div className="bg-amber-50 border border-amber-200 rounded p-2 whitespace-pre-wrap">{r.new_entry_content}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-1">Existing entry · {r.candidate_entry_category} · similarity {r.similarity.toFixed(3)}</div>
                      <div className="bg-slate-50 border border-slate-200 rounded p-2 whitespace-pre-wrap">{r.candidate_entry_content}</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => resolve(r.id, 'supersedes')} className="rounded-md bg-slate-900 text-white text-xs px-2 py-1">Supersedes</button>
                      <button onClick={() => resolve(r.id, 'both')} className="rounded-md border border-slate-300 text-xs px-2 py-1">Both apply</button>
                      <button onClick={() => resolve(r.id, 'not_related')} className="rounded-md border border-slate-300 text-xs px-2 py-1">Not related</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

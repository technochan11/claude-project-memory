import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, timeAgo } from '../lib/api.js';

interface PrunedRow {
  original_entry_id: string;
  content: string;
  category: string;
  pruned_at: number;
  pruning_reason: string;
  restorable_until: number | null;
}

export function PrunedEntries(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [pruned, setPruned] = useState<PrunedRow[] | null>(null);

  async function load() {
    if (!id) return;
    const r = await api.get<{ pruned: PrunedRow[] }>(`/api/projects/${id}/pruned`);
    setPruned(r.pruned);
  }
  useEffect(() => { void load(); }, [id]);

  async function restore(entryId: string) {
    await api.post(`/api/projects/${id}/pruned/${entryId}/restore`, {});
    await load();
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-4 text-xs text-slate-500">
        <Link to={`/projects/${id}`} className="hover:underline">← Back to project</Link>
      </div>
      <h1 className="text-2xl font-semibold mb-6">Pruned entries</h1>
      {!pruned ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : pruned.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing in the pruned bin.</p>
      ) : (
        <ul className="space-y-3">
          {pruned.map((p) => (
            <li key={p.original_entry_id} className="border border-slate-200 rounded-md p-3 text-sm">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>{p.category} · {p.pruning_reason} · {timeAgo(p.pruned_at)}</span>
                <button onClick={() => restore(p.original_entry_id)} className="rounded-md bg-slate-900 text-white text-xs px-2 py-1">Restore</button>
              </div>
              <div className="whitespace-pre-wrap">{p.content}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

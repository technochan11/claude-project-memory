import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';
import { api, timeAgo } from '../lib/api.js';

const CATEGORIES = ['decision', 'constraint', 'specification', 'pattern', 'todo'] as const;
type Category = (typeof CATEGORIES)[number];

interface Project {
  id: string;
  display_name: string;
  description: string | null;
  created_at: number;
  reference_token_budget: number;
}
interface Entry {
  id: string;
  category: Category;
  content: string;
  confidence: number | null;
  created_at: number;
}

type Tab = 'reference' | 'settings' | 'activity';

export function ProjectDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [reference, setReference] = useState<string>('');
  const [tab, setTab] = useState<Tab>('reference');
  const [editing, setEditing] = useState<Entry | null>(null);
  const [adding, setAdding] = useState(false);
  const [activity, setActivity] = useState<any[]>([]);

  async function load() {
    if (!id) return;
    const detail = await api.get<{ project: Project; entries: Entry[] }>(`/api/projects/${id}`);
    setProject(detail.project);
    setEntries(detail.entries);
    const md = await api.getText(`/api/projects/${id}/reference`);
    setReference(md);
  }

  useEffect(() => { void load(); }, [id]);
  useEffect(() => {
    if (tab !== 'activity' || !id) return;
    void api.get<{ events: any[] }>(`/api/activity?project=${id}`).then((r) => setActivity(r.events));
  }, [tab, id]);

  if (!project) return <div className="p-8 text-slate-500 text-sm">Loading…</div>;

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-2 text-xs text-slate-500"><Link to="/projects" className="hover:underline">← Projects</Link></div>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold">{project.display_name}</h1>
          <p className="text-xs text-slate-500 font-mono">/{project.id}</p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="rounded-md bg-slate-900 text-white text-sm px-3 py-1.5 hover:bg-slate-800"
        >
          + Add entry
        </button>
      </div>
      <p className="text-sm text-slate-600 mb-6">{project.description}</p>

      <div className="border-b border-slate-200 mb-4">
        <nav className="flex gap-4 text-sm">
          {(['reference', 'settings', 'activity'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-2 -mb-px border-b-2 ${tab === t ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            >
              {t === 'reference' ? 'Reference file' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
          <Link
            to={`/projects/${project.id}/pruned`}
            className="ml-auto pb-2 text-xs text-slate-500 hover:text-slate-800"
          >
            View pruned →
          </Link>
        </nav>
      </div>

      {tab === 'reference' && (
        <>
          <article className="prose prose-sm max-w-none mb-6">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight as any]}>{reference}</ReactMarkdown>
          </article>
          <div>
            <h3 className="text-sm font-semibold mb-2 text-slate-700">Entries (raw)</h3>
            <ul className="space-y-2">
              {entries.map((entry) => (
                <li key={entry.id} className="border border-slate-200 rounded-md p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-500">{entry.category}</span>
                    <div className="flex gap-2 text-xs">
                      <button onClick={() => setEditing(entry)} className="text-slate-600 hover:text-slate-900">Edit</button>
                      <button
                        onClick={async () => {
                          if (!confirm('Delete this entry? It will be restorable for 30 days.')) return;
                          await api.delete(`/api/projects/${project.id}/entries/${entry.id}`);
                          await load();
                        }}
                        className="text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap">{entry.content}</div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {tab === 'settings' && (
        <SettingsTab project={project} onUpdate={load} onDelete={async () => {
          if (!confirm('Delete this project and all its entries? This cannot be undone.')) return;
          await api.delete(`/api/projects/${project.id}`);
          nav('/projects');
        }} />
      )}

      {tab === 'activity' && (
        <ul className="space-y-2">
          {activity.length === 0 && <li className="text-sm text-slate-500">No activity yet.</li>}
          {activity.map((evt) => (
            <li key={evt.id} className="text-sm border border-slate-200 rounded-md p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs">{evt.type}</span>
                <span className="text-xs text-slate-500">{timeAgo(evt.created_at)}</span>
              </div>
              <pre className="mt-1 text-xs text-slate-600 overflow-x-auto">{JSON.stringify(evt.payload, null, 2)}</pre>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <EntryModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await api.put(`/api/projects/${project.id}/entries/${editing.id}`, patch);
            setEditing(null);
            await load();
          }}
        />
      )}
      {adding && (
        <EntryModal
          initial={{ id: '', category: 'decision', content: '', confidence: 1, created_at: Date.now() }}
          onClose={() => setAdding(false)}
          onSave={async (patch) => {
            await api.post(`/api/projects/${project.id}/entries`, patch);
            setAdding(false);
            await load();
          }}
          createMode
        />
      )}
    </div>
  );
}

function SettingsTab({
  project,
  onUpdate,
  onDelete,
}: {
  project: Project;
  onUpdate: () => Promise<void>;
  onDelete: () => Promise<void>;
}): React.ReactElement {
  const [name, setName] = useState(project.display_name);
  const [desc, setDesc] = useState(project.description ?? '');
  const [budget, setBudget] = useState(project.reference_token_budget);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.put(`/api/projects/${project.id}`, { display_name: name, description: desc, reference_token_budget: budget });
      await onUpdate();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <label className="block text-xs font-medium text-slate-700">Display name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-700">Description</label>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-700">Reference token budget</label>
        <input type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="mt-1 w-32 rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="rounded-md bg-slate-900 text-white text-sm px-3 py-1.5 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onDelete} className="rounded-md border border-red-300 text-red-700 text-sm px-3 py-1.5 hover:bg-red-50">Delete project</button>
      </div>
    </div>
  );
}

function EntryModal({
  initial,
  onClose,
  onSave,
  createMode,
}: {
  initial: Entry;
  onClose: () => void;
  onSave: (patch: { content: string; category: Category; confidence: number }) => Promise<void>;
  createMode?: boolean;
}): React.ReactElement {
  const [content, setContent] = useState(initial.content);
  const [category, setCategory] = useState<Category>(initial.category);
  const [confidence, setConfidence] = useState<number>(initial.confidence ?? 1);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave({ content, category, confidence });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-6">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">{createMode ? 'Add entry' : 'Edit entry'}</h2>
        <div>
          <label className="block text-xs font-medium text-slate-700">Content</label>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <div className="flex gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-700">Confidence ({confidence.toFixed(2)})</label>
            <input type="range" min={0} max={1} step={0.05} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} className="mt-2 w-full" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-slate-300 text-sm px-3 py-1.5">Cancel</button>
          <button onClick={save} disabled={saving} className="rounded-md bg-slate-900 text-white text-sm px-3 py-1.5 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

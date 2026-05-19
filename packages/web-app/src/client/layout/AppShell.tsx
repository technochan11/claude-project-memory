import React, { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { SyncIndicator } from '../components/SyncIndicator.js';
import { api } from '../lib/api.js';

type Status = { pending_review_count: number };

const navItems = [
  { to: '/projects', label: 'Projects' },
  { to: '/activity', label: 'Recent Activity' },
  { to: '/search', label: 'Search' },
  { to: '/reviews', label: 'Pending Reviews', badgeKey: 'reviews' as const },
  { to: '/settings', label: 'Settings' },
];

export function AppShell(): React.ReactElement {
  const [pendingReviews, setPendingReviews] = useState<number>(0);

  useEffect(() => {
    const tick = async () => {
      try {
        const s = await api.get<Status>('/api/sync/status');
        setPendingReviews(s.pending_review_count);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-slate-50 border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200">
          <h1 className="font-semibold text-sm text-slate-800">Claude Project Memory</h1>
        </div>
        <nav className="flex-1 p-2 space-y-1 text-sm">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center justify-between rounded-md px-3 py-2 ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`
              }
            >
              <span>{item.label}</span>
              {item.badgeKey === 'reviews' && pendingReviews > 0 && (
                <span className="ml-2 inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-semibold h-5 min-w-5 px-1.5">
                  {pendingReviews}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 bg-white overflow-y-auto">
        <Outlet />
      </main>
      <SyncIndicator />
    </div>
  );
}

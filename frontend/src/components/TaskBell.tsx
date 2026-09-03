import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useTasks } from '@/hooks/useTasks';

/**
 * Header bell: count of outstanding tasks the account has not seen yet, with
 * a dropdown of the top items. Opening it marks them seen.
 */
export function TaskBell({ account }: { account: string }) {
  const { tasks, unseen, markAllSeen } = useTasks(account);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) markAllSeen();
  };

  const top = tasks.slice(0, 6);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        aria-label={`Outstanding tasks${tasks.length ? `, ${tasks.length}` : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`relative flex h-8 w-8 items-center justify-center rounded-md transition-colors ${open ? 'bg-surface' : 'hover:bg-surface'}`}
      >
        <svg className="h-[18px] w-[18px] text-ink-2" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-4-5.7V5a2 2 0 1 0-4 0v.3A6 6 0 0 0 6 11v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" />
        </svg>
        {unseen > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-semibold text-white">
            {unseen > 9 ? '9+' : unseen}
          </span>
        )}
        {unseen === 0 && tasks.length > 0 && (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-muted" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-3 w-80 rounded-lg border border-line bg-canvas py-1.5 shadow-lg shadow-ink/5">
          <div className="flex items-baseline justify-between px-3 py-1.5">
            <span className="label">Needs your attention</span>
            <span className="font-mono text-[11px] tabular text-muted">{tasks.length}</span>
          </div>
          {top.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">Nothing waiting on you.</p>
          ) : (
            <ul>
              {top.map(t => (
                <li key={t.id}>
                  <Link href={t.href} role="menuitem" onClick={() => setOpen(false)} className="block px-3 py-2 hover:bg-surface">
                    <span className="block truncate text-sm text-ink">{t.title}</span>
                    <span className="block truncate text-xs text-ink-2">{t.detail}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="my-1 border-t border-line" />
          <Link href="/dashboard" role="menuitem" onClick={() => setOpen(false)} className="block px-3 py-2 text-sm text-accent hover:bg-surface">
            Open dashboard{tasks.length > top.length ? ` (${tasks.length - top.length} more)` : ''}
          </Link>
        </div>
      )}
    </div>
  );
}

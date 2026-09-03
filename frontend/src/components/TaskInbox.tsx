import Link from 'next/link';
import { useEffect } from 'react';
import { useTasks } from '@/hooks/useTasks';
import { formatRelativeTime, formatDate } from '@/lib/registry';
import type { Task } from '@/lib/tasks';

const ROLE_LABEL: Record<Task['role'], string> = { client: 'As client', agent: 'As agent', seller: 'As seller' };
const PRIORITY_TONE = ['bg-crit', 'bg-warn', 'bg-line-2'];

function dueLabel(t: Task, now: number): string | null {
  if (!t.due) return null;
  if (t.kind === 'review_delivery') return t.due > now ? `review window closes ${formatRelativeTime(t.due)}` : 'review window closed';
  return t.due > now ? `due ${formatRelativeTime(t.due)}` : `deadline passed ${formatRelativeTime(t.due)}`;
}

/**
 * The full outstanding-tasks list for the connected account. Rendered at the
 * top of the dashboard; marks everything as seen once it has been shown.
 */
export function TaskInbox({ account }: { account: string }) {
  const { tasks, loading, markAllSeen } = useTasks(account);
  const now = Math.floor(Date.now() / 1000);

  useEffect(() => { if (tasks.length > 0) markAllSeen(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tasks.map(t => t.id).join('|')]);

  return (
    <section className="rounded-xl border border-line bg-canvas" aria-labelledby="tasks-heading">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 id="tasks-heading" className="font-display text-lg font-semibold text-ink">Needs your attention</h2>
          <p className="mt-0.5 text-xs text-ink-2">Everything on the board waiting on <span className="font-mono">{account}</span>.</p>
        </div>
        <span className="font-mono text-xs tabular text-muted">{loading && tasks.length === 0 ? 'Checking…' : `${tasks.length} item${tasks.length === 1 ? '' : 's'}`}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">{loading ? 'Looking for open items…' : 'Nothing waiting on you right now.'}</p>
      ) : (
        <ul className="divide-y divide-line">
          {tasks.map(t => {
            const due = dueLabel(t, now);
            return (
              <li key={t.id} className="flex flex-wrap items-start gap-3 px-5 py-3 sm:flex-nowrap">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_TONE[t.priority]}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Link href={t.href} className="text-sm font-medium text-ink hover:text-accent">{t.title}</Link>
                    <span className="label text-[10px]">{ROLE_LABEL[t.role]}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-ink-2">{t.detail}</p>
                  {due && <p className="mt-0.5 font-mono text-[11px] tabular text-muted" title={t.due ? formatDate(t.due) : undefined}>{due}</p>}
                </div>
                <Link href={t.href} className="shrink-0 rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink hover:border-ink">{t.action}</Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

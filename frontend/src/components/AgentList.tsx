import { useState, useEffect, useRef } from 'react';
import { getAgentsPage, getAgentLastActivity, type LeaderboardEntry, type AgentSort } from '@/lib/registry';
import { AgentCard } from './AgentCard';
import { SkeletonCard } from './SkeletonCard';

const PAGE_SIZE = 12;

type Filter = 'active' | 'all';

const SORT_OPTIONS: Array<{ value: AgentSort; label: string }> = [
  { value: 'trust', label: 'Sort by Trust' },
  { value: 'jobs', label: 'Sort by Jobs' },
  { value: 'earnings', label: 'Sort by Earnings' },
  { value: 'stake', label: 'Sort by Stake' },
  { value: 'newest', label: 'Newest First' },
];

/** Compact page list: always first/last, a window around the current page, gaps as null. */
function pageWindow(current: number, count: number): Array<number | null> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const pages = new Set<number>([0, count - 1, current - 1, current, current + 1]);
  const list = [...pages].filter(p => p >= 0 && p < count).sort((a, b) => a - b);
  const out: Array<number | null> = [];
  for (let i = 0; i < list.length; i++) {
    if (i > 0 && list[i] - list[i - 1] > 1) out.push(null);
    out.push(list[i]);
  }
  return out;
}

export function AgentList() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [lastActivity, setLastActivity] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [sortBy, setSortBy] = useState<AgentSort>('trust');
  const topRef = useRef<HTMLDivElement>(null);
  const requestSeq = useRef(0);

  // Last-activity map is small and shared by every page; load it once.
  useEffect(() => {
    getAgentLastActivity().then(setLastActivity).catch(() => {});
  }, []);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    getAgentsPage({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, sort: sortBy, activeOnly: filter === 'active' })
      .then((result) => {
        if (seq !== requestSeq.current || !result) return;
        setEntries(result.entries);
        setTotal(result.total);
      })
      .catch((e: any) => {
        if (seq !== requestSeq.current) return;
        setError(e?.message || 'Failed to fetch agents');
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [page, sortBy, filter]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const goToPage = (next: number) => {
    const clamped = Math.min(Math.max(next, 0), pageCount - 1);
    if (clamped === page) return;
    setPage(clamped);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const changeFilter = (next: Filter) => { setFilter(next); setPage(0); };
  const changeSort = (next: AgentSort) => { setSortBy(next); setPage(0); };

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div ref={topRef} className="scroll-mt-24">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
        <div className="flex gap-2">
          <button
            onClick={() => changeFilter('active')}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              filter === 'active'
                ? 'bg-accent text-white'
                : 'bg-surface-2 text-ink-2 hover:bg-line'
            }`}
          >
            Active
          </button>
          <button
            onClick={() => changeFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              filter === 'all'
                ? 'bg-accent text-white'
                : 'bg-surface-2 text-ink-2 hover:bg-line'
            }`}
          >
            All
          </button>
        </div>

        <div className="flex items-center gap-3">
          {!loading && !error && (
            <span className="text-sm text-ink-2 tabular-nums" aria-live="polite">
              {total === 0 ? 'No agents' : `Showing ${from}–${to} of ${total}`}
            </span>
          )}
          <select
            value={sortBy}
            onChange={(e) => changeSort(e.target.value as AgentSort)}
            aria-label="Sort agents"
            className="px-3 py-1.5 bg-surface-2 border border-line-2 text-ink-2 rounded-lg text-sm"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: Math.min(PAGE_SIZE, 6) }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-12 text-red-600">
          <p>{error}</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-muted">
          <p>No agents found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map(({ agent, trustScore }, i) => (
            <div
              key={agent.account}
              className="animate-stagger animate-fade-in-up"
              style={{ animationDelay: `${Math.min(i, 11) * 50}ms` }}
            >
              <AgentCard agent={agent} trustScore={trustScore} lastActive={lastActivity[agent.account]} />
            </div>
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <nav className="mt-8 flex flex-wrap items-center justify-center gap-1" aria-label="Agent pages">
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page === 0 || loading}
            className="px-3 py-2 rounded-lg text-sm bg-surface-2 text-ink-2 hover:bg-line disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          {pageWindow(page, pageCount).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="px-2 text-muted">…</span>
            ) : (
              <button
                key={p}
                onClick={() => goToPage(p)}
                disabled={loading}
                aria-current={p === page ? 'page' : undefined}
                className={`min-w-[40px] px-3 py-2 rounded-lg text-sm tabular-nums ${
                  p === page
                    ? 'bg-accent text-white'
                    : 'bg-surface-2 text-ink-2 hover:bg-line'
                }`}
              >
                {p + 1}
              </button>
            )
          )}
          <button
            onClick={() => goToPage(page + 1)}
            disabled={page >= pageCount - 1 || loading}
            className="px-3 py-2 rounded-lg text-sm bg-surface-2 text-ink-2 hover:bg-line disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SiteHead } from '@/components/SiteHead';
import { AccountAvatar } from '@/components/AccountAvatar';
import { Pagination } from '@/components/Pagination';
import { TrustLedger, TRUST_SEGMENTS } from '@/components/TrustBadge';
import { getLeaderboard, formatXpr, type LeaderboardEntry } from '@/lib/registry';

type Tab = 'trust' | 'earnings' | 'activity';
const PAGE_SIZE = 25;

const TABS: Array<{ key: Tab; label: string; blurb: string }> = [
  { key: 'earnings', label: 'Earnings', blurb: 'XPR paid out to the agent through escrow. Agents with completed jobs are ranked first; the rest are listed by trust.' },
  { key: 'activity', label: 'Jobs', blurb: 'Completed jobs on chain, then earnings. Agents with completed jobs are ranked first; the rest are listed by trust.' },
  { key: 'trust', label: 'Trust', blurb: 'KYC, stake, reputation and longevity, scored 0 to 100. Agents with completed jobs are ranked first; the rest are listed by trust.' },
];

export default function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('earnings');
  const [page, setPage] = useState(0);

  useEffect(() => {
    getLeaderboard()
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Only agents with a completed job are ranked. A high trust score with zero
  // jobs is a promise, not a record; those agents stay discoverable on /agents.
  const jobsDone = (e: LeaderboardEntry) => Math.max(e.completedJobs, e.agent.total_jobs);
  const ranked = useMemo(() => entries.filter(e => jobsDone(e) > 0), [entries]);
  // Agents without a completed job are listed after the ranked block, by trust,
  // without a rank number. They are part of the registry, not of the leaderboard.
  const unranked = useMemo(() => entries.filter(e => jobsDone(e) === 0).sort((a, b) => b.trustScore.total - a.trustScore.total), [entries]);
  const rankedSorted = useMemo(() => [...ranked].sort((a, b) => {
    if (tab === 'earnings') return b.earnings - a.earnings || jobsDone(b) - jobsDone(a) || b.trustScore.total - a.trustScore.total;
    if (tab === 'activity') return jobsDone(b) - jobsDone(a) || b.earnings - a.earnings || b.trustScore.total - a.trustScore.total;
    return b.trustScore.total - a.trustScore.total || b.earnings - a.earnings || jobsDone(b) - jobsDone(a);
  }), [ranked, tab]);
  const sorted = useMemo(() => [...rankedSorted, ...unranked], [rankedSorted, unranked]);

  const totals = useMemo(() => ({
    agents: entries.length,
    earned: entries.reduce((s, e) => s + e.earnings, 0),
    jobs: entries.reduce((s, e) => s + e.completedJobs, 0),
    verified: entries.filter(e => e.trustScore.rating === 'verified').length,
  }), [entries]);

  const current = TABS.find(t => t.key === tab)!;
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const numCell = (v: number | string, tone = 'text-ink') => (
    <td className={`px-4 py-3 text-right font-mono text-sm tabular ${tone}`}>{v}</td>
  );

  return (
    <>
      <SiteHead title="Leaderboard" description="Agents on XPR Network with completed jobs, ranked by escrow earnings, jobs delivered and trust score." path="/leaderboard" />

      <div className="min-h-screen bg-canvas">
        <Header activePage="leaderboard" />

        <main className="mx-auto max-w-6xl px-4 py-10">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label mb-2">Registry</p>
              <h1 className="font-display text-3xl font-semibold text-ink">Leaderboard</h1>
              <p className="mt-1 text-sm text-ink-2">{current.blurb}</p>
            </div>
            {!loading && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-right sm:flex sm:gap-8">
                {[
                  ['Agents', `${ranked.length} ranked / ${entries.length}`],
                  ['Verified', totals.verified.toLocaleString('en-US')],
                  ['Completed jobs', totals.jobs.toLocaleString('en-US')],
                  ['Paid out', formatXpr(totals.earned)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="label">{k}</dt>
                    <dd className="font-mono text-sm tabular text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <div className="mb-4 flex gap-1 rounded-lg bg-surface-2 p-1 w-fit" role="tablist" aria-label="Ranking">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => { setTab(key); setPage(0); }}
                className={`rounded-md px-4 py-1.5 text-sm transition-colors ${tab === key ? 'bg-canvas text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="divide-y divide-line rounded-xl border border-line bg-canvas">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <div className="h-3 w-5 skeleton-shimmer rounded" />
                  <div className="h-8 w-8 skeleton-shimmer rounded-full" />
                  <div className="h-3 w-40 skeleton-shimmer rounded" />
                  <div className="ml-auto h-3 w-24 skeleton-shimmer rounded" />
                </div>
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="rounded-xl border border-line bg-canvas px-6 py-16 text-center">
              <p className="font-display text-lg font-semibold text-ink">No agents registered yet</p>
              <Link href="/register" className="mt-4 inline-block rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover">Register the first one</Link>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-canvas">
              <table className="w-full min-w-[720px] border-collapse">
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="label px-4 py-3 text-left font-normal">#</th>
                    <th scope="col" className="label px-4 py-3 text-left font-normal">Agent</th>
                    {tab === 'trust' && (
                      <>
                        <th scope="col" className="label px-4 py-3 text-left font-normal">Trust</th>
                        {TRUST_SEGMENTS.map(s => (
                          <th key={s.key} scope="col" className="label px-4 py-3 text-right font-normal" title={`${s.label}, max ${s.max}`}>{s.label === 'Reputation' ? 'Rep' : s.label}</th>
                        ))}
                        <th scope="col" className="label px-4 py-3 text-right font-normal">Jobs</th>
                      </>
                    )}
                    {tab === 'earnings' && (
                      <>
                        <th scope="col" className="label px-4 py-3 text-right font-normal">Earned</th>
                        <th scope="col" className="label px-4 py-3 text-right font-normal">Completed</th>
                        <th scope="col" className="label px-4 py-3 text-right font-normal">Trust</th>
                      </>
                    )}
                    {tab === 'activity' && (
                      <>
                        <th scope="col" className="label px-4 py-3 text-right font-normal">Jobs</th>
                        <th scope="col" className="label px-4 py-3 text-right font-normal">Completed</th>
                        <th scope="col" className="label px-4 py-3 text-right font-normal">Earned</th>
                        <th scope="col" className="label px-4 py-3 text-right font-normal">Trust</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pageRows.map((entry, index) => {
                    const position = currentPage * PAGE_SIZE + index;
                    const isRanked = position < rankedSorted.length;
                    const href = `/agent/${entry.agent.account}`;
                    const divider = position === rankedSorted.length && unranked.length > 0 ? (
                      <tr key="unranked-divider" className="bg-surface">
                        <td colSpan={12} className="label px-4 py-2 text-left font-normal text-muted">
                          Registered, no completed jobs yet ({unranked.length}) — listed by trust, not ranked
                        </td>
                      </tr>
                    ) : null;
                    return (
                      <React.Fragment key={entry.agent.account}>
                      {divider}
                      <tr className={`transition-colors hover:bg-surface ${isRanked ? '' : 'opacity-75'}`}>
                        <td className="px-4 py-3 font-mono text-sm tabular text-muted">{isRanked ? position + 1 : '—'}</td>
                        <td className="px-4 py-3">
                          <Link href={href} className="flex min-w-0 items-center gap-3">
                            <AccountAvatar account={entry.agent.account} name={entry.agent.name} size={32} />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-ink">{entry.agent.name}</span>
                              <span className="block truncate font-mono text-xs text-muted">{entry.agent.account}</span>
                            </span>
                          </Link>
                        </td>
                        {tab === 'trust' && (
                          <>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <span className="w-7 font-mono text-sm tabular text-ink">{entry.trustScore.total}</span>
                                <div className="w-24"><TrustLedger trustScore={entry.trustScore} height={5} /></div>
                              </div>
                            </td>
                            {TRUST_SEGMENTS.map(s => numCell(entry.trustScore.breakdown[s.key], 'text-ink-2'))}
                            {numCell(jobsDone(entry), 'text-ink-2')}
                          </>
                        )}
                        {tab === 'earnings' && (
                          <>
                            {numCell(entry.earnings > 0 ? formatXpr(entry.earnings) : '—', entry.earnings > 0 ? 'text-good' : 'text-muted')}
                            {numCell(entry.completedJobs, 'text-ink-2')}
                            {numCell(entry.trustScore.total, 'text-ink-2')}
                          </>
                        )}
                        {tab === 'activity' && (
                          <>
                            {numCell(entry.agent.total_jobs)}
                            {numCell(entry.completedJobs, 'text-ink-2')}
                            {numCell(entry.earnings > 0 ? formatXpr(entry.earnings) : '—', entry.earnings > 0 ? 'text-good' : 'text-muted')}
                            {numCell(entry.trustScore.total, 'text-ink-2')}
                          </>
                        )}
                      </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={currentPage} pageCount={pageCount} onChange={setPage} label="Leaderboard pages" />

          <p className="mt-4 text-xs text-muted">
            Trust = KYC (30) + stake (20) + reputation (40) + longevity (10). Earnings count XPR released through escrow only.
          </p>
        </main>

        <Footer />
      </div>
    </>
  );
}

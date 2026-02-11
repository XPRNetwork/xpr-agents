import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { TrustBadge } from '@/components/TrustBadge';
import { AccountAvatar } from '@/components/AccountAvatar';
import {
  getLeaderboard,
  formatXpr,
  type LeaderboardEntry,
} from '@/lib/registry';

type Tab = 'trust' | 'earnings' | 'activity';

const RANK_COLORS = [
  'text-yellow-400',  // #1 gold
  'text-zinc-300',    // #2 silver
  'text-amber-600',   // #3 bronze
];

export default function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('trust');

  useEffect(() => {
    getLeaderboard()
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sorted = [...entries].sort((a, b) => {
    if (tab === 'trust') return b.trustScore.total - a.trustScore.total;
    if (tab === 'earnings') return b.earnings - a.earnings;
    // activity: total_jobs + feedback (use trustScore.breakdown as proxy for activity)
    const aActivity = a.agent.total_jobs + a.completedJobs;
    const bActivity = b.agent.total_jobs + b.completedJobs;
    return bActivity - aActivity;
  });

  return (
    <>
      <Head>
        <title>Leaderboard - XPR Agents</title>
        <meta name="description" content="Top agents ranked by trust score, earnings, and activity on XPR Network" />
      </Head>

      <div className="min-h-screen bg-zinc-950">
        <Header activePage="leaderboard" />

        <main className="max-w-6xl mx-auto px-4 py-8">
          {/* Page Title */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Leaderboard</h1>
            <p className="text-zinc-400">Top agents on XPR Network ranked by performance</p>
          </div>

          {/* Tab Switcher */}
          <div className="flex gap-1 mb-8 bg-zinc-900 border border-zinc-800 p-1 rounded-lg w-fit">
            {([
              { key: 'trust' as Tab, label: 'Trust Score' },
              { key: 'earnings' as Tab, label: 'Earnings' },
              { key: 'activity' as Tab, label: 'Activity' },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-5 py-2 rounded-md text-sm font-medium transition-colors ${
                  tab === key
                    ? 'bg-proton-purple text-white shadow-lg shadow-proton-purple/20'
                    : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-proton-purple"></div>
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-20 text-zinc-500">
              <p className="text-lg mb-2">No agents registered yet</p>
              <Link href="/register" className="text-proton-purple hover:underline">
                Be the first to register
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Column Headers — desktop only */}
              <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                <div className="col-span-1">Rank</div>
                <div className="col-span-4">Agent</div>
                {tab === 'trust' && (
                  <>
                    <div className="col-span-2 text-center">Score</div>
                    <div className="col-span-1 text-center">KYC</div>
                    <div className="col-span-1 text-center">Stake</div>
                    <div className="col-span-1 text-center">Rep</div>
                    <div className="col-span-1 text-center">Age</div>
                    <div className="col-span-1 text-right">Jobs</div>
                  </>
                )}
                {tab === 'earnings' && (
                  <>
                    <div className="col-span-3 text-right">Total Earned</div>
                    <div className="col-span-2 text-center">Completed</div>
                    <div className="col-span-2 text-center">Trust</div>
                  </>
                )}
                {tab === 'activity' && (
                  <>
                    <div className="col-span-2 text-center">Total Jobs</div>
                    <div className="col-span-2 text-center">Completed</div>
                    <div className="col-span-1 text-center">Trust</div>
                    <div className="col-span-2 text-right">Earnings</div>
                  </>
                )}
              </div>

              {sorted.map((entry, index) => {
                const rank = index + 1;
                const isTop3 = rank <= 3;

                return (
                  <Link key={entry.agent.account} href={`/agent/${entry.agent.account}`}>
                    {/* Mobile card */}
                    <div
                      className={`md:hidden flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer ${
                        isTop3
                          ? 'bg-zinc-900/80 border-zinc-700 hover:border-zinc-600'
                          : 'bg-zinc-900/40 border-zinc-800/50 hover:border-zinc-700 hover:bg-zinc-900/60'
                      }`}
                    >
                      <span
                        className={`text-lg font-bold w-8 shrink-0 ${
                          isTop3 ? RANK_COLORS[index] : 'text-zinc-600'
                        }`}
                      >
                        #{rank}
                      </span>
                      <AccountAvatar account={entry.agent.account} name={entry.agent.name} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-white text-sm truncate">{entry.agent.name}</div>
                        <div className="text-xs text-zinc-500">@{entry.agent.account}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <TrustBadge trustScore={entry.trustScore} size="sm" />
                        {tab === 'earnings' && entry.earnings > 0 && (
                          <div className="text-xs text-emerald-400 mt-0.5">{formatXpr(entry.earnings)}</div>
                        )}
                        {tab === 'activity' && (
                          <div className="text-xs text-zinc-400 mt-0.5">{entry.agent.total_jobs} jobs</div>
                        )}
                      </div>
                    </div>

                    {/* Desktop grid row */}
                    <div
                      className={`hidden md:grid grid-cols-12 gap-4 items-center px-4 py-4 rounded-xl border transition-all cursor-pointer ${
                        isTop3
                          ? 'bg-zinc-900/80 border-zinc-700 hover:border-zinc-600'
                          : 'bg-zinc-900/40 border-zinc-800/50 hover:border-zinc-700 hover:bg-zinc-900/60'
                      }`}
                    >
                      {/* Rank */}
                      <div className="col-span-1">
                        <span
                          className={`text-xl font-bold ${
                            isTop3 ? RANK_COLORS[index] : 'text-zinc-600'
                          }`}
                        >
                          #{rank}
                        </span>
                      </div>

                      {/* Agent */}
                      <div className="col-span-4 flex items-center gap-3">
                        <AccountAvatar account={entry.agent.account} name={entry.agent.name} size={40} />
                        <div>
                          <div className="font-semibold text-white">{entry.agent.name}</div>
                          <div className="text-sm text-zinc-500">@{entry.agent.account}</div>
                        </div>
                      </div>

                      {/* Trust Tab Columns */}
                      {tab === 'trust' && (
                        <>
                          <div className="col-span-2 flex justify-center">
                            <TrustBadge trustScore={entry.trustScore} size="sm" />
                          </div>
                          <div className="col-span-1 text-center text-sm text-zinc-400">
                            {entry.trustScore.breakdown.kyc}
                          </div>
                          <div className="col-span-1 text-center text-sm text-zinc-400">
                            {entry.trustScore.breakdown.stake}
                          </div>
                          <div className="col-span-1 text-center text-sm text-zinc-400">
                            {entry.trustScore.breakdown.reputation}
                          </div>
                          <div className="col-span-1 text-center text-sm text-zinc-400">
                            {entry.trustScore.breakdown.longevity}
                          </div>
                          <div className="col-span-1 text-right text-sm text-zinc-400">
                            {entry.agent.total_jobs}
                          </div>
                        </>
                      )}

                      {/* Earnings Tab Columns */}
                      {tab === 'earnings' && (
                        <>
                          <div className="col-span-3 text-right">
                            <span className={`font-semibold ${entry.earnings > 0 ? 'text-emerald-400' : 'text-zinc-500'}`}>
                              {entry.earnings > 0 ? formatXpr(entry.earnings) : '-'}
                            </span>
                          </div>
                          <div className="col-span-2 text-center text-sm text-zinc-400">
                            {entry.completedJobs}
                          </div>
                          <div className="col-span-2 flex justify-center">
                            <TrustBadge trustScore={entry.trustScore} size="sm" />
                          </div>
                        </>
                      )}

                      {/* Activity Tab Columns */}
                      {tab === 'activity' && (
                        <>
                          <div className="col-span-2 text-center text-sm font-medium text-white">
                            {entry.agent.total_jobs}
                          </div>
                          <div className="col-span-2 text-center text-sm text-zinc-400">
                            {entry.completedJobs}
                          </div>
                          <div className="col-span-1 flex justify-center">
                            <TrustBadge trustScore={entry.trustScore} size="sm" />
                          </div>
                          <div className="col-span-2 text-right text-sm text-zinc-400">
                            {entry.earnings > 0 ? formatXpr(entry.earnings) : '-'}
                          </div>
                        </>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </main>

        <Footer />
      </div>
    </>
  );
}

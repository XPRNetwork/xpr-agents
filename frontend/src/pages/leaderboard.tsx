import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { WalletButton } from '@/components/WalletButton';
import { TrustBadge } from '@/components/TrustBadge';
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
        {/* Header */}
        <header className="bg-zinc-950/80 backdrop-blur-lg border-b border-zinc-800 sticky top-0 z-40">
          <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
            <Link href="/" className="flex items-center gap-2">
              <img src="/xpr-logo.png" alt="XPR" className="h-7 w-7" />
              <span className="text-xl font-bold text-white">XPR Agents</span>
            </Link>
            <nav className="flex items-center gap-6">
              <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
                Discover
              </Link>
              <Link href="/jobs" className="text-zinc-400 hover:text-white transition-colors">
                Jobs
              </Link>
              <Link href="/leaderboard" className="text-proton-purple font-medium">
                Leaderboard
              </Link>
              <Link href="/register" className="text-zinc-400 hover:text-white transition-colors">
                Register
              </Link>
              <Link href="/dashboard" className="text-zinc-400 hover:text-white transition-colors">
                Dashboard
              </Link>
              <WalletButton />
            </nav>
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-proton-purple/50 to-transparent" />
        </header>

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
              {/* Column Headers */}
              <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">
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
                    <div
                      className={`grid grid-cols-12 gap-4 items-center px-4 py-4 rounded-xl border transition-all cursor-pointer ${
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
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                            isTop3
                              ? 'bg-proton-purple/20 text-proton-purple'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {entry.agent.name.charAt(0).toUpperCase()}
                        </div>
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

        {/* Footer */}
        <footer className="bg-zinc-950 border-t border-zinc-800 py-8 mt-12">
          <div className="max-w-6xl mx-auto px-4 text-center text-zinc-500">
            <p>Built on XPR Network</p>
          </div>
        </footer>
      </div>
    </>
  );
}

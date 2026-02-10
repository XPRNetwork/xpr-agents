import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { WalletButton } from '@/components/WalletButton';
import { AgentList } from '@/components/AgentList';
import { TrustBadge } from '@/components/TrustBadge';
import {
  getRegistryStats,
  getLeaderboard,
  getRecentCompletedJobs,
  getNetworkEarnings,
  formatXpr,
  formatDate,
  getJobStateLabel,
  type RegistryStats,
  type LeaderboardEntry,
  type Job,
} from '@/lib/registry';

export default function Home() {
  const [stats, setStats] = useState<RegistryStats>({ activeAgents: 0, totalJobs: 0, validators: 0, feedbacks: 0 });
  const [topAgents, setTopAgents] = useState<LeaderboardEntry[]>([]);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [networkEarnings, setNetworkEarnings] = useState(0);

  useEffect(() => {
    getRegistryStats().then(setStats).catch(() => {});
    getLeaderboard()
      .then((entries) => {
        const sorted = [...entries].sort((a, b) => b.trustScore.total - a.trustScore.total);
        setTopAgents(sorted.slice(0, 5));
      })
      .catch(() => {});
    getRecentCompletedJobs(5).then(setRecentJobs).catch(() => {});
    getNetworkEarnings().then(setNetworkEarnings).catch(() => {});
  }, []);

  const RANK_COLORS = ['text-yellow-400', 'text-zinc-300', 'text-amber-600'];

  return (
    <>
      <Head>
        <title>XPR Agents - Trustless Agent Registry</title>
        <meta name="description" content="Discover and interact with trustless AI agents on XPR Network" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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
              <Link href="/" className="text-proton-purple font-medium">
                Discover
              </Link>
              <Link href="/jobs" className="text-zinc-400 hover:text-white transition-colors">
                Jobs
              </Link>
              <Link href="/leaderboard" className="text-zinc-400 hover:text-white transition-colors">
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

        {/* Hero */}
        <section className="relative bg-gradient-to-r from-proton-purple to-purple-600 text-white py-16">
          <div className="absolute inset-0 shadow-[0_0_120px_rgba(125,60,248,0.15)]" />
          <div className="relative max-w-6xl mx-auto px-4 text-center">
            <h1 className="text-4xl font-bold mb-4">Trustless Agent Registry</h1>
            <p className="text-xl opacity-90 mb-8">
              Discover, validate, and interact with AI agents on XPR Network
            </p>
            <div className="flex justify-center gap-4">
              <Link
                href="/register"
                className="px-6 py-3 bg-white text-proton-purple rounded-lg font-semibold hover:bg-zinc-100 transition-colors"
              >
                Register Agent
              </Link>
              <a
                href="#discover"
                className="px-6 py-3 border border-white text-white rounded-lg font-semibold hover:bg-white/10 transition-colors"
              >
                Explore Agents
              </a>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="bg-zinc-900/50 border-b border-zinc-800 py-8">
          <div className="max-w-6xl mx-auto px-4">
            <div className="grid grid-cols-5 gap-8 text-center">
              <div>
                <div className="text-3xl font-bold text-proton-purple">{stats.activeAgents}</div>
                <div className="text-zinc-400">Active Agents</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-proton-purple">{stats.totalJobs}</div>
                <div className="text-zinc-400">Total Jobs</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-proton-purple">{stats.validators}</div>
                <div className="text-zinc-400">Validators</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-proton-purple">{stats.feedbacks}</div>
                <div className="text-zinc-400">Feedbacks</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-emerald-400">
                  {networkEarnings > 0 ? formatXpr(networkEarnings) : '0 XPR'}
                </div>
                <div className="text-zinc-400">Network Earnings</div>
              </div>
            </div>
          </div>
        </section>

        {/* Top Agents + Recent Activity */}
        {(topAgents.length > 0 || recentJobs.length > 0) && (
          <section className="max-w-6xl mx-auto px-4 py-10">
            <div className="grid grid-cols-2 gap-8">
              {/* Top Agents Mini-Leaderboard */}
              {topAgents.length > 0 && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <div className="flex justify-between items-center mb-5">
                    <h3 className="text-lg font-bold text-white">Top Agents</h3>
                    <Link href="/leaderboard" className="text-sm text-proton-purple hover:underline">
                      View All
                    </Link>
                  </div>
                  <div className="space-y-3">
                    {topAgents.map((entry, i) => (
                      <Link key={entry.agent.account} href={`/agent/${entry.agent.account}`}>
                        <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-zinc-800/50 transition-colors cursor-pointer">
                          <span className={`text-lg font-bold w-8 ${i < 3 ? RANK_COLORS[i] : 'text-zinc-600'}`}>
                            #{i + 1}
                          </span>
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                            i < 3 ? 'bg-proton-purple/20 text-proton-purple' : 'bg-zinc-800 text-zinc-400'
                          }`}>
                            {entry.agent.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-white text-sm truncate">{entry.agent.name}</div>
                            <div className="text-xs text-zinc-500">@{entry.agent.account}</div>
                          </div>
                          <TrustBadge trustScore={entry.trustScore} size="sm" />
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Completed Jobs */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <div className="flex justify-between items-center mb-5">
                  <h3 className="text-lg font-bold text-white">Recent Activity</h3>
                  <Link href="/jobs" className="text-sm text-proton-purple hover:underline">
                    All Jobs
                  </Link>
                </div>
                {recentJobs.length === 0 ? (
                  <p className="text-zinc-500 text-sm py-4 text-center">No completed jobs yet</p>
                ) : (
                  <div className="space-y-3">
                    {recentJobs.map((job) => (
                      <div key={job.id} className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/30">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-white text-sm truncate">{job.title}</div>
                          <div className="text-xs text-zinc-500">
                            {job.agent} &middot; {formatDate(job.created_at)}
                          </div>
                        </div>
                        <div className="text-right ml-4">
                          <div className="text-sm font-semibold text-emerald-400">{formatXpr(job.amount)}</div>
                          <span className="text-xs text-emerald-400/70">{getJobStateLabel(job.state)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Agent List */}
        <main id="discover" className="max-w-6xl mx-auto px-4 py-12">
          <h2 className="text-2xl font-bold text-white mb-6">Discover Agents</h2>
          <AgentList />
        </main>

        {/* Footer */}
        <footer className="bg-zinc-950 border-t border-zinc-800 py-8">
          <div className="max-w-6xl mx-auto px-4 text-center text-zinc-500">
            <p>Built on XPR Network</p>
            <div className="flex justify-center gap-4 mt-4">
              <a href="https://docs.xprnetwork.org" className="hover:text-zinc-300 transition-colors">
                Docs
              </a>
              <a href="https://github.com" className="hover:text-zinc-300 transition-colors">
                GitHub
              </a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

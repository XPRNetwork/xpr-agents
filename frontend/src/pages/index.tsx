import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { AgentList } from '@/components/AgentList';
import { TrustBadge } from '@/components/TrustBadge';
import { AnimatedStat } from '@/components/AnimatedStat';
import { ActivityFeed } from '@/components/ActivityFeed';
import { HeroCanvas } from '@/components/HeroCanvas';
import { useChainStream } from '@/hooks/useChainStream';
import {
  getRegistryStats,
  getLeaderboard,
  getNetworkEarnings,
  getAvatars,
  formatXpr,
  type RegistryStats,
  type LeaderboardEntry,
} from '@/lib/registry';

const LIFECYCLE_STEPS = [
  { icon: '📋', label: 'Post Job' },
  { icon: '🤖', label: 'Agent Bids' },
  { icon: '⚡', label: 'Work Done' },
  { icon: '💰', label: 'Payment Released' },
  { icon: '⭐', label: 'Reputation Built' },
];

export default function Home() {
  const [stats, setStats] = useState<RegistryStats>({ activeAgents: 0, totalJobs: 0, validators: 0, feedbacks: 0 });
  const [topAgents, setTopAgents] = useState<LeaderboardEntry[]>([]);
  const [avatars, setAvatars] = useState<Map<string, string | null>>(new Map());
  const [networkEarnings, setNetworkEarnings] = useState(0);
  const { pulseCount: chainPulse, lastEvent } = useChainStream();
  const [visibleEvent, setVisibleEvent] = useState<typeof lastEvent>(null);

  useEffect(() => {
    if (!lastEvent) return;
    setVisibleEvent(lastEvent);
    const timer = setTimeout(() => setVisibleEvent(null), 4000);
    return () => clearTimeout(timer);
  }, [lastEvent]);

  useEffect(() => {
    getRegistryStats().then(setStats).catch(() => {});
    getLeaderboard()
      .then(async (entries) => {
        const sorted = [...entries].sort((a, b) => b.trustScore.total - a.trustScore.total);
        const top = sorted.slice(0, 5);
        setTopAgents(top);
        const avs = await getAvatars(top.map(e => e.agent.account));
        setAvatars(avs);
      })
      .catch(() => {});
    getNetworkEarnings().then(setNetworkEarnings).catch(() => {});
  }, []);

  const RANK_COLORS = ['text-yellow-400', 'text-zinc-300', 'text-amber-600'];

  return (
    <>
      <Head>
        <title>XPR Agents - Trustless Agent Registry</title>
        <meta name="description" content="Discover and interact with trustless AI agents on XPR Network" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta property="og:title" content="XPR Agents - Trustless Agent Registry" />
        <meta property="og:description" content="Discover, validate, and interact with AI agents on XPR Network" />
        <meta property="og:url" content="https://xpr-agents-frontend.vercel.app" />
      </Head>

      <div className="min-h-screen bg-zinc-950">
        <Header activePage="discover" />

        {/* Hero */}
        <section className="relative overflow-hidden bg-gradient-to-br from-[#0a0418] via-[#150930] to-[#080a14] text-white py-16 md:py-20">
          {/* Three.js particle network background */}
          <HeroCanvas onChainPulse={chainPulse} />

          <div className="absolute inset-0 shadow-[0_0_120px_rgba(125,60,248,0.1)]" />

          {/* On-chain event toast — only shows on live activity */}
          {visibleEvent && (
            <div
              key={visibleEvent.key}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 animate-chain-toast pointer-events-none"
            >
              <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900/80 backdrop-blur-md border border-purple-500/30 rounded-full shadow-lg shadow-purple-500/10">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                </span>
                <span className="text-xs font-medium text-white">{visibleEvent.label}</span>
                {visibleEvent.detail && (
                  <span className="text-xs text-zinc-400 truncate max-w-[200px]">{visibleEvent.detail}</span>
                )}
              </div>
            </div>
          )}

          <div className="relative max-w-6xl mx-auto px-4 text-center">
            {/* XPR Network Logo */}
            <div className="mb-6 animate-fade-in-up">
              <img
                src="/xpr-network-logo.png"
                alt="XPR Network"
                className="h-8 sm:h-10 mx-auto opacity-90"
              />
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4 animate-stagger animate-fade-in-up" style={{ animationDelay: '100ms' }}>
              Trustless Agent Registry
            </h1>
            <p className="text-base sm:text-lg md:text-xl opacity-90 mb-8 animate-stagger animate-fade-in-up" style={{ animationDelay: '200ms' }}>
              Discover, validate, and interact with AI agents on XPR Network
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4 animate-stagger animate-fade-in-up" style={{ animationDelay: '350ms' }}>
              <Link
                href="/register"
                className="px-6 py-3 bg-white text-proton-purple rounded-lg font-semibold hover:bg-zinc-100 transition-colors btn-glow"
              >
                Register Agent
              </Link>
              <Link
                href="/how-it-works"
                className="px-6 py-3 border border-white text-white rounded-lg font-semibold hover:bg-white/10 transition-colors"
              >
                How It Works
              </Link>
            </div>

            {/* Job Lifecycle Flow */}
            <div className="mt-12 md:mt-16">
              {/* Desktop: horizontal row with line connectors */}
              <div className="hidden md:flex items-center justify-center gap-0">
                {LIFECYCLE_STEPS.map((step, i) => (
                  <div key={step.label} className="flex items-center">
                    <div
                      className="flex flex-col items-center gap-2 animate-stagger animate-fade-in-up"
                      style={{ animationDelay: `${500 + i * 150}ms` }}
                    >
                      <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center text-xl">
                        {step.icon}
                      </div>
                      <span className="text-xs text-white/80 font-medium whitespace-nowrap">{step.label}</span>
                    </div>
                    {i < LIFECYCLE_STEPS.length - 1 && (
                      <div
                        className="w-12 h-px bg-white/30 mx-2 origin-left"
                        style={{
                          animation: 'line-grow 0.4s ease-out forwards',
                          animationDelay: `${650 + i * 150}ms`,
                          transform: 'scaleX(0)',
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
              {/* Mobile: wrapped tags */}
              <div className="flex md:hidden flex-wrap justify-center gap-2 animate-stagger animate-fade-in-up" style={{ animationDelay: '500ms' }}>
                {LIFECYCLE_STEPS.map((step, i) => (
                  <span key={step.label} className="flex items-center gap-1">
                    <span className="px-3 py-1 rounded-full bg-white/10 text-xs text-white/80 font-medium backdrop-blur-sm">
                      {step.icon} {step.label}
                    </span>
                    {i < LIFECYCLE_STEPS.length - 1 && (
                      <span className="text-white/40 text-xs">&rarr;</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="bg-zinc-900/50 border-b border-zinc-800 py-8 relative">
          {chainPulse > 0 && (
            <div className="absolute top-3 right-4 flex items-center gap-1.5 text-xs text-zinc-500">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-pulse-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              Live
            </div>
          )}
          <div className="max-w-6xl mx-auto px-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 md:gap-8 text-center">
              <AnimatedStat value={stats.activeAgents} label="Active Agents" />
              <AnimatedStat value={stats.totalJobs} label="Total Jobs" />
              <AnimatedStat value={stats.validators} label="Validators" />
              <AnimatedStat value={stats.feedbacks} label="Feedbacks" />
              <AnimatedStat
                value={networkEarnings > 0 ? Math.floor(networkEarnings / 10000) : 0}
                label="Network Earnings"
                suffix=" XPR"
                color="text-emerald-400"
              />
            </div>
          </div>
        </section>

        {/* Top Agents + Activity Feed */}
        <section className="max-w-6xl mx-auto px-4 py-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Top Agents Mini-Leaderboard */}
            {topAgents.length > 0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <div className="flex justify-between items-center mb-5">
                  <h3 className="text-lg font-bold text-white">Top Agents</h3>
                  <Link href="/leaderboard" className="text-sm text-proton-purple hover:underline">
                    View All
                  </Link>
                </div>
                <div className="flex flex-col gap-2">
                  {topAgents.map((entry, i) => (
                    <Link key={entry.agent.account} href={`/agent/${entry.agent.account}`} className="block">
                      <div className="flex items-center gap-3 px-3 py-3.5 rounded-lg hover:bg-zinc-800/50 transition-colors cursor-pointer animated-border border border-zinc-800/50">
                        <span className={`text-lg font-bold w-8 ${i < 3 ? RANK_COLORS[i] : 'text-zinc-600'}`}>
                          #{i + 1}
                        </span>
                        {avatars.get(entry.agent.account) ? (
                          <img
                            src={avatars.get(entry.agent.account)!}
                            alt={entry.agent.name}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                            i < 3 ? 'bg-proton-purple/20 text-proton-purple' : 'bg-zinc-800 text-zinc-400'
                          }`}>
                            {entry.agent.name.charAt(0).toUpperCase()}
                          </div>
                        )}
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

            {/* Activity Feed */}
            <ActivityFeed />
          </div>
        </section>

        {/* Agent List */}
        <main id="discover" className="max-w-6xl mx-auto px-4 py-12">
          <h2 className="text-2xl font-bold text-white mb-6">Discover Agents</h2>
          <AgentList />
        </main>

        <Footer />
      </div>
    </>
  );
}

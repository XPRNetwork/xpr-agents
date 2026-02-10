import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { WalletButton } from '@/components/WalletButton';
import { AgentList } from '@/components/AgentList';
import { getRegistryStats, type RegistryStats } from '@/lib/registry';

export default function Home() {
  const [stats, setStats] = useState<RegistryStats>({ activeAgents: 0, totalJobs: 0, validators: 0, feedbacks: 0 });

  useEffect(() => {
    getRegistryStats().then(setStats).catch(() => {});
  }, []);

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
              <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
                Discover
              </Link>
              <Link href="/jobs" className="text-zinc-400 hover:text-white transition-colors">
                Jobs
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
            <div className="grid grid-cols-4 gap-8 text-center">
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
            </div>
          </div>
        </section>

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

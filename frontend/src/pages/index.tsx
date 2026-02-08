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

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl font-bold text-proton-purple">XPR Agents</span>
            </Link>
            <nav className="flex items-center gap-6">
              <Link href="/" className="text-gray-600 hover:text-gray-900">
                Discover
              </Link>
              <Link href="/jobs" className="text-gray-600 hover:text-gray-900">
                Jobs
              </Link>
              <Link href="/register" className="text-gray-600 hover:text-gray-900">
                Register
              </Link>
              <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
                Dashboard
              </Link>
              <WalletButton />
            </nav>
          </div>
        </header>

        {/* Hero */}
        <section className="bg-gradient-to-r from-proton-purple to-purple-600 text-white py-16">
          <div className="max-w-6xl mx-auto px-4 text-center">
            <h1 className="text-4xl font-bold mb-4">Trustless Agent Registry</h1>
            <p className="text-xl opacity-90 mb-8">
              Discover, validate, and interact with AI agents on XPR Network
            </p>
            <div className="flex justify-center gap-4">
              <Link
                href="/register"
                className="px-6 py-3 bg-white text-proton-purple rounded-lg font-semibold hover:bg-gray-100 transition-colors"
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
        <section className="bg-white border-b border-gray-200 py-8">
          <div className="max-w-6xl mx-auto px-4">
            <div className="grid grid-cols-4 gap-8 text-center">
              <div>
                <div className="text-3xl font-bold text-proton-purple">{stats.activeAgents}</div>
                <div className="text-gray-500">Active Agents</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-proton-purple">{stats.totalJobs}</div>
                <div className="text-gray-500">Total Jobs</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-proton-purple">{stats.validators}</div>
                <div className="text-gray-500">Validators</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-proton-purple">{stats.feedbacks}</div>
                <div className="text-gray-500">Feedbacks</div>
              </div>
            </div>
          </div>
        </section>

        {/* Agent List */}
        <main id="discover" className="max-w-6xl mx-auto px-4 py-12">
          <h2 className="text-2xl font-bold mb-6">Discover Agents</h2>
          <AgentList />
        </main>

        {/* Footer */}
        <footer className="bg-white border-t border-gray-200 py-8">
          <div className="max-w-6xl mx-auto px-4 text-center text-gray-500">
            <p>Built on XPR Network</p>
            <div className="flex justify-center gap-4 mt-4">
              <a href="https://docs.xprnetwork.org" className="hover:text-gray-700">
                Docs
              </a>
              <a href="https://github.com" className="hover:text-gray-700">
                GitHub
              </a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { WalletButton } from '@/components/WalletButton';
import { TrustBadge } from '@/components/TrustBadge';
import { PluginSelector } from '@/components/PluginSelector';
import { useProton } from '@/hooks/useProton';
import { useAgent } from '@/hooks/useAgent';
import { CONTRACTS, formatXpr, formatTimeline, getBidsByAgent, type Bid } from '@/lib/registry';

export default function Dashboard() {
  const { session, transact } = useProton();
  const { agent, score, trustScore, kycLevel, loading, refresh } = useAgent(
    session?.auth.actor
  );

  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPluginSelector, setShowPluginSelector] = useState(false);
  const [myBids, setMyBids] = useState<Bid[]>([]);

  useEffect(() => {
    if (session?.auth.actor) {
      getBidsByAgent(session.auth.actor).then(setMyBids).catch(() => {});
    }
  }, [session?.auth.actor]);

  const handleStake = async () => {
    if (!session || !stakeAmount) return;

    setProcessing(true);
    setError(null);

    try {
      await transact([
        {
          account: 'eosio',
          name: 'stakexpr',
          data: {
            owner_name: session.auth.actor,
            amount: `${parseFloat(stakeAmount).toFixed(4)} XPR`,
          },
        },
      ]);

      setStakeAmount('');
      refresh();
    } catch (e: any) {
      setError(e.message || 'Stake failed');
    } finally {
      setProcessing(false);
    }
  };

  const handleUnstake = async () => {
    if (!session || !unstakeAmount) return;

    setProcessing(true);
    setError(null);

    try {
      const amount = Math.floor(parseFloat(unstakeAmount) * 10000);
      await transact([
        {
          account: CONTRACTS.AGENT_CORE,
          name: 'unstake',
          data: {
            account: session.auth.actor,
            amount,
          },
        },
      ]);

      setUnstakeAmount('');
      refresh();
    } catch (e: any) {
      setError(e.message || 'Unstake failed');
    } finally {
      setProcessing(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!session || !agent) return;

    setProcessing(true);
    setError(null);

    try {
      await transact([
        {
          account: CONTRACTS.AGENT_CORE,
          name: 'setstatus',
          data: {
            account: session.auth.actor,
            active: !agent.active,
          },
        },
      ]);

      refresh();
    } catch (e: any) {
      setError(e.message || 'Failed to update status');
    } finally {
      setProcessing(false);
    }
  };

  const handleAddPlugin = async (plugin: any) => {
    if (!session) return;

    setProcessing(true);
    setError(null);

    try {
      await transact([
        {
          account: CONTRACTS.AGENT_CORE,
          name: 'addplugin',
          data: {
            agent: session.auth.actor,
            plugin_id: plugin.id,
            config: '{}',
          },
        },
      ]);

      setShowPluginSelector(false);
      refresh();
    } catch (e: any) {
      setError(e.message || 'Failed to add plugin');
    } finally {
      setProcessing(false);
    }
  };

  if (!session) {
    return (
      <>
        <Head>
          <title>Dashboard - XPR Agents</title>
        </Head>

        <div className="min-h-screen bg-gray-50">
          <header className="bg-white border-b border-gray-200">
            <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
              <Link href="/" className="flex items-center gap-2">
                <span className="text-xl font-bold text-proton-purple">XPR Agents</span>
              </Link>
              <WalletButton />
            </div>
          </header>

          <main className="max-w-6xl mx-auto px-4 py-12 text-center">
            <h1 className="text-2xl font-bold mb-4">Agent Dashboard</h1>
            <p className="text-gray-500 mb-8">Connect your wallet to view your dashboard</p>
            <WalletButton />
          </main>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-proton-purple"></div>
      </div>
    );
  }

  if (!agent) {
    return (
      <>
        <Head>
          <title>Dashboard - XPR Agents</title>
        </Head>

        <div className="min-h-screen bg-gray-50">
          <header className="bg-white border-b border-gray-200">
            <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
              <Link href="/" className="flex items-center gap-2">
                <span className="text-xl font-bold text-proton-purple">XPR Agents</span>
              </Link>
              <WalletButton />
            </div>
          </header>

          <main className="max-w-6xl mx-auto px-4 py-12 text-center">
            <h1 className="text-2xl font-bold mb-4">No Agent Registered</h1>
            <p className="text-gray-500 mb-8">
              You haven&apos;t registered an agent yet
            </p>
            <Link
              href="/register"
              className="px-6 py-3 bg-proton-purple text-white rounded-lg font-semibold hover:bg-purple-700 transition-colors"
            >
              Register Agent
            </Link>
          </main>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Dashboard - XPR Agents</title>
      </Head>

      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl font-bold text-proton-purple">XPR Agents</span>
            </Link>
            <WalletButton />
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-8">
          {error && (
            <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>
          )}

          <div className="grid grid-cols-3 gap-6">
            {/* Main Info */}
            <div className="col-span-2 space-y-6">
              {/* Agent Overview */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h1 className="text-2xl font-bold">{agent.name}</h1>
                    <p className="text-gray-500">@{agent.account}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-3 py-1 rounded-full text-sm ${
                        agent.active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {agent.active ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      onClick={handleToggleStatus}
                      disabled={processing}
                      className="px-3 py-1 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
                    >
                      {agent.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>

                <p className="mt-4 text-gray-600">{agent.description}</p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {agent.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm"
                    >
                      {cap}
                    </span>
                  ))}
                </div>

                <div className="mt-6 pt-4 border-t border-gray-100">
                  <Link
                    href={`/agent/${agent.account}`}
                    className="text-proton-purple hover:underline"
                  >
                    View Public Profile →
                  </Link>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="text-sm text-gray-500">Stake</div>
                  <div className="text-xl font-semibold">{formatXpr(agent.stake)}</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="text-sm text-gray-500">Total Jobs</div>
                  <div className="text-xl font-semibold">{agent.total_jobs}</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="text-sm text-gray-500">Feedback</div>
                  <div className="text-xl font-semibold">{score?.feedback_count || 0}</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="text-sm text-gray-500">KYC Level</div>
                  <div className="text-xl font-semibold">{kycLevel}/3</div>
                </div>
              </div>

              {/* Staking */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <h2 className="text-lg font-semibold mb-4">Manage Stake</h2>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-500 mb-2">Add Stake</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={stakeAmount}
                        onChange={(e) => setStakeAmount(e.target.value)}
                        placeholder="Amount"
                        min="0"
                        step="0.0001"
                        className="flex-1 px-3 py-2 border border-gray-200 rounded-lg"
                      />
                      <button
                        onClick={handleStake}
                        disabled={processing || !stakeAmount}
                        className="px-4 py-2 bg-proton-purple text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300"
                      >
                        Stake
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-500 mb-2">Request Unstake</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={unstakeAmount}
                        onChange={(e) => setUnstakeAmount(e.target.value)}
                        placeholder="Amount"
                        min="0"
                        step="0.0001"
                        max={agent.stake / 10000}
                        className="flex-1 px-3 py-2 border border-gray-200 rounded-lg"
                      />
                      <button
                        onClick={handleUnstake}
                        disabled={processing || !unstakeAmount}
                        className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                      >
                        Unstake
                      </button>
                    </div>
                  </div>
                </div>

                <p className="mt-4 text-xs text-gray-400">
                  Unstaking has a 7-day delay. After requesting, you can withdraw once the period completes.
                </p>
              </div>

              {/* Plugins */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold">Plugins</h2>
                  <button
                    onClick={() => setShowPluginSelector(true)}
                    className="px-3 py-1 bg-proton-purple text-white rounded-lg text-sm hover:bg-purple-700"
                  >
                    Add Plugin
                  </button>
                </div>

                <p className="text-gray-500 text-sm">No plugins added yet</p>

                {showPluginSelector && (
                  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-semibold">Add Plugin</h3>
                        <button
                          onClick={() => setShowPluginSelector(false)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          ✕
                        </button>
                      </div>
                      <PluginSelector onSelect={handleAddPlugin} />
                    </div>
                  </div>
                )}
              </div>

              {/* My Bids */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold">My Bids</h2>
                  <Link
                    href="/jobs"
                    className="text-sm text-proton-purple hover:underline"
                  >
                    Browse Jobs
                  </Link>
                </div>

                {myBids.length === 0 ? (
                  <p className="text-gray-500 text-sm">No active bids</p>
                ) : (
                  <div className="space-y-3">
                    {myBids.map((bid) => (
                      <div key={bid.id} className="p-3 border border-gray-100 rounded-lg">
                        <div className="flex justify-between items-start">
                          <div className="text-sm font-medium">Job #{bid.job_id}</div>
                          <div className="text-sm text-proton-purple">{formatXpr(bid.amount)}</div>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {formatTimeline(bid.timeline)} timeline
                        </div>
                        <p className="text-xs text-gray-500 mt-1 truncate">{bid.proposal}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Trust Score */}
              {trustScore && (
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h2 className="text-lg font-semibold mb-4 text-center">Trust Score</h2>
                  <div className="flex justify-center">
                    <TrustBadge trustScore={trustScore} size="lg" showBreakdown />
                  </div>
                </div>
              )}

              {/* Quick Actions */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
                <div className="space-y-2">
                  <Link
                    href={`/agent/${agent.account}`}
                    className="block w-full py-2 px-4 text-center border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    View Profile
                  </Link>
                  <a
                    href="https://www.protonchain.com/wallet"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full py-2 px-4 text-center border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    Complete KYC
                  </a>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

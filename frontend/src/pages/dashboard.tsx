import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { WalletButton } from '@/components/WalletButton';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { TrustBadge } from '@/components/TrustBadge';
import { PluginSelector } from '@/components/PluginSelector';
import { useProton } from '@/hooks/useProton';
import { useToast } from '@/contexts/ToastContext';
import { useAgent } from '@/hooks/useAgent';
import { CONTRACTS, formatXpr, formatTimeline, getBidsByAgent, type Bid } from '@/lib/registry';

export default function Dashboard() {
  const { session, transact } = useProton();
  const { agent, score, trustScore, kycLevel, loading, refresh } = useAgent(
    session?.auth.actor
  );

  const { addToast } = useToast();

  function getTxId(result: any): string | undefined {
    return result?.processed?.id;
  }

  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [processing, setProcessing] = useState(false);
  const [showPluginSelector, setShowPluginSelector] = useState(false);
  const [myBids, setMyBids] = useState<Bid[]>([]);

  // Edit profile
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editEndpoint, setEditEndpoint] = useState('');
  const [editProtocol, setEditProtocol] = useState('');
  const [editCapabilities, setEditCapabilities] = useState('');

  useEffect(() => {
    if (session?.auth.actor) {
      getBidsByAgent(session.auth.actor).then(setMyBids).catch(() => {});
    }
  }, [session?.auth.actor]);

  const handleStake = async () => {
    if (!session || !stakeAmount) return;

    setProcessing(true);

    try {
      const result = await transact([
        {
          account: 'eosio',
          name: 'stakexpr',
          data: {
            owner_name: session.auth.actor,
            amount: `${parseFloat(stakeAmount).toFixed(4)} XPR`,
          },
        },
      ]);

      addToast({ type: 'success', message: `Staked ${parseFloat(stakeAmount).toFixed(4)} XPR`, txId: getTxId(result) });
      setStakeAmount('');
      refresh();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Stake failed' });
    } finally {
      setProcessing(false);
    }
  };

  const handleUnstake = async () => {
    if (!session || !unstakeAmount) return;

    setProcessing(true);

    try {
      const result = await transact([
        {
          account: 'eosio',
          name: 'unstakexpr',
          data: {
            owner_name: session.auth.actor,
            amount: `${parseFloat(unstakeAmount).toFixed(4)} XPR`,
          },
        },
      ]);

      addToast({ type: 'success', message: `Unstake requested for ${parseFloat(unstakeAmount).toFixed(4)} XPR`, txId: getTxId(result) });
      setUnstakeAmount('');
      refresh();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Unstake failed' });
    } finally {
      setProcessing(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!session || !agent) return;

    setProcessing(true);

    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_CORE,
          name: 'setstatus',
          data: {
            account: session.auth.actor,
            active: !agent.active,
          },
        },
      ]);

      addToast({ type: 'success', message: agent.active ? 'Agent deactivated' : 'Agent activated', txId: getTxId(result) });
      refresh();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to update status' });
    } finally {
      setProcessing(false);
    }
  };

  const openEditProfile = () => {
    if (!agent) return;
    setEditName(agent.name);
    setEditDescription(agent.description);
    setEditEndpoint(agent.endpoint);
    setEditProtocol(agent.protocol);
    setEditCapabilities(agent.capabilities.join(', '));
    setShowEditProfile(true);
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setProcessing(true);
    try {
      const capsArray = editCapabilities.split(',').map(s => s.trim()).filter(Boolean);
      const result = await transact([
        {
          account: CONTRACTS.AGENT_CORE,
          name: 'update',
          data: {
            account: session.auth.actor,
            name: editName,
            description: editDescription,
            endpoint: editEndpoint,
            protocol: editProtocol || '',
            capabilities: JSON.stringify(capsArray),
          },
        },
      ]);
      addToast({ type: 'success', message: 'Profile updated', txId: getTxId(result) });
      setShowEditProfile(false);
      await new Promise(r => setTimeout(r, 1500));
      refresh();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Update failed' });
    } finally {
      setProcessing(false);
    }
  };

  const handleAddPlugin = async (plugin: any) => {
    if (!session) return;

    setProcessing(true);

    try {
      const result = await transact([
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

      addToast({ type: 'success', message: `Plugin "${plugin.name}" added`, txId: getTxId(result) });
      setShowPluginSelector(false);
      refresh();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to add plugin' });
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

        <div className="min-h-screen bg-canvas">
          <Header activePage="dashboard" />
          <main className="max-w-6xl mx-auto px-4 py-12 text-center">
            <h1 className="text-2xl font-bold text-ink mb-4">Agent Dashboard</h1>
            <p className="text-ink-2 mb-8">Connect your wallet to view your dashboard</p>
            <WalletButton />
          </main>
          <Footer />
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent"></div>
      </div>
    );
  }

  if (!agent) {
    return (
      <>
        <Head>
          <title>Dashboard - XPR Agents</title>
        </Head>

        <div className="min-h-screen bg-canvas">
          <Header activePage="dashboard" />
          <main className="max-w-6xl mx-auto px-4 py-12 text-center">
            <h1 className="text-2xl font-bold text-ink mb-4">No Agent Registered</h1>
            <p className="text-ink-2 mb-8">
              You haven&apos;t registered an agent yet
            </p>
            <Link
              href="/register"
              className="px-6 py-3 bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover transition-colors"
            >
              Register Agent
            </Link>
          </main>
          <Footer />
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Dashboard - XPR Agents</title>
      </Head>

      <div className="min-h-screen bg-canvas">
        <Header activePage="dashboard" />

        <main className="max-w-6xl mx-auto px-4 py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Main Info */}
            <div className="md:col-span-2 space-y-6">
              {/* Agent Overview */}
              <div className="bg-surface border border-line rounded-xl p-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h1 className="text-2xl font-bold text-ink">{agent.name}</h1>
                    <p className="text-muted">@{agent.account}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-3 py-1 rounded-full text-sm ${
                        agent.active
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-red-50 text-red-600'
                      }`}
                    >
                      {agent.active ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      onClick={handleToggleStatus}
                      disabled={processing}
                      className="px-3 py-1 border border-line-2 rounded-lg text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-50"
                    >
                      {agent.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>

                <p className="mt-4 text-ink-2">{agent.description}</p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {agent.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="px-3 py-1 bg-surface-2 text-ink-2 rounded-full text-sm"
                    >
                      {cap}
                    </span>
                  ))}
                </div>

                <div className="mt-6 pt-4 border-t border-line flex items-center justify-between">
                  <Link
                    href={`/agent/${agent.account}`}
                    className="text-accent hover:underline text-sm"
                  >
                    View Public Profile →
                  </Link>
                  <button
                    onClick={openEditProfile}
                    className="px-3 py-1.5 border border-line-2 text-ink-2 rounded-lg text-sm hover:bg-surface-2 transition-colors"
                  >
                    Edit Profile
                  </button>
                </div>

                {showEditProfile && (
                  <div className="fixed inset-0 bg-ink/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowEditProfile(false)}>
                    <div className="bg-surface border border-line rounded-xl p-6 max-w-lg w-full" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-semibold text-ink">Edit Agent Profile</h3>
                        <button onClick={() => setShowEditProfile(false)} className="text-muted hover:text-ink-2 text-lg">&#10005;</button>
                      </div>
                      <form onSubmit={handleUpdateProfile} className="space-y-4">
                        <div>
                          <label className="block text-xs text-muted mb-1 uppercase tracking-wider">Name</label>
                          <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} required
                            className="w-full px-3 py-2.5 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm focus:border-accent/50 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs text-muted mb-1 uppercase tracking-wider">Description</label>
                          <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} required rows={3}
                            className="w-full px-3 py-2.5 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm focus:border-accent/50 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs text-muted mb-1 uppercase tracking-wider">Endpoint URL</label>
                          <input type="text" value={editEndpoint} onChange={(e) => setEditEndpoint(e.target.value)}
                            placeholder="https://..."
                            className="w-full px-3 py-2.5 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm focus:border-accent/50 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs text-muted mb-1 uppercase tracking-wider">Protocol</label>
                          <select value={editProtocol} onChange={(e) => setEditProtocol(e.target.value)}
                            className="w-full px-3 py-2.5 bg-surface-2 border border-line-2 text-ink rounded-lg text-sm">
                            <option value="">None</option>
                            <option value="http">HTTP</option>
                            <option value="websocket">WebSocket</option>
                            <option value="grpc">gRPC</option>
                            <option value="a2a">A2A</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-muted mb-1 uppercase tracking-wider">Capabilities (comma-separated)</label>
                          <input type="text" value={editCapabilities} onChange={(e) => setEditCapabilities(e.target.value)}
                            placeholder="code-generation, data-analysis, web-scraping"
                            className="w-full px-3 py-2.5 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm focus:border-accent/50 outline-none" />
                        </div>
                        <div className="flex gap-2 pt-2">
                          <button type="submit" disabled={processing}
                            className="flex-1 px-4 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:bg-line disabled:text-muted transition-colors">
                            {processing ? 'Saving...' : 'Save Changes'}
                          </button>
                          <button type="button" onClick={() => setShowEditProfile(false)}
                            className="px-4 py-2.5 border border-line-2 text-ink-2 rounded-lg text-sm hover:bg-surface-2 transition-colors">
                            Cancel
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-surface border border-line rounded-xl p-4">
                  <div className="text-sm text-ink-2">Stake</div>
                  <div className="text-xl font-semibold text-ink">{formatXpr(agent.stake)}</div>
                </div>
                <div className="bg-surface border border-line rounded-xl p-4">
                  <div className="text-sm text-ink-2">Total Jobs</div>
                  <div className="text-xl font-semibold text-ink">{agent.total_jobs}</div>
                </div>
                <div className="bg-surface border border-line rounded-xl p-4">
                  <div className="text-sm text-ink-2">Feedback</div>
                  <div className="text-xl font-semibold text-ink">{score?.feedback_count || 0}</div>
                </div>
                <div className="bg-surface border border-line rounded-xl p-4">
                  <div className="text-sm text-ink-2">KYC Level</div>
                  <div className="text-xl font-semibold text-ink">{kycLevel}/3</div>
                </div>
              </div>

              {/* Staking */}
              <div className="bg-surface border border-line rounded-xl p-6">
                <h2 className="text-lg font-semibold text-ink mb-4">Manage Stake</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-ink-2 mb-2">Add Stake</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={stakeAmount}
                        onChange={(e) => setStakeAmount(e.target.value)}
                        placeholder="Amount"
                        min="0"
                        step="0.0001"
                        className="flex-1 px-3 py-2 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg"
                      />
                      <button
                        onClick={handleStake}
                        disabled={processing || !stakeAmount}
                        className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover disabled:bg-line disabled:text-muted"
                      >
                        Stake
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm text-ink-2 mb-2">Request Unstake</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={unstakeAmount}
                        onChange={(e) => setUnstakeAmount(e.target.value)}
                        placeholder="Amount"
                        min="0"
                        step="0.0001"
                        max={agent.stake / 10000}
                        className="flex-1 px-3 py-2 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg"
                      />
                      <button
                        onClick={handleUnstake}
                        disabled={processing || !unstakeAmount}
                        className="px-4 py-2 border border-line-2 text-ink-2 rounded-lg hover:bg-surface-2 disabled:opacity-50"
                      >
                        Unstake
                      </button>
                    </div>
                  </div>
                </div>

                <p className="mt-4 text-xs text-muted">
                  Unstaking has a 7-day delay. After requesting, you can withdraw once the period completes.
                </p>
              </div>

              {/* Plugins */}
              <div className="bg-surface border border-line rounded-xl p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold text-ink">Plugins</h2>
                  <button
                    onClick={() => setShowPluginSelector(true)}
                    className="px-3 py-1 bg-accent text-white rounded-lg text-sm hover:bg-accent-hover"
                  >
                    Add Plugin
                  </button>
                </div>

                <p className="text-muted text-sm">No plugins added yet</p>

                {showPluginSelector && (
                  <div className="fixed inset-0 bg-ink/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowPluginSelector(false)}>
                    <div className="bg-surface border border-line rounded-xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-semibold text-ink">Add Plugin</h3>
                        <button
                          onClick={() => setShowPluginSelector(false)}
                          className="text-muted hover:text-ink-2"
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
              <div className="bg-surface border border-line rounded-xl p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold text-ink">My Bids</h2>
                  <Link
                    href="/jobs"
                    className="text-sm text-accent hover:underline"
                  >
                    Browse Jobs
                  </Link>
                </div>

                {myBids.length === 0 ? (
                  <p className="text-muted text-sm">No active bids</p>
                ) : (
                  <div className="space-y-3">
                    {myBids.map((bid) => (
                      <Link key={bid.id} href={`/jobs/${bid.job_id}`} className="block p-3 border border-line rounded-lg hover:border-line-2 transition-colors">
                        <div className="flex justify-between items-start">
                          <div className="text-sm font-medium text-ink">Job #{bid.job_id}</div>
                          <div className="text-sm text-accent">{formatXpr(bid.amount)}</div>
                        </div>
                        <div className="text-xs text-muted mt-1">
                          {formatTimeline(bid.timeline)} timeline
                        </div>
                        <p className="text-xs text-muted mt-1 truncate" title={bid.proposal}>{bid.proposal}</p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Trust Score */}
              {trustScore && (
                <div className="bg-surface border border-line rounded-xl p-6">
                  <h2 className="text-lg font-semibold text-ink mb-4 text-center">Trust Score</h2>
                  <div className="flex justify-center">
                    <TrustBadge trustScore={trustScore} size="lg" showBreakdown />
                  </div>
                </div>
              )}

              {/* Quick Actions */}
              <div className="bg-surface border border-line rounded-xl p-6">
                <h2 className="text-lg font-semibold text-ink mb-4">Quick Actions</h2>
                <div className="space-y-2">
                  <Link
                    href={`/agent/${agent.account}`}
                    className="block w-full py-2 px-4 text-center border border-line-2 text-ink-2 rounded-lg hover:bg-surface-2"
                  >
                    View Profile
                  </Link>
                  <a
                    href="https://webauth.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full py-2 px-4 text-center border border-line-2 text-ink-2 rounded-lg hover:bg-surface-2"
                  >
                    Complete KYC
                  </a>
                </div>
              </div>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </>
  );
}

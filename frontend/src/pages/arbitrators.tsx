import { useState, useEffect } from 'react';
import Head from 'next/head';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { AccountLink } from '@/components/AccountLink';
import { useProton } from '@/hooks/useProton';
import { useToast } from '@/contexts/ToastContext';
import {
  CONTRACTS,
  formatXpr,
  formatDate,
  formatRelativeTime,
  getArbitrators,
  getArbitrator,
  getDisputes,
  getJob,
  getEscrowConfig,
  getArbUnstake,
  DISPUTE_RESOLUTION_LABELS,
  type Arbitrator,
  type Dispute,
  type Job,
  type EscrowConfig,
  type ArbUnstake,
} from '@/lib/registry';

type SortKey = 'success' | 'fee' | 'cases';

export default function Arbitrators() {
  const { session, transact } = useProton();
  const { addToast } = useToast();

  function getTxId(result: any): string | undefined {
    return result?.processed?.id;
  }

  // Directory state
  const [arbitrators, setArbitrators] = useState<Arbitrator[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('success');
  const [activeOnly, setActiveOnly] = useState(true);

  // My arbitrator panel
  const [myArbitrator, setMyArbitrator] = useState<Arbitrator | null>(null);
  const [myArbLoading, setMyArbLoading] = useState(false);
  const [config, setConfig] = useState<EscrowConfig | null>(null);
  const [myUnstake, setMyUnstake] = useState<ArbUnstake | null>(null);

  // Registration
  const [regFee, setRegFee] = useState('200'); // basis points default 2%

  // Stake
  const [stakeAmount, setStakeAmount] = useState('');

  // Active disputes for my arbitration
  const [myDisputes, setMyDisputes] = useState<{ dispute: Dispute; job: Job }[]>([]);
  const [disputesLoading, setDisputesLoading] = useState(false);

  // Resolve form
  const [resolveDispute, setResolveDispute] = useState<{ dispute: Dispute; job: Job } | null>(null);
  const [clientPercent, setClientPercent] = useState(50);
  const [resolutionNotes, setResolutionNotes] = useState('');

  // Set fee form
  const [showSetFee, setShowSetFee] = useState(false);
  const [newFee, setNewFee] = useState('');

  // Processing
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (session) loadMyArbitrator();
  }, [session]);

  async function loadData() {
    setLoading(true);
    try {
      const [arbs, cfg] = await Promise.all([
        getArbitrators(500),
        getEscrowConfig(),
      ]);
      setArbitrators(arbs);
      setConfig(cfg);
    } catch (e) {
      console.error('Failed to load arbitrators:', e);
    } finally {
      setLoading(false);
    }
  }

  async function loadMyArbitrator() {
    if (!session) return;
    setMyArbLoading(true);
    try {
      const [arb, unstake] = await Promise.all([
        getArbitrator(session.auth.actor),
        getArbUnstake(session.auth.actor),
      ]);
      setMyArbitrator(arb);
      setMyUnstake(unstake);
      if (arb) {
        setNewFee(String(arb.fee_percent));
      }
    } catch (e) {
      console.error('Failed to load my arbitrator:', e);
    } finally {
      setMyArbLoading(false);
    }

    // Load active disputes assigned to me
    loadMyDisputes();
  }

  async function loadMyDisputes() {
    if (!session) return;
    setDisputesLoading(true);
    try {
      const allDisputes = await getDisputes(500);
      const pending = allDisputes.filter(d => d.resolution === 0);

      // Find disputes where I'm the arbitrator (via job lookup)
      const disputeJobs: { dispute: Dispute; job: Job }[] = [];
      for (const d of pending) {
        const job = await getJob(d.job_id);
        if (job && (job.arbitrator === session.auth.actor || (job.arbitrator === '' && config?.owner === session.auth.actor))) {
          disputeJobs.push({ dispute: d, job });
        }
      }
      setMyDisputes(disputeJobs);
    } catch (e) {
      console.error('Failed to load disputes:', e);
    } finally {
      setDisputesLoading(false);
    }
  }

  // Sort/filter
  const filtered = arbitrators
    .filter(a => !activeOnly || a.active)
    .sort((a, b) => {
      if (sort === 'success') {
        const aRate = a.total_cases > 0 ? a.successful_cases / a.total_cases : 0;
        const bRate = b.total_cases > 0 ? b.successful_cases / b.total_cases : 0;
        return bRate - aRate;
      }
      if (sort === 'fee') return a.fee_percent - b.fee_percent;
      return b.total_cases - a.total_cases;
    });

  // Stats
  const activeCount = arbitrators.filter(a => a.active).length;
  const totalCases = arbitrators.reduce((s, a) => s + a.total_cases, 0);

  function successRate(arb: Arbitrator): string {
    if (arb.total_cases === 0) return '-';
    return ((arb.successful_cases / arb.total_cases) * 100).toFixed(0) + '%';
  }

  function feeDisplay(bp: number): string {
    return (bp / 100).toFixed(2) + '%';
  }

  // === Actions ===

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !config) return;
    setProcessing(true);
    try {
      const minStakeStr = `${(config.min_arbitrator_stake / 10000).toFixed(4)} XPR`;
      // Register first (creates row with stake=0), then stake
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'regarb',
          data: {
            account: session.auth.actor,
            fee_percent: parseInt(regFee),
          },
        },
        {
          account: 'eosio.token',
          name: 'transfer',
          data: {
            from: session.auth.actor,
            to: CONTRACTS.AGENT_ESCROW,
            quantity: minStakeStr,
            memo: 'arbstake',
          },
        },
      ]);
      addToast({ type: 'success', message: 'Registered as arbitrator!', txId: getTxId(result) });
      await new Promise(r => setTimeout(r, 1500));
      await Promise.all([loadData(), loadMyArbitrator()]);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Registration failed' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleStake(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setProcessing(true);
    try {
      const qty = `${parseFloat(stakeAmount).toFixed(4)} XPR`;
      const result = await transact([
        {
          account: 'eosio.token',
          name: 'transfer',
          data: {
            from: session.auth.actor,
            to: CONTRACTS.AGENT_ESCROW,
            quantity: qty,
            memo: 'arbstake',
          },
        },
      ]);
      addToast({ type: 'success', message: `Staked ${qty}`, txId: getTxId(result) });
      setStakeAmount('');
      await new Promise(r => setTimeout(r, 1500));
      await Promise.all([loadData(), loadMyArbitrator()]);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Staking failed' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleUnstake() {
    if (!session) return;
    setProcessing(true);
    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'unstakearb',
          data: { account: session.auth.actor },
        },
      ]);
      addToast({ type: 'success', message: 'Unstake requested', txId: getTxId(result) });
      await new Promise(r => setTimeout(r, 1500));
      await loadMyArbitrator();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Unstake failed' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleWithdrawUnstake() {
    if (!session) return;
    setProcessing(true);
    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'withdrawarb',
          data: { account: session.auth.actor },
        },
      ]);
      addToast({ type: 'success', message: 'Unstake withdrawn!', txId: getTxId(result) });
      await new Promise(r => setTimeout(r, 1500));
      await loadMyArbitrator();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Withdraw failed' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleCancelUnstake() {
    if (!session) return;
    setProcessing(true);
    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'cancelunstk',
          data: { account: session.auth.actor },
        },
      ]);
      addToast({ type: 'success', message: 'Unstake cancelled', txId: getTxId(result) });
      await new Promise(r => setTimeout(r, 1500));
      await loadMyArbitrator();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Cancel failed' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleToggleActive() {
    if (!session || !myArbitrator) return;
    setProcessing(true);
    try {
      const action = myArbitrator.active ? 'deactarb' : 'activatearb';
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: action,
          data: { account: session.auth.actor },
        },
      ]);
      addToast({ type: 'success', message: myArbitrator.active ? 'Deactivated' : 'Activated', txId: getTxId(result) });
      await new Promise(r => setTimeout(r, 1500));
      await Promise.all([loadData(), loadMyArbitrator()]);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Toggle failed' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleSetFee(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setProcessing(true);
    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'regarb',
          data: {
            account: session.auth.actor,
            fee_percent: parseInt(newFee),
          },
        },
      ]);
      addToast({ type: 'success', message: 'Fee updated!', txId: getTxId(result) });
      setShowSetFee(false);
      await new Promise(r => setTimeout(r, 1500));
      await Promise.all([loadData(), loadMyArbitrator()]);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Fee update failed' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleResolveDispute(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !resolveDispute) return;
    setProcessing(true);
    try {
      const { dispute, job } = resolveDispute;
      const totalAmount = job.funded_amount;
      const clientAmount = Math.floor(totalAmount * clientPercent / 100);
      const agentAmount = totalAmount - clientAmount;

      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'arbitrate',
          data: {
            arbitrator: session.auth.actor,
            dispute_id: dispute.id,
            client_amount: clientAmount,
            agent_amount: agentAmount,
            resolution_notes: resolutionNotes,
          },
        },
      ]);
      addToast({ type: 'success', message: `Dispute #${dispute.id} resolved!`, txId: getTxId(result) });
      setResolveDispute(null);
      setClientPercent(50);
      setResolutionNotes('');
      await new Promise(r => setTimeout(r, 1500));
      await loadMyDisputes();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Resolution failed' });
    } finally {
      setProcessing(false);
    }
  }

  return (
    <>
      <Head>
        <title>Arbitrators - XPR Agents</title>
        <meta name="description" content="Browse and manage arbitrators on XPR Network" />
      </Head>

      <div className="min-h-screen bg-zinc-950">
        <Header activePage="arbitrators" />

        <main className="max-w-6xl mx-auto px-4 py-8">
          {/* Hero */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Arbitrator Network</h1>
            <p className="text-zinc-400 mb-6">Arbitrators resolve disputes between clients and agents in escrow jobs</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <div className="text-2xl font-bold text-white truncate">{arbitrators.length}</div>
                <div className="text-sm text-zinc-500">Total Arbitrators</div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <div className="text-2xl font-bold text-emerald-400 truncate">{activeCount}</div>
                <div className="text-sm text-zinc-500">Active</div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <div className="text-2xl font-bold text-proton-purple truncate">{totalCases}</div>
                <div className="text-sm text-zinc-500">Total Cases</div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <div className="text-2xl font-bold text-white truncate">
                  {config ? formatXpr(config.min_arbitrator_stake) : '-'}
                </div>
                <div className="text-sm text-zinc-500">Min Stake</div>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="flex gap-1 bg-zinc-800 p-1 rounded-lg">
              {(['success', 'fee', 'cases'] as SortKey[]).map(k => (
                <button
                  key={k}
                  onClick={() => setSort(k)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                    sort === k
                      ? 'bg-zinc-700 text-white'
                      : 'text-zinc-400 hover:text-zinc-300'
                  }`}
                >
                  {k === 'success' ? 'Success Rate' : k === 'fee' ? 'Fee (Low)' : 'Cases'}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(e) => setActiveOnly(e.target.checked)}
                className="accent-proton-purple"
              />
              Active only
            </label>
          </div>

          {/* Grid layout: directory + panel */}
          <div className="flex flex-col-reverse lg:flex-row gap-6">
            {/* Directory */}
            <div className="flex-1 min-w-0">
              {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="p-4 rounded-xl border border-zinc-800 bg-zinc-900">
                      <div className="flex justify-between items-start mb-2">
                        <div className="h-4 w-24 skeleton-shimmer rounded" />
                        <div className="h-5 w-14 skeleton-shimmer rounded" />
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <div className="h-8 skeleton-shimmer rounded" />
                        <div className="h-8 skeleton-shimmer rounded" />
                        <div className="h-8 skeleton-shimmer rounded" />
                      </div>
                      <div className="h-3 w-32 skeleton-shimmer rounded mx-auto" />
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-zinc-500">
                  <p className="text-lg mb-2">No arbitrators found</p>
                  <p className="text-sm">Be the first to register as an arbitrator!</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filtered.map((a, i) => (
                    <div
                      key={a.account}
                      className="p-4 rounded-xl border border-zinc-800 bg-zinc-900 animate-stagger animate-fade-in-up"
                      style={{ animationDelay: `${Math.min(i, 11) * 50}ms` }}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <AccountLink account={a.account} className="font-medium truncate" />
                        {a.active ? (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-emerald-500/10 text-emerald-400">Active</span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-zinc-500/10 text-zinc-400">Inactive</span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <div className="text-sm font-bold text-proton-purple">{feeDisplay(a.fee_percent)}</div>
                          <div className="text-xs text-zinc-500">Fee</div>
                        </div>
                        <div>
                          <div className="text-sm font-bold text-white">{formatXpr(a.stake)}</div>
                          <div className="text-xs text-zinc-500">Staked</div>
                        </div>
                        <div>
                          <div className="text-sm font-bold text-emerald-400">{successRate(a)}</div>
                          <div className="text-xs text-zinc-500">Success</div>
                        </div>
                      </div>
                      <div className="text-xs text-zinc-500 mt-2 text-center">
                        {a.total_cases} cases ({a.successful_cases} successful)
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Side panel: My Arbitrator */}
            <div className="w-full lg:w-80 xl:w-96 shrink-0 space-y-6">
              {session && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                  <h3 className="font-bold text-white mb-4">My Arbitrator</h3>

                  {myArbLoading ? (
                    <div className="flex justify-center py-4">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-proton-purple"></div>
                    </div>
                  ) : !myArbitrator ? (
                    /* Registration form */
                    <div>
                      <p className="text-sm text-zinc-400 mb-3">
                        Become an arbitrator to resolve disputes.
                        {config && <span> Min stake: <strong className="text-white">{formatXpr(config.min_arbitrator_stake)}</strong></span>}
                      </p>
                      <form onSubmit={handleRegister} className="space-y-3">
                        <div>
                          <label className="block text-xs text-zinc-400 mb-1">Fee (basis points, e.g. 200 = 2%)</label>
                          <input
                            type="number"
                            value={regFee}
                            onChange={(e) => setRegFee(e.target.value)}
                            min="0"
                            max="500"
                            required
                            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg text-sm"
                          />
                          <p className="text-xs text-zinc-500 mt-1">
                            {regFee ? `${(parseInt(regFee) / 100).toFixed(2)}% of disputed amount` : ''}
                          </p>
                        </div>
                        <button
                          type="submit"
                          disabled={processing}
                          className="w-full px-4 py-2 bg-proton-purple text-white rounded-lg text-sm hover:bg-purple-700 disabled:bg-zinc-700 disabled:text-zinc-500"
                        >
                          {processing ? 'Registering...' : 'Register & Stake'}
                        </button>
                      </form>
                    </div>
                  ) : (
                    /* Management */
                    <div className="space-y-4">
                      {/* Stats */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-zinc-800 rounded-lg p-2 text-center">
                          <div className="text-sm font-bold text-white">{formatXpr(myArbitrator.stake)}</div>
                          <div className="text-xs text-zinc-500">Staked</div>
                        </div>
                        <div className="bg-zinc-800 rounded-lg p-2 text-center">
                          <div className="text-sm font-bold text-proton-purple">{feeDisplay(myArbitrator.fee_percent)}</div>
                          <div className="text-xs text-zinc-500">Fee</div>
                        </div>
                        <div className="bg-zinc-800 rounded-lg p-2 text-center">
                          <div className="text-sm font-bold text-white">{myArbitrator.total_cases}</div>
                          <div className="text-xs text-zinc-500">Total Cases</div>
                        </div>
                        <div className="bg-zinc-800 rounded-lg p-2 text-center">
                          <div className="text-sm font-bold text-emerald-400">{successRate(myArbitrator)}</div>
                          <div className="text-xs text-zinc-500">Success Rate</div>
                        </div>
                      </div>

                      {/* Activate / Deactivate */}
                      <button
                        onClick={handleToggleActive}
                        disabled={processing}
                        className={`w-full px-4 py-2 rounded-lg text-sm font-medium ${
                          myArbitrator.active
                            ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                            : 'bg-emerald-600 text-white hover:bg-emerald-700'
                        } disabled:opacity-50`}
                      >
                        {myArbitrator.active ? 'Deactivate' : 'Activate'}
                      </button>

                      {/* Stake */}
                      <form onSubmit={handleStake} className="flex gap-2">
                        <input
                          type="number"
                          value={stakeAmount}
                          onChange={(e) => setStakeAmount(e.target.value)}
                          placeholder="XPR"
                          min="0"
                          step="0.0001"
                          required
                          className="flex-1 px-2 py-1.5 bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg text-xs"
                        />
                        <button
                          type="submit"
                          disabled={processing}
                          className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Stake
                        </button>
                      </form>

                      {/* Unstake */}
                      {!myUnstake ? (
                        <button
                          onClick={handleUnstake}
                          disabled={processing}
                          className="w-full px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
                        >
                          Request Unstake
                        </button>
                      ) : (
                        <div className="p-3 bg-zinc-800 rounded-lg">
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-zinc-400">Unstaking</span>
                            <span className="text-white">{formatXpr(myUnstake.amount)}</span>
                          </div>
                          {(() => {
                            const now = Math.floor(Date.now() / 1000);
                            const canWithdraw = now >= myUnstake.available_at;
                            const remaining = myUnstake.available_at - now;
                            const days = Math.ceil(remaining / 86400);
                            return (
                              <>
                                <div className="text-xs text-zinc-500 mb-2">
                                  {canWithdraw ? 'Ready to withdraw' : `${days}d remaining`}
                                </div>
                                <div className="flex gap-2">
                                  {canWithdraw && (
                                    <button
                                      onClick={handleWithdrawUnstake}
                                      disabled={processing}
                                      className="text-xs px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                      Withdraw
                                    </button>
                                  )}
                                  <button
                                    onClick={handleCancelUnstake}
                                    disabled={processing}
                                    className="text-xs px-3 py-1 border border-zinc-700 text-zinc-300 rounded hover:bg-zinc-700 disabled:opacity-50"
                                  >
                                    Cancel Unstake
                                  </button>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )}

                      {/* Set Fee */}
                      {!showSetFee ? (
                        <button
                          onClick={() => setShowSetFee(true)}
                          className="w-full text-sm text-zinc-400 hover:text-white py-1"
                        >
                          Change Fee
                        </button>
                      ) : (
                        <form onSubmit={handleSetFee} className="p-3 bg-zinc-800 rounded-lg space-y-2">
                          <div>
                            <label className="block text-xs text-zinc-400 mb-1">Fee (basis points)</label>
                            <input
                              type="number"
                              value={newFee}
                              onChange={(e) => setNewFee(e.target.value)}
                              min="0"
                              max="500"
                              required
                              className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-700 text-white rounded text-sm"
                            />
                            <p className="text-xs text-zinc-500 mt-1">
                              {newFee ? `${(parseInt(newFee) / 100).toFixed(2)}%` : ''}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button type="submit" disabled={processing} className="px-3 py-1.5 bg-proton-purple text-white rounded text-xs hover:bg-purple-700 disabled:opacity-50">
                              Save
                            </button>
                            <button type="button" onClick={() => setShowSetFee(false)} className="px-3 py-1.5 border border-zinc-700 text-zinc-300 rounded text-xs">
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}

                      {/* Active Disputes */}
                      <div className="border-t border-zinc-800 pt-4">
                        <h4 className="text-sm font-medium text-white mb-3">
                          Active Disputes {!disputesLoading && `(${myDisputes.length})`}
                        </h4>
                        {disputesLoading ? (
                          <div className="flex justify-center py-4">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-proton-purple"></div>
                          </div>
                        ) : myDisputes.length === 0 ? (
                          <p className="text-sm text-zinc-500">No pending disputes</p>
                        ) : (
                          <div className="space-y-3">
                            {myDisputes.map(({ dispute, job }) => (
                              <div key={dispute.id} className="p-3 bg-zinc-800 rounded-lg">
                                <div className="flex justify-between items-start mb-1">
                                  <div className="text-sm font-medium text-white">
                                    Job #{dispute.job_id}: {job.title}
                                  </div>
                                </div>
                                <div className="text-xs text-zinc-500 mb-1 flex items-center gap-1 flex-wrap">
                                  Raised by: <AccountLink account={dispute.raised_by} className="text-xs" /> &middot; <span title={formatDate(dispute.created_at)}>{formatRelativeTime(dispute.created_at)}</span>
                                </div>
                                <p className="text-sm text-zinc-400 mb-1">{dispute.reason}</p>
                                <div className="text-xs text-zinc-500 mb-2">
                                  Amount at stake: {formatXpr(job.funded_amount)}
                                </div>
                                {dispute.evidence_uri && (
                                  <div className="text-xs text-zinc-500 mb-2 break-all">
                                    Evidence: {dispute.evidence_uri}
                                  </div>
                                )}
                                {resolveDispute?.dispute.id === dispute.id ? (
                                  <form onSubmit={handleResolveDispute} className="space-y-2 mt-2 p-2 bg-zinc-900 rounded">
                                    <div>
                                      <label className="block text-xs text-zinc-400 mb-1">
                                        Client: {clientPercent}% ({formatXpr(Math.floor(job.funded_amount * clientPercent / 100))})
                                        &mdash; Agent: {100 - clientPercent}% ({formatXpr(job.funded_amount - Math.floor(job.funded_amount * clientPercent / 100))})
                                      </label>
                                      <input
                                        type="range"
                                        value={clientPercent}
                                        onChange={(e) => setClientPercent(parseInt(e.target.value))}
                                        min="0"
                                        max="100"
                                        className="w-full accent-proton-purple"
                                      />
                                    </div>
                                    <textarea
                                      value={resolutionNotes}
                                      onChange={(e) => setResolutionNotes(e.target.value)}
                                      required
                                      rows={2}
                                      placeholder="Resolution notes..."
                                      className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded text-sm"
                                    />
                                    <div className="flex gap-2">
                                      <button type="submit" disabled={processing} className="px-3 py-1 bg-proton-purple text-white rounded text-xs hover:bg-purple-700 disabled:opacity-50">
                                        {processing ? 'Resolving...' : 'Resolve'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setResolveDispute(null)}
                                        className="px-3 py-1 border border-zinc-700 text-zinc-300 rounded text-xs"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </form>
                                ) : (
                                  <button
                                    onClick={() => {
                                      setResolveDispute({ dispute, job });
                                      setClientPercent(50);
                                      setResolutionNotes('');
                                    }}
                                    className="text-xs px-3 py-1 bg-proton-purple text-white rounded hover:bg-purple-700"
                                  >
                                    Resolve
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </>
  );
}

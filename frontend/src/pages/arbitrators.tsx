import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SiteHead } from '@/components/SiteHead';
import { AccountLink } from '@/components/AccountLink';
import { AccountAvatar } from '@/components/AccountAvatar';
import { Modal, Field, inputClass } from '@/components/Modal';
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
  type Arbitrator,
  type Dispute,
  type Job,
  type EscrowConfig,
  type ArbUnstake,
  isEmptyName,
} from '@/lib/registry';

type SortKey = 'success' | 'fee' | 'cases';

/** Fee is stored on chain in basis points; the UI works in percent. */
function bpsToPercent(bp: number): string {
  return `${parseFloat((bp / 100).toFixed(2))}%`;
}
function percentToBps(pct: string): number {
  return Math.round(parseFloat(pct) * 100);
}
function formatRemaining(seconds: number): string {
  if (seconds >= 86400) { const d = Math.ceil(seconds / 86400); return `${d} day${d === 1 ? '' : 's'}`; }
  if (seconds >= 3600) { const h = Math.ceil(seconds / 3600); return `${h} hour${h === 1 ? '' : 's'}`; }
  return 'under an hour';
}
function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

export default function Arbitrators() {
  const { session, transact, login } = useProton();
  const { addToast } = useToast();

  function getTxId(result: any): string | undefined {
    return result?.processed?.id;
  }

  // Directory state
  const [arbitrators, setArbitrators] = useState<Arbitrator[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('success');
  const [activeOnly, setActiveOnly] = useState(true);
  const [search, setSearch] = useState('');

  // My arbitrator panel
  const [myArbitrator, setMyArbitrator] = useState<Arbitrator | null>(null);
  const [myArbLoading, setMyArbLoading] = useState(false);
  const [config, setConfig] = useState<EscrowConfig | null>(null);
  const [myUnstake, setMyUnstake] = useState<ArbUnstake | null>(null);

  // Registration (fee entered as a percentage, converted to basis points on submit)
  const [regFee, setRegFee] = useState('2');

  // Stake
  const [stakeAmount, setStakeAmount] = useState('');

  // Active disputes for my arbitration
  const [myDisputes, setMyDisputes] = useState<{ dispute: Dispute; job: Job }[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [disputesLoading, setDisputesLoading] = useState(false);

  // Resolve form
  const [resolveDispute, setResolveDispute] = useState<{ dispute: Dispute; job: Job } | null>(null);
  const [clientPercent, setClientPercent] = useState(50);
  const [resolutionNotes, setResolutionNotes] = useState('');

  // Set fee form (percentage string)
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
      const [arbs, cfg, allDisputes] = await Promise.all([
        getArbitrators(500),
        getEscrowConfig(),
        getDisputes(500).catch(() => [] as Dispute[]),
      ]);
      setArbitrators(arbs);
      setConfig(cfg);
      setDisputes(allDisputes);
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
        setNewFee(String(parseFloat((arb.fee_percent / 100).toFixed(2))));
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
        if (job && (job.arbitrator === session.auth.actor || (isEmptyName(job.arbitrator) && config?.owner === session.auth.actor))) {
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

  // The contract only increments an arbitrator's counters when the job named
  // them. Disputes on jobs without an arbitrator are resolved by the registry
  // owner and leave every counter at zero, so derive case counts from the
  // dispute records themselves and show whichever is higher.
  const resolvedDisputes = disputes.filter(d => d.resolution !== 0).sort((a, b) => b.resolved_at - a.resolved_at);
  const openDisputes = disputes.filter(d => d.resolution === 0);
  const resolvedBy: Record<string, number> = {};
  for (const d of resolvedDisputes) resolvedBy[d.resolver] = (resolvedBy[d.resolver] || 0) + 1;
  const casesFor = (a: Arbitrator) => Math.max(a.total_cases, resolvedBy[a.account] || 0);
  const outcomeLabel = (d: Dispute) => d.resolution === 1 ? 'Client refunded' : d.resolution === 2 ? 'Agent paid' : d.resolution === 3 ? 'Split' : 'Pending';
  const outcomeTone = (d: Dispute) => d.resolution === 1 ? 'text-warn' : d.resolution === 2 ? 'text-good' : 'text-ink-2';

  // Sort/filter
  const query = search.trim().toLowerCase();
  const filtered = arbitrators
    .filter(a => !activeOnly || a.active)
    .filter(a => !query || a.account.includes(query))
    .sort((a, b) => {
      if (sort === 'success') {
        const aRate = a.total_cases > 0 ? a.successful_cases / a.total_cases : 0;
        const bRate = b.total_cases > 0 ? b.successful_cases / b.total_cases : 0;
        return bRate - aRate || casesFor(b) - casesFor(a);
      }
      if (sort === 'fee') return a.fee_percent - b.fee_percent;
      return casesFor(b) - casesFor(a);
    });

  // Stats
  const activeCount = arbitrators.filter(a => a.active).length;
  const totalCases = Math.max(arbitrators.reduce((s, a) => s + a.total_cases, 0), resolvedDisputes.length);
  const minStake = config ? formatXpr(config.min_arbitrator_stake) : null;
  const unstakeDays = config ? Math.max(1, Math.round(config.arb_unstake_delay / 86400)) : null;

  function successRate(arb: Arbitrator): string {
    if (arb.total_cases === 0) return '-';
    return ((arb.successful_cases / arb.total_cases) * 100).toFixed(0) + '%';
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
            fee_percent: percentToBps(regFee),
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
    if (!session || !myArbitrator) return;
    setProcessing(true);
    try {
      // unstakearb(account, amount) — the page withdraws the full stake.
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'unstakearb',
          data: { account: session.auth.actor, amount: myArbitrator.stake },
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
            fee_percent: percentToBps(newFee),
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
      const { dispute } = resolveDispute;

      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'arbitrate',
          data: {
            arbitrator: session.auth.actor,
            dispute_id: dispute.id,
            // The contract takes a percentage (0-100) and splits funded_amount itself.
            client_percent: clientPercent,
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

  const openResolve = (entry: { dispute: Dispute; job: Job }) => {
    setResolveDispute(entry);
    setClientPercent(50);
    setResolutionNotes('');
  };

  const rowGrid = 'sm:grid-cols-[minmax(0,1fr)_5.5rem_7.5rem_7.5rem]';
  const statValue = 'min-w-0 break-words font-mono text-sm tabular text-ink sm:text-right';
  const statCell = 'flex min-w-0 items-baseline justify-between gap-2 sm:block';

  const clientAmount = resolveDispute ? Math.floor(resolveDispute.job.funded_amount * clientPercent / 100) : 0;
  const agentAmount = resolveDispute ? resolveDispute.job.funded_amount - clientAmount : 0;

  return (
    <>
      <SiteHead
        title="Arbitrators"
        description="Staked arbitrators who resolve escrow disputes between clients and agents on XPR Network."
        path="/arbitrators"
      />

      <div className="min-h-screen bg-canvas">
        <Header activePage="arbitrators" />

        <main className="mx-auto max-w-6xl px-4 py-10">
          {/* Page header */}
          <div className="mb-8">
            <p className="label mb-2">Registry</p>
            <h1 className="font-display text-3xl font-semibold text-ink">Arbitrators</h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-2">
              Arbitrators stake XPR and resolve escrow disputes between clients and agents for a fee.
              {unstakeDays !== null && <> Withdrawing a stake takes <span className="tabular">{unstakeDays}</span> days.</>}
            </p>
            <p className="mt-2 text-sm text-ink-2">
              {loading ? 'Loading…' : (
                <>
                  <span className="tabular">{arbitrators.length}</span> registered ·{' '}
                  <span className="tabular">{activeCount}</span> active ·{' '}
                  <span className="tabular">{totalCases}</span> case{totalCases === 1 ? '' : 's'} resolved ·{' '}
                  <span className="tabular">{openDisputes.length}</span> open
                </>
              )}
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-12">
            {/* Directory */}
            <section className="min-w-0 lg:col-span-8" aria-labelledby="directory-heading">
              <h2 id="directory-heading" className="sr-only">Arbitrator directory</h2>

              {/* Controls */}
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="relative min-w-0 flex-1 basis-56">
                  <label htmlFor="arb-search" className="sr-only">Search by account</label>
                  <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M20 20l-3.5-3.5" />
                  </svg>
                  <input
                    id="arb-search"
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by account"
                    autoComplete="off"
                    spellCheck={false}
                    className={`${inputClass} pl-9 font-mono`}
                  />
                </div>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  aria-label="Sort arbitrators"
                  className="rounded-md border border-line-2 bg-canvas px-3 py-2 text-sm text-ink-2"
                >
                  <option value="success">Highest success rate</option>
                  <option value="fee">Lowest fee</option>
                  <option value="cases">Most cases</option>
                </select>
                <label htmlFor="arb-active-only" className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                  <input
                    id="arb-active-only"
                    type="checkbox"
                    checked={activeOnly}
                    onChange={(e) => setActiveOnly(e.target.checked)}
                    className="accent-accent"
                  />
                  Active only
                </label>
              </div>

              {/* List */}
              <div className="rounded-xl border border-line bg-canvas">
                <div className={`hidden gap-3 border-b border-line px-5 py-2.5 sm:grid ${rowGrid}`}>
                  <span className="label">Arbitrator</span>
                  <span className="label text-right">Fee</span>
                  <span className="label text-right">Stake</span>
                  <span className="label text-right">Cases</span>
                </div>

                {loading ? (
                  <div className="divide-y divide-line">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-4 px-5 py-4">
                        <div className="h-8 w-8 shrink-0 skeleton-shimmer rounded-full" />
                        <div className="flex-1 space-y-2"><div className="h-4 w-32 skeleton-shimmer rounded" /><div className="h-3 w-20 skeleton-shimmer rounded" /></div>
                        <div className="hidden h-4 w-12 skeleton-shimmer rounded sm:block" />
                        <div className="hidden h-4 w-20 skeleton-shimmer rounded sm:block" />
                        <div className="hidden h-4 w-16 skeleton-shimmer rounded sm:block" />
                      </div>
                    ))}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="px-6 py-16 text-center">
                    <p className="font-display text-lg font-semibold text-ink">
                      {arbitrators.length === 0 ? 'No arbitrators yet' : 'No arbitrators match'}
                    </p>
                    <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">
                      {arbitrators.length === 0
                        ? 'Nobody has registered yet. Connect a wallet and register from the panel to be the first.'
                        : query
                          ? <>No account contains <span className="font-mono text-ink">{query}</span>. Clear the search{activeOnly ? ' or include inactive arbitrators' : ''}.</>
                          : 'Every registered arbitrator is currently inactive. Untick "Active only" to see them.'}
                    </p>
                    {(query || activeOnly) && arbitrators.length > 0 && (
                      <button
                        onClick={() => { setSearch(''); setActiveOnly(false); }}
                        className="mt-6 rounded-md border border-line-2 px-4 py-2 text-sm text-ink-2 hover:bg-surface"
                      >
                        Show all arbitrators
                      </button>
                    )}
                  </div>
                ) : (
                  <ol className="divide-y divide-line">
                    {filtered.map((a) => (
                      <li key={a.account} className={`grid gap-3 px-5 py-4 sm:items-center ${rowGrid}`}>
                        <div className="flex min-w-0 items-center gap-3">
                          <AccountAvatar account={a.account} size={32} className="shrink-0" />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <AccountLink account={a.account} className="min-w-0 break-words font-mono text-sm text-ink" />
                              {a.active ? (
                                <span className="rounded bg-good-soft px-1.5 py-0.5 text-[11px] font-medium text-good">Active</span>
                              ) : (
                                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">Inactive</span>
                              )}
                            </div>
                            <div className="mt-0.5 text-xs text-muted">
                              {casesFor(a) === 0
                                ? 'No cases yet'
                                : a.total_cases > 0
                                  ? <><span className="font-mono tabular">{a.successful_cases}</span> of <span className="font-mono tabular">{a.total_cases}</span> resolved successfully</>
                                  : <><span className="font-mono tabular">{casesFor(a)}</span> dispute{casesFor(a) === 1 ? '' : 's'} resolved as registry owner</>}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 sm:contents sm:gap-3">
                          <div className={statCell}>
                            <span className="label sm:hidden">Fee</span>
                            <span className={statValue}>{bpsToPercent(a.fee_percent)}</span>
                          </div>
                          <div className={statCell}>
                            <span className="label sm:hidden">Stake</span>
                            <span className={statValue}>{formatXpr(a.stake)}</span>
                          </div>
                          <div className={statCell}>
                            <span className="label sm:hidden">Cases</span>
                            <span className={statValue}>
                              {a.total_cases}
                              {a.total_cases > 0 && <span className="text-muted"> · {successRate(a)}</span>}
                            </span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              {!loading && filtered.length > 0 && (
                <p className="mt-3 text-xs text-muted">
                  Showing <span className="tabular">{filtered.length}</span> of <span className="tabular">{arbitrators.length}</span> arbitrators.
                  {' '}Clients choose an arbitrator when they post a job; disputes on jobs without one go to the registry owner.
                </p>
              )}

              <div className="mt-8" aria-labelledby="arbitrations-heading">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id="arbitrations-heading" className="font-display text-lg font-semibold text-ink">Recent arbitrations</h2>
                  <span className="font-mono text-xs tabular text-muted">{resolvedDisputes.length} resolved · {openDisputes.length} open</span>
                </div>
                {resolvedDisputes.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">No disputes have been resolved yet.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
                    {resolvedDisputes.slice(0, 12).map(d => (
                      <li key={d.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-4">
                        <div className="font-mono text-xs tabular text-muted">#{d.id}</div>
                        <div className="min-w-0">
                          <div className="text-sm text-ink">
                            <Link href={`/jobs/${d.job_id}`} className="font-medium text-accent hover:underline">Job #{d.job_id}</Link>
                            {' '}raised by <span className="font-mono">{d.raised_by}</span>, resolved by{' '}
                            <Link href={`/agent/${d.resolver}`} className="font-mono text-ink hover:underline">{d.resolver}</Link>
                          </div>
                          {d.resolution_notes && <div className="mt-0.5 truncate text-xs text-muted">{d.resolution_notes}</div>}
                        </div>
                        <div className="text-left sm:text-right">
                          <div className={`text-sm font-medium ${outcomeTone(d)}`}>{outcomeLabel(d)}</div>
                          <div className="font-mono text-[11px] tabular text-muted">
                            {d.resolution === 3 ? `${formatXpr(d.client_amount)} / ${formatXpr(d.agent_amount)}` : formatXpr(d.resolution === 1 ? d.client_amount : d.agent_amount)}
                            {d.resolved_at ? ` · ${new Date(d.resolved_at * 1000).toISOString().slice(0, 10)}` : ''}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {/* Side panel */}
            <aside className={`min-w-0 lg:col-span-4 ${myArbitrator ? 'order-first lg:order-none' : ''}`}>
              <div className="space-y-4 lg:sticky lg:top-20">
                {!session ? (
                  <>
                    <div className="rounded-xl border border-line bg-canvas p-5">
                      <h2 className="font-display text-lg font-semibold text-ink">Become an arbitrator</h2>
                      <p className="mt-1 text-sm text-ink-2">
                        Connect a wallet to register, stake and take on dispute cases.
                      </p>
                      <button
                        onClick={login}
                        className="mt-4 w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-canvas transition-colors hover:bg-ink/85"
                      >
                        Connect wallet
                      </button>
                    </div>
                    <HowItWorks minStake={minStake} unstakeDays={unstakeDays} />
                  </>
                ) : myArbLoading ? (
                  <div className="rounded-xl border border-line bg-canvas p-5">
                    <div className="h-5 w-40 skeleton-shimmer rounded" />
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 skeleton-shimmer rounded" />)}
                    </div>
                  </div>
                ) : !myArbitrator ? (
                  <>
                    <div className="rounded-xl border border-line bg-canvas p-5">
                      <h2 className="font-display text-lg font-semibold text-ink">Register as an arbitrator</h2>
                      <p className="mt-1 text-sm text-ink-2">
                        Registering as <span className="font-mono text-ink">{session.auth.actor}</span>
                        {minStake && <> stakes <span className="font-mono tabular text-ink">{minStake}</span> from your wallet in the same transaction.</>}
                      </p>
                      <form onSubmit={handleRegister} className="mt-4 space-y-4">
                        <Field
                          label="Fee (% of the disputed amount)"
                          htmlFor="arb-reg-fee"
                          hint={regFee && !isNaN(parseFloat(regFee))
                            ? `You keep ${bpsToPercent(percentToBps(regFee))} of the escrowed amount on each dispute you resolve. Maximum 5%.`
                            : 'Charged on the escrowed amount when you resolve a dispute. Maximum 5%.'}
                          required
                        >
                          <input
                            id="arb-reg-fee"
                            type="number"
                            inputMode="decimal"
                            value={regFee}
                            onChange={(e) => setRegFee(e.target.value)}
                            min="0"
                            max="5"
                            step="0.01"
                            placeholder="2"
                            required
                            className={`${inputClass} font-mono`}
                          />
                        </Field>
                        <button
                          type="submit"
                          disabled={processing || !config}
                          className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:bg-line disabled:text-muted"
                        >
                          {processing ? 'Registering…' : minStake ? `Register and stake ${minStake}` : 'Register'}
                        </button>
                      </form>
                    </div>
                    <HowItWorks minStake={minStake} unstakeDays={unstakeDays} />
                  </>
                ) : (
                  <>
                    {/* Your arbitration */}
                    <div className="rounded-xl border border-line bg-canvas">
                      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                        <span className="label">Your arbitration</span>
                        {myArbitrator.active ? (
                          <span className="rounded bg-good-soft px-1.5 py-0.5 text-[11px] font-medium text-good">Active</span>
                        ) : (
                          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">Inactive</span>
                        )}
                      </div>

                      <div className="px-5 py-4">
                        <AccountLink account={myArbitrator.account} showAvatar avatarSize={28} className="min-w-0 break-words font-mono text-sm text-ink" />
                      </div>

                      <dl className="grid grid-cols-2 divide-x divide-line border-y border-line">
                        <div className="px-5 py-3">
                          <dt className="label">Staked</dt>
                          <dd className="mt-1 font-mono text-sm tabular text-ink">{formatXpr(myArbitrator.stake)}</dd>
                        </div>
                        <div className="px-5 py-3">
                          <dt className="label">Fee</dt>
                          <dd className="mt-1 font-mono text-sm tabular text-ink">{bpsToPercent(myArbitrator.fee_percent)}</dd>
                        </div>
                        <div className="border-t border-line px-5 py-3">
                          <dt className="label">Cases</dt>
                          <dd className="mt-1 font-mono text-sm tabular text-ink">{casesFor(myArbitrator)}</dd>
                        </div>
                        <div className="border-t border-line px-5 py-3">
                          <dt className="label">Success rate</dt>
                          <dd className="mt-1 font-mono text-sm tabular text-ink">{successRate(myArbitrator)}</dd>
                        </div>
                      </dl>

                      <div className="space-y-4 p-4">
                        {/* Activate / Deactivate */}
                        <div>
                          <button
                            onClick={handleToggleActive}
                            disabled={processing}
                            className={`w-full rounded-md px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                              myArbitrator.active
                                ? 'border border-line-2 text-ink hover:bg-surface'
                                : 'bg-good text-white hover:bg-good/90'
                            }`}
                          >
                            {myArbitrator.active ? 'Stop taking new cases' : 'Start taking cases'}
                          </button>
                          <p className="mt-1.5 text-xs text-muted">
                            {myArbitrator.active
                              ? 'Clients can pick you when they post a job. Disputes already assigned to you stay yours.'
                              : 'You are hidden from clients until you activate.'}
                          </p>
                        </div>

                        {/* Stake */}
                        <form onSubmit={handleStake}>
                          <Field label="Add stake" htmlFor="arb-stake-amount" hint={minStake ? `Minimum to stay eligible: ${minStake}.` : undefined}>
                            <div className="flex gap-2">
                              <input
                                id="arb-stake-amount"
                                type="number"
                                inputMode="decimal"
                                value={stakeAmount}
                                onChange={(e) => setStakeAmount(e.target.value)}
                                placeholder="Amount in XPR"
                                min="0"
                                step="0.0001"
                                required
                                className={`${inputClass} min-w-0 font-mono`}
                              />
                              <button
                                type="submit"
                                disabled={processing}
                                className="shrink-0 rounded-md bg-ink px-4 py-2 text-sm font-medium text-canvas transition-colors hover:bg-ink/85 disabled:opacity-50"
                              >
                                Stake
                              </button>
                            </div>
                          </Field>
                        </form>

                        {/* Unstake */}
                        {!myUnstake ? (
                          <div>
                            <button
                              onClick={handleUnstake}
                              disabled={processing || myArbitrator.active}
                              className="w-full rounded-md border border-line-2 px-4 py-2.5 text-sm font-medium text-crit transition-colors hover:border-crit disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Withdraw stake
                            </button>
                            <p className="mt-1.5 text-xs text-muted">
                              {myArbitrator.active
                                ? 'Stop taking new cases first. You also need no open disputes.'
                                : <>Starts a {unstakeDays !== null ? <><span className="tabular">{unstakeDays}</span>-day</> : 'timed'} wait, after which you can move the XPR back to your wallet. You can cancel while waiting.</>}
                            </p>
                          </div>
                        ) : (() => {
                          const now = Math.floor(Date.now() / 1000);
                          const canWithdraw = now >= myUnstake.available_at;
                          const remaining = myUnstake.available_at - now;
                          return (
                            <div className="rounded-lg border border-line bg-surface p-4">
                              <div className="flex items-baseline justify-between gap-3">
                                <span className="label">Withdrawing</span>
                                <span className="font-mono text-sm tabular text-ink">{formatXpr(myUnstake.amount)}</span>
                              </div>
                              <p className={`mt-1 text-xs ${canWithdraw ? 'text-good' : 'text-muted'}`} title={formatDate(myUnstake.available_at)}>
                                {canWithdraw ? 'Ready to withdraw to your wallet.' : `Available in ${formatRemaining(remaining)}.`}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {canWithdraw && (
                                  <button
                                    onClick={handleWithdrawUnstake}
                                    disabled={processing}
                                    className="rounded-md bg-good px-3 py-1.5 text-xs font-medium text-white hover:bg-good/90 disabled:opacity-50"
                                  >
                                    Withdraw to wallet
                                  </button>
                                )}
                                <button
                                  onClick={handleCancelUnstake}
                                  disabled={processing}
                                  className="rounded-md border border-line-2 px-3 py-1.5 text-xs text-ink-2 hover:bg-canvas disabled:opacity-50"
                                >
                                  Keep staked
                                </button>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Fee */}
                        {!showSetFee ? (
                          <button
                            onClick={() => setShowSetFee(true)}
                            className="w-full rounded-md border border-line-2 px-4 py-2 text-sm text-ink-2 transition-colors hover:bg-surface"
                          >
                            Change fee
                          </button>
                        ) : (
                          <form onSubmit={handleSetFee} className="rounded-lg border border-line bg-surface p-4">
                            <Field
                              label="Fee (% of the disputed amount)"
                              htmlFor="arb-new-fee"
                              hint={newFee && !isNaN(parseFloat(newFee)) ? `Charged as ${bpsToPercent(percentToBps(newFee))} on future resolutions. Maximum 5%.` : 'Maximum 5%.'}
                              required
                            >
                              <input
                                id="arb-new-fee"
                                type="number"
                                inputMode="decimal"
                                value={newFee}
                                onChange={(e) => setNewFee(e.target.value)}
                                min="0"
                                max="5"
                                step="0.01"
                                required
                                className={`${inputClass} font-mono`}
                              />
                            </Field>
                            <div className="mt-3 flex gap-2">
                              <button type="submit" disabled={processing} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:bg-line disabled:text-muted">
                                {processing ? 'Saving…' : 'Save fee'}
                              </button>
                              <button type="button" onClick={() => setShowSetFee(false)} className="rounded-md border border-line-2 px-3 py-1.5 text-xs text-ink-2 hover:bg-canvas">
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    </div>

                    {/* Active disputes */}
                    <div className="rounded-xl border border-line bg-canvas">
                      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                        <span className="label">Disputes waiting on you</span>
                        {!disputesLoading && <span className="font-mono text-xs tabular text-muted">{myDisputes.length}</span>}
                      </div>
                      {disputesLoading ? (
                        <div className="space-y-3 p-5">
                          <div className="h-4 w-2/3 skeleton-shimmer rounded" />
                          <div className="h-3 w-full skeleton-shimmer rounded" />
                          <div className="h-3 w-1/2 skeleton-shimmer rounded" />
                        </div>
                      ) : myDisputes.length === 0 ? (
                        <p className="px-5 py-6 text-sm text-ink-2">
                          Nothing to resolve right now. When a client or agent disputes a job that names you as arbitrator, it appears here.
                        </p>
                      ) : (
                        <ul className="divide-y divide-line">
                          {myDisputes.map(({ dispute, job }) => (
                            <li key={dispute.id} className="min-w-0 px-5 py-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-xs text-muted">Dispute #{dispute.id}</span>
                                <span className="font-mono text-xs text-muted" title={formatDate(dispute.created_at)}>{formatRelativeTime(dispute.created_at)}</span>
                              </div>
                              <Link href={`/jobs/${job.id}`} className="mt-1 block break-words text-[15px] font-medium text-ink hover:text-accent">
                                {job.title}
                              </Link>
                              <p className="mt-1 break-words text-sm text-ink-2">{dispute.reason}</p>
                              <dl className="mt-3 space-y-1 text-xs">
                                <div className="flex justify-between gap-3">
                                  <dt className="text-muted">Raised by</dt>
                                  <dd className="min-w-0 break-words text-right"><AccountLink account={dispute.raised_by} className="font-mono" /></dd>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <dt className="text-muted">In escrow</dt>
                                  <dd className="font-mono tabular text-ink">{formatXpr(job.funded_amount)}</dd>
                                </div>
                                {dispute.evidence_uri && (
                                  <div className="flex justify-between gap-3">
                                    <dt className="shrink-0 text-muted">Evidence link</dt>
                                    <dd className="min-w-0 break-all text-right">
                                      {isHttpUrl(dispute.evidence_uri) ? (
                                        <a href={dispute.evidence_uri} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{dispute.evidence_uri}</a>
                                      ) : (
                                        <span className="font-mono text-ink-2">{dispute.evidence_uri}</span>
                                      )}
                                    </dd>
                                  </div>
                                )}
                              </dl>
                              <button
                                onClick={() => openResolve({ dispute, job })}
                                className="mt-3 w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                              >
                                Resolve dispute
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </div>
            </aside>
          </div>
        </main>

        <Footer />
      </div>

      {/* Resolve dispute */}
      <Modal
        open={!!resolveDispute}
        onClose={() => setResolveDispute(null)}
        title={resolveDispute ? `Resolve dispute #${resolveDispute.dispute.id}` : 'Resolve dispute'}
        description={resolveDispute ? `Job #${resolveDispute.job.id} · ${resolveDispute.job.title} · ${formatXpr(resolveDispute.job.funded_amount)} in escrow. The split is final once submitted.` : undefined}
      >
        {resolveDispute && (
          <form onSubmit={handleResolveDispute} className="space-y-5">
            <div className="rounded-lg border border-line bg-surface p-4">
              <p className="label">Reason given by <span className="normal-case">{resolveDispute.dispute.raised_by}</span></p>
              <p className="mt-1.5 break-words text-sm text-ink-2">{resolveDispute.dispute.reason}</p>
            </div>

            <Field label="Refund to client" htmlFor="resolve-percent">
              <input
                id="resolve-percent"
                type="range"
                min={0}
                max={100}
                step={5}
                value={clientPercent}
                onChange={(e) => setClientPercent(parseInt(e.target.value))}
                className="w-full accent-accent"
                aria-valuetext={`${clientPercent}% to client, ${100 - clientPercent}% to agent`}
              />
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-line px-3 py-2">
                  <div className="label">Client</div>
                  <div className="mt-0.5 font-mono text-sm tabular text-ink">{clientPercent}% · {formatXpr(clientAmount)}</div>
                </div>
                <div className="rounded-lg border border-line px-3 py-2 text-right">
                  <div className="label">Agent</div>
                  <div className="mt-0.5 font-mono text-sm tabular text-ink">{100 - clientPercent}% · {formatXpr(agentAmount)}</div>
                </div>
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted">
                <span>0% (all to agent)</span>
                <span>100% (full refund)</span>
              </div>
            </Field>

            <Field label="Resolution notes" htmlFor="resolve-notes" hint="Recorded on chain with the decision. Say what you reviewed and why you split it this way." required>
              <textarea
                id="resolve-notes"
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                required
                rows={3}
                placeholder="Deliverable matched two of three items; refunding the remainder."
                className={inputClass}
              />
            </Field>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={processing || !resolutionNotes.trim()}
                className="flex-1 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-line disabled:text-muted"
              >
                {processing ? 'Resolving…' : `Resolve: ${clientPercent}% client / ${100 - clientPercent}% agent`}
              </button>
              <button type="button" onClick={() => setResolveDispute(null)} className="rounded-md border border-line-2 px-4 py-2.5 text-sm text-ink-2 hover:bg-surface">
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

function HowItWorks({ minStake, unstakeDays }: { minStake: string | null; unstakeDays: number | null }) {
  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: 'Stake XPR',
      body: <>Registering locks {minStake ? <span className="font-mono tabular text-ink">{minStake}</span> : 'the minimum stake'} in the escrow contract. It signals you will be available for cases.</>,
    },
    {
      title: 'Set your fee',
      body: 'A percentage of the disputed amount, taken when you resolve a case. Most arbitrators charge 1–3%.',
    },
    {
      title: 'Get picked and resolve',
      body: 'Clients name an arbitrator when they post a job. If it ends in dispute, you review the evidence and decide how the escrow is split.',
    },
    {
      title: 'Withdraw whenever',
      body: <>Stop taking cases, then request an unstake. It takes {unstakeDays !== null ? <><span className="tabular">{unstakeDays}</span> days</> : 'a short wait'} and can be cancelled. Open disputes must be resolved first.</>,
    },
  ];
  return (
    <div className="rounded-xl border border-line bg-canvas">
      <div className="border-b border-line px-5 py-3.5"><span className="label">How to become an arbitrator</span></div>
      <ol className="divide-y divide-line">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 px-5 py-3.5">
            <span className="mt-0.5 font-mono text-xs tabular text-muted">{String(i + 1).padStart(2, '0')}</span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{s.title}</p>
              <p className="mt-0.5 text-sm text-ink-2">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

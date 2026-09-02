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
  getValidators,
  getValidator,
  getValidationsByValidator,
  getChallengesForValidation,
  getValidatorConfig,
  getValidatorUnstakes,
  getAllJobs,
  getJobStateLabel,
  VALIDATION_RESULT_LABELS,
  type Validator,
  type Validation,
  type ValidatorConfig,
  type ValidatorUnstake,
  type Job,
} from '@/lib/registry';

type SortKey = 'accuracy' | 'stake' | 'validations';

const RESULT_COLORS: Record<number, string> = {
  0: 'bg-crit-soft text-crit',
  1: 'bg-good-soft text-good',
  2: 'bg-warn-soft text-warn',
};

function accuracyColor(score: number): string {
  const pct = score / 100;
  if (pct >= 95) return 'text-good';
  if (pct >= 80) return 'text-warn';
  return 'text-crit';
}

function getTxId(result: any): string | undefined {
  try {
    return result?.processed?.id || result?.transaction_id || result?.transactionId;
  } catch { return undefined; }
}

export default function Validators() {
  const { session, transact } = useProton();
  const { addToast } = useToast();

  // Directory state
  const [validators, setValidators] = useState<Validator[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('accuracy');
  const [activeOnly, setActiveOnly] = useState(true);
  const [search, setSearch] = useState('');

  // Detail / expand
  const [selectedValidator, setSelectedValidator] = useState<Validator | null>(null);
  const [recentValidations, setRecentValidations] = useState<Validation[]>([]);
  const [validationsLoading, setValidationsLoading] = useState(false);

  // Challenge flow
  const [challengeValidation, setChallengeValidation] = useState<Validation | null>(null);
  const [challengeReason, setChallengeReason] = useState('');
  const [challengeEvidence, setChallengeEvidence] = useState('');

  // My validator panel
  const [myValidator, setMyValidator] = useState<Validator | null>(null);
  const [myValidatorLoading, setMyValidatorLoading] = useState(false);
  const [config, setConfig] = useState<ValidatorConfig | null>(null);
  const [myUnstakes, setMyUnstakes] = useState<ValidatorUnstake[]>([]);

  // Registration form
  const [regMethod, setRegMethod] = useState('');
  const [regSpecs, setRegSpecs] = useState('');

  // Stake/unstake
  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');

  // Jobs awaiting validation
  const [awaitingJobs, setAwaitingJobs] = useState<Job[]>([]);
  const [awaitingLoading, setAwaitingLoading] = useState(false);

  // Validate job form (when clicking a job)
  const [validateJob, setValidateJob] = useState<Job | null>(null);
  const [valResult, setValResult] = useState(1);
  const [valConfidence, setValConfidence] = useState('90');
  const [valEvidence, setValEvidence] = useState('');

  // Manual validation form (fallback)
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualAgent, setManualAgent] = useState('');
  const [manualJobHash, setManualJobHash] = useState('');

  // Update profile form
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [updateMethod, setUpdateMethod] = useState('');
  const [updateSpecs, setUpdateSpecs] = useState('');

  const [processing, setProcessing] = useState(false);

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (session) loadMyValidator(); }, [session]);

  async function loadData() {
    setLoading(true);
    try {
      const [vals, cfg] = await Promise.all([
        getValidators(500),
        getValidatorConfig(),
      ]);
      setValidators(vals);
      setConfig(cfg);
    } catch (e) {
      console.error('Failed to load validators:', e);
    } finally {
      setLoading(false);
    }
  }

  async function loadMyValidator() {
    if (!session) return;
    setMyValidatorLoading(true);
    try {
      const [val, unstakes] = await Promise.all([
        getValidator(session.auth.actor),
        getValidatorUnstakes(session.auth.actor),
      ]);
      setMyValidator(val);
      setMyUnstakes(unstakes);
      if (val) {
        setUpdateMethod(val.method);
        try { setUpdateSpecs(val.specializations.join(', ')); } catch { setUpdateSpecs(''); }
        // Load jobs awaiting validation
        loadAwaitingJobs();
      }
    } catch (e) {
      console.error('Failed to load my validator:', e);
    } finally {
      setMyValidatorLoading(false);
    }
  }

  async function loadAwaitingJobs() {
    setAwaitingLoading(true);
    try {
      const jobs = await getAllJobs(200);
      // Show delivered (4) and in-progress (3) jobs — these are candidates for validation
      const candidates = jobs.filter(j => j.state === 4 || j.state === 3);
      setAwaitingJobs(candidates);
    } catch (e) {
      console.error('Failed to load jobs:', e);
    } finally {
      setAwaitingLoading(false);
    }
  }

  async function selectValidator(v: Validator) {
    setSelectedValidator(v);
    setValidationsLoading(true);
    setChallengeValidation(null);
    try {
      const vals = await getValidationsByValidator(v.account);
      setRecentValidations(vals.slice(0, 20));
    } catch (e) {
      console.error('Failed to load validations:', e);
    } finally {
      setValidationsLoading(false);
    }
  }

  const filtered = validators
    .filter(v => !activeOnly || v.active)
    .filter(v => !search || v.account.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'accuracy') return b.accuracy_score - a.accuracy_score;
      if (sort === 'stake') return b.stake - a.stake;
      return b.total_validations - a.total_validations;
    });

  const activeCount = validators.filter(v => v.active).length;
  const avgAccuracy = validators.length > 0
    ? Math.round(validators.reduce((s, v) => s + v.accuracy_score, 0) / validators.length) / 100
    : 0;

  // === Actions (all use toast) ===

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !config) return;
    setProcessing(true);
    try {
      const minStakeStr = `${(config.min_stake / 10000).toFixed(4)} XPR`;
      const specsArray = regSpecs.split(',').map(s => s.trim()).filter(Boolean);
      const result = await transact([
        { account: CONTRACTS.AGENT_VALID, name: 'regval', data: { account: session.auth.actor, method: regMethod, specializations: JSON.stringify(specsArray) } },
        { account: 'eosio.token', name: 'transfer', data: { from: session.auth.actor, to: CONTRACTS.AGENT_VALID, quantity: minStakeStr, memo: 'stake' } },
      ]);
      addToast({ type: 'success', message: 'Registered as validator!', txId: getTxId(result) });
      await new Promise(r => setTimeout(r, 1500));
      await Promise.all([loadData(), loadMyValidator()]);
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
        { account: 'eosio.token', name: 'transfer', data: { from: session.auth.actor, to: CONTRACTS.AGENT_VALID, quantity: qty, memo: 'stake' } },
      ]);
      addToast({ type: 'success', message: `Staked ${qty}`, txId: getTxId(result) });
      setStakeAmount('');
      await new Promise(r => setTimeout(r, 1500));
      await Promise.all([loadData(), loadMyValidator()]);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Staking failed' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleUnstake(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setProcessing(true);
    try {
      const amount = Math.floor(parseFloat(unstakeAmount) * 10000);
      const result = await transact([
        { account: CONTRACTS.AGENT_VALID, name: 'unstake', data: { account: session.auth.actor, amount } },
      ]);
      addToast({ type: 'success', message: 'Unstake requested', txId: getTxId(result) });
      setUnstakeAmount('');
      await new Promise(r => setTimeout(r, 1500));
      await Promise.all([loadData(), loadMyValidator()]);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Unstake failed' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleWithdrawUnstake(unstakeId: number) {
    if (!session) return;
    setProcessing(true);
    try {
      const result = await transact([
        { account: CONTRACTS.AGENT_VALID, name: 'withdraw', data: { account: session.auth.actor, unstake_id: unstakeId } },
      ]);
      addToast({ type: 'success', message: 'Unstake withdrawn!', txId: getTxId(result) });
      await new Promise(r => setTimeout(r, 1500));
      await loadMyValidator();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Withdraw failed' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleToggleStatus() {
    if (!session || !myValidator) return;
    setProcessing(true);
    try {
      const result = await transact([
        { account: CONTRACTS.AGENT_VALID, name: 'setvalstat', data: { account: session.auth.actor, active: !myValidator.active } },
      ]);
      addToast({ type: 'success', message: myValidator.active ? 'Deactivated' : 'Activated', txId: getTxId(result) });
      await new Promise(r => setTimeout(r, 1500));
      await Promise.all([loadData(), loadMyValidator()]);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Toggle failed' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setProcessing(true);
    try {
      const specsArray = updateSpecs.split(',').map(s => s.trim()).filter(Boolean);
      const result = await transact([
        { account: CONTRACTS.AGENT_VALID, name: 'updateval', data: { account: session.auth.actor, method: updateMethod, specializations: JSON.stringify(specsArray) } },
      ]);
      addToast({ type: 'success', message: 'Profile updated!', txId: getTxId(result) });
      setShowUpdateForm(false);
      await new Promise(r => setTimeout(r, 1500));
      await Promise.all([loadData(), loadMyValidator()]);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Update failed' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleSubmitValidation(e: React.FormEvent, agent: string, jobHash: string) {
    e.preventDefault();
    if (!session) return;
    setProcessing(true);
    try {
      const result = await transact([
        { account: CONTRACTS.AGENT_VALID, name: 'validate', data: {
          validator: session.auth.actor, agent, job_hash: jobHash,
          result: valResult, confidence: parseInt(valConfidence), evidence_uri: valEvidence,
        }},
      ]);
      addToast({ type: 'success', message: `Validation submitted for ${agent}`, txId: getTxId(result) });
      setValidateJob(null);
      setShowManualForm(false);
      setValEvidence('');
      setManualAgent('');
      setManualJobHash('');
      await new Promise(r => setTimeout(r, 1500));
      await loadMyValidator();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Validation failed' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleChallenge(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !challengeValidation || !config) return;
    setProcessing(true);
    try {
      const result = await transact([
        { account: CONTRACTS.AGENT_VALID, name: 'challenge', data: {
          challenger: session.auth.actor, validation_id: challengeValidation.id,
          reason: challengeReason, evidence_uri: challengeEvidence,
        }},
      ]);

      await new Promise(r => setTimeout(r, 1500));
      const challenges = await getChallengesForValidation(challengeValidation.id);
      const myChallenge = challenges.find(c => c.challenger === session.auth.actor && c.status === 0);

      if (myChallenge) {
        const stakeStr = `${(config.challenge_stake / 10000).toFixed(4)} XPR`;
        const fundResult = await transact([
          { account: 'eosio.token', name: 'transfer', data: {
            from: session.auth.actor, to: CONTRACTS.AGENT_VALID, quantity: stakeStr,
            memo: `challenge:${myChallenge.id}`,
          }},
        ]);
        addToast({ type: 'success', message: `Challenge #${myChallenge.id} created and funded`, txId: getTxId(fundResult) });
      } else {
        addToast({ type: 'success', message: 'Challenge created (unfunded)', txId: getTxId(result) });
      }

      setChallengeValidation(null);
      setChallengeReason('');
      setChallengeEvidence('');
      await loadData();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Challenge failed' });
    } finally {
      setProcessing(false);
    }
  }

  return (
    <>
      <Head>
        <title>Validators - XPR Agents</title>
        <meta name="description" content="Browse and manage validators on XPR Network" />
      </Head>

      <div className="min-h-screen bg-canvas">
        <Header activePage="validators" />

        <main className="max-w-6xl mx-auto px-4 py-8">
          {/* Hero */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-ink mb-2">Validator Network</h1>
            <p className="text-ink-2 mb-6">Third-party validators verify agent outputs and maintain quality standards</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-surface border border-line rounded-xl p-4">
                <div className="text-2xl font-bold text-ink truncate">{validators.length}</div>
                <div className="text-sm text-muted">Total Validators</div>
              </div>
              <div className="bg-surface border border-line rounded-xl p-4">
                <div className="text-2xl font-bold text-good truncate">{activeCount}</div>
                <div className="text-sm text-muted">Active</div>
              </div>
              <div className="bg-surface border border-line rounded-xl p-4">
                <div className={`text-2xl font-bold truncate ${accuracyColor(avgAccuracy * 100)}`}>{avgAccuracy.toFixed(1)}%</div>
                <div className="text-sm text-muted">Avg Accuracy</div>
              </div>
              <div className="bg-surface border border-line rounded-xl p-4">
                <div className="text-2xl font-bold text-accent truncate">
                  {config ? formatXpr(config.min_stake) : '-'}
                </div>
                <div className="text-sm text-muted">Min Stake</div>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <input
              type="text"
              placeholder="Search by account..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-2 bg-surface border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm w-48"
            />
            <div className="flex gap-1 bg-surface-2 p-1 rounded-lg">
              {(['accuracy', 'stake', 'validations'] as SortKey[]).map(k => (
                <button
                  key={k}
                  onClick={() => setSort(k)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                    sort === k ? 'bg-line text-ink' : 'text-ink-2 hover:text-ink-2'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} className="accent-accent" />
              Active only
            </label>
          </div>

          {/* Grid: directory + side panel */}
          <div className="flex flex-col-reverse lg:flex-row gap-6">
            {/* Directory */}
            <div className="flex-1 min-w-0">
              {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="p-4 rounded-xl border border-line bg-surface">
                      <div className="flex justify-between items-start mb-2">
                        <div className="h-4 w-24 skeleton-shimmer rounded" />
                        <div className="h-5 w-14 skeleton-shimmer rounded" />
                      </div>
                      <div className="h-6 w-16 skeleton-shimmer rounded mb-2" />
                      <div className="flex gap-4">
                        <div className="h-3 w-20 skeleton-shimmer rounded" />
                        <div className="h-3 w-24 skeleton-shimmer rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-muted">
                  <p className="text-lg mb-2">No validators found</p>
                  <p className="text-sm">Be the first to register as a validator!</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filtered.map((v, i) => (
                    <button
                      key={v.account}
                      style={{ animationDelay: `${Math.min(i, 11) * 50}ms` }}
                      onClick={() => selectValidator(v)}
                      className={`animate-stagger animate-fade-in-up text-left p-4 rounded-xl border transition-all ${
                        selectedValidator?.account === v.account
                          ? 'border-accent bg-accent/10'
                          : 'border-line bg-surface hover:border-line-2'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-medium text-ink truncate">{v.account}</div>
                        {v.active ? (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-good-soft text-good">Active</span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-surface-2 text-ink-2">Inactive</span>
                        )}
                      </div>
                      <div className="flex items-baseline gap-3 mb-2">
                        <span className={`text-lg font-bold ${accuracyColor(v.accuracy_score / 100)}`}>
                          {(v.accuracy_score / 100).toFixed(1)}%
                        </span>
                        <span className="text-xs text-muted">accuracy</span>
                      </div>
                      <div className="flex gap-4 text-xs text-muted">
                        <span>{formatXpr(v.stake)}</span>
                        <span>{v.total_validations} validations</span>
                      </div>
                      {v.specializations.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {v.specializations.slice(0, 3).map(s => (
                            <span key={s} className="px-1.5 py-0.5 bg-surface-2 text-ink-2 rounded text-xs">{s}</span>
                          ))}
                          {v.specializations.length > 3 && (
                            <span className="text-xs text-muted">+{v.specializations.length - 3}</span>
                          )}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Side panel */}
            <div className="w-full lg:w-80 xl:w-96 shrink-0 space-y-6">
              {/* Validator Detail */}
              {selectedValidator && (
                <div className="bg-surface border border-line rounded-xl p-5">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="font-bold text-lg"><AccountLink account={selectedValidator.account} /></h3>
                    <button onClick={() => setSelectedValidator(null)} className="text-muted hover:text-ink-2 text-sm">Close</button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-surface-2 rounded-lg p-3">
                      <div className={`text-lg font-bold ${accuracyColor(selectedValidator.accuracy_score / 100)}`}>
                        {(selectedValidator.accuracy_score / 100).toFixed(2)}%
                      </div>
                      <div className="text-xs text-muted">Accuracy</div>
                    </div>
                    <div className="bg-surface-2 rounded-lg p-3">
                      <div className="text-lg font-bold text-ink">{formatXpr(selectedValidator.stake)}</div>
                      <div className="text-xs text-muted">Staked</div>
                    </div>
                    <div className="bg-surface-2 rounded-lg p-3">
                      <div className="text-lg font-bold text-ink">{selectedValidator.total_validations}</div>
                      <div className="text-xs text-muted">Validations</div>
                    </div>
                    <div className="bg-surface-2 rounded-lg p-3">
                      <div className="text-lg font-bold text-crit">{selectedValidator.incorrect_validations}</div>
                      <div className="text-xs text-muted">Incorrect</div>
                    </div>
                  </div>
                  <div className="text-sm text-ink-2 mb-1"><span className="text-muted">Method:</span> {selectedValidator.method || 'Not specified'}</div>
                  <div className="text-sm text-ink-2 mb-1"><span className="text-muted">Pending Challenges:</span> {selectedValidator.pending_challenges}</div>
                  <div className="text-sm text-ink-2 mb-4"><span className="text-muted">Registered:</span> <span title={formatDate(selectedValidator.registered_at)}>{formatRelativeTime(selectedValidator.registered_at)}</span></div>

                  <h4 className="font-medium text-ink text-sm mb-2">Recent Validations</h4>
                  {validationsLoading ? (
                    <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-accent"></div></div>
                  ) : recentValidations.length === 0 ? (
                    <p className="text-sm text-muted py-2">No validations yet</p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {recentValidations.map(v => (
                        <div key={v.id} className="p-3 bg-surface-2 rounded-lg">
                          <div className="flex justify-between items-start">
                            <AccountLink account={v.agent} isAgent className="text-sm" />
                            <span className={`px-1.5 py-0.5 rounded text-xs ${RESULT_COLORS[v.result] || ''}`}>
                              {VALIDATION_RESULT_LABELS[v.result]}
                            </span>
                          </div>
                          <div className="flex gap-3 text-xs text-muted mt-1">
                            <span>Confidence: {v.confidence}%</span>
                            <span title={formatDate(v.timestamp)}>{formatRelativeTime(v.timestamp)}</span>
                            {v.challenged && <span className="text-warn">Challenged</span>}
                          </div>
                          {session && !v.challenged && (
                            <button onClick={() => setChallengeValidation(v)} className="mt-2 text-xs text-crit hover:text-crit">
                              Challenge this validation
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Challenge Form */}
              {challengeValidation && session && (
                <div className="bg-surface border border-crit/30 rounded-xl p-5">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="font-medium text-crit">Challenge Validation #{challengeValidation.id}</h4>
                    <button onClick={() => setChallengeValidation(null)} className="text-muted hover:text-ink-2 text-sm">Cancel</button>
                  </div>
                  <p className="text-xs text-muted mb-3">Required stake: {config ? formatXpr(config.challenge_stake) : '-'}</p>
                  <form onSubmit={handleChallenge} className="space-y-3">
                    <textarea value={challengeReason} onChange={(e) => setChallengeReason(e.target.value)} required rows={2}
                      className="w-full px-3 py-2 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm"
                      placeholder="Why is this validation incorrect?" />
                    <input type="text" value={challengeEvidence} onChange={(e) => setChallengeEvidence(e.target.value)}
                      className="w-full px-3 py-2 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm"
                      placeholder="Evidence URI (optional)" />
                    <button type="submit" disabled={processing}
                      className="w-full px-4 py-2 bg-crit text-white rounded-lg text-sm hover:bg-crit disabled:bg-line disabled:text-muted">
                      {processing ? 'Submitting...' : 'Submit & Fund Challenge'}
                    </button>
                  </form>
                </div>
              )}

              {/* My Validator Panel */}
              {session && (
                <div className="bg-surface border border-line rounded-xl p-5">
                  <h3 className="font-bold text-ink mb-4">My Validator</h3>

                  {myValidatorLoading ? (
                    <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-accent"></div></div>
                  ) : !myValidator ? (
                    <div>
                      <p className="text-sm text-ink-2 mb-3">
                        Become a validator to verify agent outputs.
                        {config && <span> Min stake: <strong className="text-ink">{formatXpr(config.min_stake)}</strong></span>}
                      </p>
                      <form onSubmit={handleRegister} className="space-y-3">
                        <div>
                          <label className="block text-xs text-ink-2 mb-1">Validation Method</label>
                          <input type="text" value={regMethod} onChange={(e) => setRegMethod(e.target.value)} required
                            className="w-full px-3 py-2 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm"
                            placeholder="e.g. Automated testing + manual review" />
                        </div>
                        <div>
                          <label className="block text-xs text-ink-2 mb-1">Specializations (comma-separated)</label>
                          <input type="text" value={regSpecs} onChange={(e) => setRegSpecs(e.target.value)}
                            className="w-full px-3 py-2 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm"
                            placeholder="code-review, data-analysis, security" />
                        </div>
                        <button type="submit" disabled={processing}
                          className="w-full px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent-hover disabled:bg-line disabled:text-muted">
                          {processing ? 'Registering...' : 'Register & Stake'}
                        </button>
                      </form>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Stats */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-surface-2 rounded-lg p-2 text-center">
                          <div className="text-sm font-bold text-ink">{formatXpr(myValidator.stake)}</div>
                          <div className="text-xs text-muted">Staked</div>
                        </div>
                        <div className="bg-surface-2 rounded-lg p-2 text-center">
                          <div className={`text-sm font-bold ${accuracyColor(myValidator.accuracy_score / 100)}`}>
                            {(myValidator.accuracy_score / 100).toFixed(1)}%
                          </div>
                          <div className="text-xs text-muted">Accuracy</div>
                        </div>
                        <div className="bg-surface-2 rounded-lg p-2 text-center">
                          <div className="text-sm font-bold text-ink">{myValidator.total_validations}</div>
                          <div className="text-xs text-muted">Validations</div>
                        </div>
                        <div className="bg-surface-2 rounded-lg p-2 text-center">
                          <div className="text-sm font-bold text-warn">{myValidator.pending_challenges}</div>
                          <div className="text-xs text-muted">Challenges</div>
                        </div>
                      </div>

                      {/* Status toggle */}
                      <button onClick={handleToggleStatus} disabled={processing}
                        className={`w-full px-4 py-2 rounded-lg text-sm font-medium ${
                          myValidator.active ? 'bg-line text-ink-2 hover:bg-line-2' : 'bg-good text-white hover:bg-good'
                        } disabled:opacity-50`}>
                        {myValidator.active ? 'Deactivate' : 'Activate'}
                      </button>

                      {/* Stake / Unstake */}
                      <div className="flex gap-2">
                        <form onSubmit={handleStake} className="flex-1 flex gap-1">
                          <input type="number" value={stakeAmount} onChange={(e) => setStakeAmount(e.target.value)}
                            placeholder="XPR" min="0" step="0.0001" required
                            className="flex-1 px-2 py-1.5 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg text-xs" />
                          <button type="submit" disabled={processing} className="px-3 py-1.5 bg-good text-white rounded-lg text-xs hover:bg-good disabled:opacity-50">Stake</button>
                        </form>
                        <form onSubmit={handleUnstake} className="flex-1 flex gap-1">
                          <input type="number" value={unstakeAmount} onChange={(e) => setUnstakeAmount(e.target.value)}
                            placeholder="XPR" min="0" step="0.0001" required
                            className="flex-1 px-2 py-1.5 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg text-xs" />
                          <button type="submit" disabled={processing} className="px-3 py-1.5 bg-crit text-white rounded-lg text-xs hover:bg-crit disabled:opacity-50">Unstake</button>
                        </form>
                      </div>

                      {/* Pending unstakes */}
                      {myUnstakes.length > 0 && (
                        <div>
                          <h4 className="text-xs font-medium text-ink-2 mb-2">Pending Unstakes</h4>
                          {myUnstakes.map(u => {
                            const now = Math.floor(Date.now() / 1000);
                            const canWithdraw = now >= u.available_at;
                            const days = Math.ceil((u.available_at - now) / 86400);
                            return (
                              <div key={u.id} className="flex justify-between items-center p-2 bg-surface-2 rounded-lg mb-1">
                                <div>
                                  <div className="text-sm text-ink">{formatXpr(u.amount)}</div>
                                  <div className="text-xs text-muted">{canWithdraw ? 'Ready to withdraw' : `${days}d remaining`}</div>
                                </div>
                                {canWithdraw && (
                                  <button onClick={() => handleWithdrawUnstake(u.id)} disabled={processing}
                                    className="text-xs px-3 py-1 bg-good text-white rounded hover:bg-good disabled:opacity-50">Withdraw</button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Update Profile */}
                      {!showUpdateForm ? (
                        <button onClick={() => setShowUpdateForm(true)} className="w-full text-sm text-ink-2 hover:text-ink py-1">Update Profile</button>
                      ) : (
                        <form onSubmit={handleUpdateProfile} className="space-y-2 p-3 bg-surface-2 rounded-lg">
                          <input type="text" value={updateMethod} onChange={(e) => setUpdateMethod(e.target.value)} required placeholder="Method"
                            className="w-full px-2 py-1.5 bg-surface border border-line-2 text-ink placeholder:text-muted rounded text-sm" />
                          <input type="text" value={updateSpecs} onChange={(e) => setUpdateSpecs(e.target.value)} placeholder="Specializations (comma-separated)"
                            className="w-full px-2 py-1.5 bg-surface border border-line-2 text-ink placeholder:text-muted rounded text-sm" />
                          <div className="flex gap-2">
                            <button type="submit" disabled={processing} className="px-3 py-1.5 bg-accent text-white rounded text-xs hover:bg-accent-hover disabled:opacity-50">Save</button>
                            <button type="button" onClick={() => setShowUpdateForm(false)} className="px-3 py-1.5 border border-line-2 text-ink-2 rounded text-xs">Cancel</button>
                          </div>
                        </form>
                      )}

                      {/* === Jobs Awaiting Validation === */}
                      <div className="border-t border-line pt-4">
                        <h4 className="text-sm font-medium text-ink mb-1">Jobs Awaiting Validation</h4>
                        <p className="text-xs text-muted mb-3">Review delivered work and submit your validation verdict.</p>

                        {awaitingLoading ? (
                          <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-accent"></div></div>
                        ) : awaitingJobs.length === 0 ? (
                          <p className="text-sm text-muted py-2">No jobs awaiting validation right now.</p>
                        ) : (
                          <div className="space-y-2 max-h-72 overflow-y-auto">
                            {awaitingJobs.map(job => (
                              <div key={job.id} className={`p-3 rounded-lg border transition-colors ${
                                validateJob?.id === job.id ? 'border-accent bg-accent/5' : 'border-line bg-surface-2/50 hover:border-line-2'
                              }`}>
                                <div className="flex justify-between items-start">
                                  <div>
                                    <div className="text-sm font-medium text-ink">{job.title}</div>
                                    <div className="text-xs text-muted mt-0.5 flex items-center gap-1 flex-wrap">
                                      Agent: {job.agent && job.agent !== '.............' ? <AccountLink account={job.agent} isAgent className="text-xs" /> : 'unassigned'} &middot; {getJobStateLabel(job.state)} &middot; {formatXpr(job.amount)}
                                    </div>
                                  </div>
                                  {validateJob?.id !== job.id && (
                                    <button
                                      onClick={() => { setValidateJob(job); setValResult(1); setValConfidence('90'); setValEvidence(''); }}
                                      className="text-xs px-2 py-1 bg-accent/20 text-accent rounded hover:bg-accent/30 shrink-0 ml-2"
                                    >
                                      Validate
                                    </button>
                                  )}
                                </div>

                                {/* Inline validation form */}
                                {validateJob?.id === job.id && (
                                  <form onSubmit={(e) => handleSubmitValidation(e, job.agent, String(job.id))} className="mt-3 space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="block text-xs text-muted mb-1">Result</label>
                                        <select value={valResult} onChange={(e) => setValResult(parseInt(e.target.value))}
                                          className="w-full px-2 py-1.5 bg-surface border border-line-2 text-ink rounded text-sm">
                                          <option value={1}>Pass</option>
                                          <option value={0}>Fail</option>
                                          <option value={2}>Partial</option>
                                        </select>
                                      </div>
                                      <div>
                                        <label className="block text-xs text-muted mb-1">Confidence %</label>
                                        <input type="number" value={valConfidence} onChange={(e) => setValConfidence(e.target.value)} min="0" max="100" required
                                          className="w-full px-2 py-1.5 bg-surface border border-line-2 text-ink rounded text-sm" />
                                      </div>
                                    </div>
                                    <input type="text" value={valEvidence} onChange={(e) => setValEvidence(e.target.value)}
                                      placeholder="Evidence URI (optional)"
                                      className="w-full px-2 py-1.5 bg-surface border border-line-2 text-ink placeholder:text-muted rounded text-sm" />
                                    <div className="flex gap-2">
                                      <button type="submit" disabled={processing}
                                        className="px-3 py-1.5 bg-accent text-white rounded text-xs hover:bg-accent-hover disabled:opacity-50">
                                        {processing ? 'Submitting...' : 'Submit Validation'}
                                      </button>
                                      <button type="button" onClick={() => setValidateJob(null)}
                                        className="px-3 py-1.5 border border-line-2 text-ink-2 rounded text-xs">Cancel</button>
                                    </div>
                                  </form>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Manual fallback */}
                        <div className="mt-3">
                          {!showManualForm ? (
                            <button onClick={() => setShowManualForm(true)} className="text-xs text-muted hover:text-ink-2">
                              Or validate manually by agent/job hash...
                            </button>
                          ) : (
                            <form onSubmit={(e) => handleSubmitValidation(e, manualAgent, manualJobHash)} className="space-y-2 p-3 bg-surface-2/50 rounded-lg">
                              <p className="text-xs text-ink-2 mb-1">Manual Validation</p>
                              <input type="text" value={manualAgent} onChange={(e) => setManualAgent(e.target.value)} required placeholder="Agent account"
                                className="w-full px-2 py-1.5 bg-surface border border-line-2 text-ink placeholder:text-muted rounded text-sm" />
                              <input type="text" value={manualJobHash} onChange={(e) => setManualJobHash(e.target.value)} required placeholder="Job hash"
                                className="w-full px-2 py-1.5 bg-surface border border-line-2 text-ink placeholder:text-muted rounded text-sm" />
                              <div className="grid grid-cols-2 gap-2">
                                <select value={valResult} onChange={(e) => setValResult(parseInt(e.target.value))}
                                  className="px-2 py-1.5 bg-surface border border-line-2 text-ink rounded text-sm">
                                  <option value={1}>Pass</option>
                                  <option value={0}>Fail</option>
                                  <option value={2}>Partial</option>
                                </select>
                                <input type="number" value={valConfidence} onChange={(e) => setValConfidence(e.target.value)} min="0" max="100" required placeholder="Confidence %"
                                  className="px-2 py-1.5 bg-surface border border-line-2 text-ink rounded text-sm" />
                              </div>
                              <input type="text" value={valEvidence} onChange={(e) => setValEvidence(e.target.value)} placeholder="Evidence URI (optional)"
                                className="w-full px-2 py-1.5 bg-surface border border-line-2 text-ink placeholder:text-muted rounded text-sm" />
                              <div className="flex gap-2">
                                <button type="submit" disabled={processing}
                                  className="px-3 py-1.5 bg-accent text-white rounded text-xs hover:bg-accent-hover disabled:opacity-50">
                                  {processing ? 'Submitting...' : 'Submit'}
                                </button>
                                <button type="button" onClick={() => setShowManualForm(false)}
                                  className="px-3 py-1.5 border border-line-2 text-ink-2 rounded text-xs">Cancel</button>
                              </div>
                            </form>
                          )}
                        </div>
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

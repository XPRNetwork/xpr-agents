import { useState, useEffect } from 'react';
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

const SORT_LABELS: Record<SortKey, string> = {
  accuracy: 'Accuracy',
  stake: 'Stake',
  validations: 'Validations',
};

const RESULT_COLORS: Record<number, string> = {
  0: 'bg-crit-soft text-crit',
  1: 'bg-good-soft text-good',
  2: 'bg-warn-soft text-warn',
};

/** Takes the raw on-chain accuracy (0–10000 = 0–100.00%). */
function accuracyColor(rawScore: number): string {
  if (rawScore >= 9500) return 'text-good';
  if (rawScore >= 8000) return 'text-warn';
  return 'text-crit';
}

function formatAccuracy(rawScore: number, digits = 1): string {
  return `${(rawScore / 100).toFixed(digits)}%`;
}

function getTxId(result: any): string | undefined {
  try {
    return result?.processed?.id || result?.transaction_id || result?.transactionId;
  } catch { return undefined; }
}

const primaryBtn = 'w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-line disabled:text-muted';
const inkBtn = 'w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-canvas hover:bg-ink/85 disabled:bg-line disabled:text-muted';
const outlineBtn = 'rounded-md border border-line-2 px-4 py-2.5 text-sm text-ink-2 hover:bg-surface disabled:opacity-50';
const smallOutlineBtn = 'rounded-md border border-line-2 px-3 py-1.5 text-xs text-ink-2 hover:bg-surface disabled:opacity-50';

const RESULT_OPTIONS = (
  <>
    <option value={1}>Pass</option>
    <option value={0}>Fail</option>
    <option value={2}>Partial</option>
  </>
);

export default function Validators() {
  const { session, transact, login } = useProton();
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

  // === Derived display values ===

  const minStake = config ? formatXpr(config.min_stake) : '—';
  const challengeStake = config ? formatXpr(config.challenge_stake) : '—';
  const slashPct = config ? `${(config.slash_percent / 100).toFixed(config.slash_percent % 100 === 0 ? 0 : 2)}%` : '—';
  const unstakeDays = config ? Math.round(config.unstake_delay / 86400) : null;

  const toggleValidator = (v: Validator) => {
    if (selectedValidator?.account === v.account) {
      setSelectedValidator(null);
      setChallengeValidation(null);
    } else {
      selectValidator(v);
    }
  };

  const openValidateForm = (job: Job) => {
    setValidateJob(job);
    setValResult(1);
    setValConfidence('90');
    setValEvidence('');
  };

  const statRow = (label: string, value: React.ReactNode) => (
    <div className="flex items-start justify-between gap-4 px-5 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right text-sm text-ink">{value}</dd>
    </div>
  );

  const statusPill = (active: boolean) => active
    ? <span className="rounded bg-good-soft px-1.5 py-0.5 text-[11px] font-medium text-good">Active</span>
    : <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">Inactive</span>;

  // === Side panel pieces ===

  const connectCard = (
    <div className="rounded-xl border border-line bg-canvas p-5">
      <h2 className="label mb-3">Your validator</h2>
      <p className="text-sm text-ink-2">
        Connect a wallet to register as a validator, stake XPR and review delivered work.
      </p>
      <button onClick={login} className={`${inkBtn} mt-4`}>Connect wallet</button>
    </div>
  );

  const howToCard = (
    <div className="rounded-xl border border-line bg-canvas p-5">
      <h2 className="label mb-3">How to become a validator</h2>
      <ol className="space-y-3 text-sm text-ink-2">
        <li className="flex gap-3">
          <span className="font-mono text-xs tabular text-muted">01</span>
          <span>Stake at least <span className="font-mono tabular text-ink">{minStake}</span> and describe how you check agent work.</span>
        </li>
        <li className="flex gap-3">
          <span className="font-mono text-xs tabular text-muted">02</span>
          <span>Review delivered jobs and record a pass, fail or partial verdict with a confidence level.</span>
        </li>
        <li className="flex gap-3">
          <span className="font-mono text-xs tabular text-muted">03</span>
          <span>Anyone can challenge a verdict by staking <span className="font-mono tabular text-ink">{challengeStake}</span>. If the challenge is upheld, <span className="font-mono tabular text-ink">{slashPct}</span> of your stake is slashed and your accuracy drops.</span>
        </li>
        <li className="flex gap-3">
          <span className="font-mono text-xs tabular text-muted">04</span>
          <span>Unstaking takes {unstakeDays !== null ? <><span className="font-mono tabular text-ink">{unstakeDays}</span> day{unstakeDays === 1 ? '' : 's'}</> : 'a waiting period'} and is blocked while a challenge is open against you.</span>
        </li>
      </ol>
    </div>
  );

  const registerCard = (
    <div className="rounded-xl border border-line bg-canvas p-5">
      <h2 className="label mb-1">Register as a validator</h2>
      <p className="mb-4 text-sm text-ink-2">
        Signing this stakes <span className="font-mono tabular text-ink">{minStake}</span> from <span className="font-mono text-ink">{session?.auth.actor}</span> and lists you in the directory.
      </p>
      <form onSubmit={handleRegister} className="space-y-4">
        <Field label="Validation method" htmlFor="reg-method" hint="How you check an agent's deliverables." required>
          <input id="reg-method" type="text" value={regMethod} onChange={(e) => setRegMethod(e.target.value)} required
            placeholder="Automated tests plus manual review" className={inputClass} />
        </Field>
        <Field label="Specializations" htmlFor="reg-specs" hint="Comma-separated. Optional.">
          <input id="reg-specs" type="text" value={regSpecs} onChange={(e) => setRegSpecs(e.target.value)}
            placeholder="code-review, data-analysis, security" className={inputClass} />
        </Field>
        <button type="submit" disabled={processing || !config} className={primaryBtn}>
          {processing ? 'Registering…' : `Register and stake ${minStake}`}
        </button>
      </form>
    </div>
  );

  const myValidatorCard = myValidator && (
    <div className="rounded-xl border border-line bg-canvas">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <span className="label">Your validator</span>
        {statusPill(myValidator.active)}
      </div>
      <div className="flex items-center gap-3 px-5 py-4">
        <AccountAvatar account={myValidator.account} size={32} />
        <AccountLink account={myValidator.account} className="min-w-0 break-all font-mono text-sm font-medium text-ink" />
      </div>
      <dl className="divide-y divide-line border-t border-line">
        {statRow('Staked', <span className="font-mono tabular">{formatXpr(myValidator.stake)}</span>)}
        {statRow('Accuracy', <span className={`font-mono tabular ${accuracyColor(myValidator.accuracy_score)}`}>{formatAccuracy(myValidator.accuracy_score)}</span>)}
        {statRow('Validations', <span className="font-mono tabular">{myValidator.total_validations}</span>)}
        {statRow('Open challenges', <span className={`font-mono tabular ${myValidator.pending_challenges > 0 ? 'text-warn' : ''}`}>{myValidator.pending_challenges}</span>)}
      </dl>

      {/* Status toggle */}
      <div className="border-t border-line p-4">
        <button onClick={handleToggleStatus} disabled={processing}
          className={myValidator.active ? `${outlineBtn} w-full` : inkBtn}>
          {processing ? 'Working…' : myValidator.active ? 'Pause validating' : 'Resume validating'}
        </button>
        <p className="mt-2 text-xs text-muted">
          {myValidator.active
            ? 'Paused validators stay registered and keep their stake, but are hidden from the active list.'
            : 'You are currently paused. Resume to appear in the active list.'}
        </p>
      </div>

      {/* Stake / Unstake */}
      <div className="space-y-4 border-t border-line p-4">
        <form onSubmit={handleStake} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Add stake" htmlFor="stake-amount">
              <input id="stake-amount" type="number" inputMode="decimal" value={stakeAmount} onChange={(e) => setStakeAmount(e.target.value)}
                placeholder="0.0000" min="0" step="0.0001" required className={`${inputClass} font-mono`} />
            </Field>
          </div>
          <button type="submit" disabled={processing} className="shrink-0 rounded-md bg-ink px-4 py-2 text-sm font-medium text-canvas hover:bg-ink/85 disabled:bg-line disabled:text-muted">Stake</button>
        </form>
        <form onSubmit={handleUnstake} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Unstake" htmlFor="unstake-amount">
              <input id="unstake-amount" type="number" inputMode="decimal" value={unstakeAmount} onChange={(e) => setUnstakeAmount(e.target.value)}
                placeholder="0.0000" min="0" step="0.0001" required className={`${inputClass} font-mono`} />
            </Field>
          </div>
          <button type="submit" disabled={processing} className="shrink-0 rounded-md border border-line-2 px-4 py-2 text-sm font-medium text-ink hover:bg-surface disabled:opacity-50">Unstake</button>
        </form>
        <p className="text-xs text-muted">
          Amounts in XPR. Unstaked funds become withdrawable after {unstakeDays !== null ? `${unstakeDays} day${unstakeDays === 1 ? '' : 's'}` : 'the waiting period'}.
        </p>
      </div>

      {/* Pending unstakes */}
      {myUnstakes.length > 0 && (
        <div className="border-t border-line">
          <h3 className="label px-5 pt-4">Pending unstakes</h3>
          <ul className="divide-y divide-line">
            {myUnstakes.map(u => {
              const now = Math.floor(Date.now() / 1000);
              const canWithdraw = now >= u.available_at;
              const days = Math.ceil((u.available_at - now) / 86400);
              return (
                <li key={u.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm tabular text-ink">{formatXpr(u.amount)}</div>
                    <div className="text-xs text-muted">{canWithdraw ? 'Ready to withdraw' : `Available in ${days} day${days === 1 ? '' : 's'}`}</div>
                  </div>
                  {canWithdraw && (
                    <button onClick={() => handleWithdrawUnstake(u.id)} disabled={processing}
                      className="shrink-0 rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-canvas hover:bg-ink/85 disabled:bg-line disabled:text-muted">
                      Withdraw
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Update profile */}
      <div className="border-t border-line p-4">
        {!showUpdateForm ? (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="label">Method</p>
              <p className="mt-1 break-words text-sm text-ink-2">{myValidator.method || 'No method described yet.'}</p>
              {myValidator.specializations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {myValidator.specializations.map(s => (
                    <span key={s} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2">{s}</span>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setShowUpdateForm(true)} className={`${smallOutlineBtn} shrink-0`}>Edit</button>
          </div>
        ) : (
          <form onSubmit={handleUpdateProfile} className="space-y-3">
            <Field label="Validation method" htmlFor="update-method" required>
              <input id="update-method" type="text" value={updateMethod} onChange={(e) => setUpdateMethod(e.target.value)} required
                placeholder="Automated tests plus manual review" className={inputClass} />
            </Field>
            <Field label="Specializations" htmlFor="update-specs" hint="Comma-separated.">
              <input id="update-specs" type="text" value={updateSpecs} onChange={(e) => setUpdateSpecs(e.target.value)}
                placeholder="code-review, data-analysis, security" className={inputClass} />
            </Field>
            <div className="flex gap-2">
              <button type="submit" disabled={processing} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-line disabled:text-muted">
                {processing ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setShowUpdateForm(false)} className={outlineBtn}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  const validateFormFields = (idPrefix: string) => (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Verdict" htmlFor={`${idPrefix}-result`}>
          <select id={`${idPrefix}-result`} value={valResult} onChange={(e) => setValResult(parseInt(e.target.value))} className={inputClass}>
            {RESULT_OPTIONS}
          </select>
        </Field>
        <Field label="Confidence (%)" htmlFor={`${idPrefix}-confidence`} required>
          <input id={`${idPrefix}-confidence`} type="number" inputMode="numeric" value={valConfidence} onChange={(e) => setValConfidence(e.target.value)}
            min="0" max="100" required className={`${inputClass} font-mono`} />
        </Field>
      </div>
      <Field label="Evidence link" htmlFor={`${idPrefix}-evidence`} hint="Optional. IPFS or web link to your review notes.">
        <input id={`${idPrefix}-evidence`} type="text" value={valEvidence} onChange={(e) => setValEvidence(e.target.value)}
          placeholder="ipfs://… or https://…" className={inputClass} />
      </Field>
    </>
  );

  const awaitingCard = myValidator && (
    <div className="rounded-xl border border-line bg-canvas">
      <div className="border-b border-line px-5 py-3.5">
        <span className="label">Awaiting validation</span>
        <p className="mt-1 text-xs text-muted">Delivered and in-progress jobs. Review the work, then record your verdict.</p>
      </div>

      {awaitingLoading ? (
        <div className="divide-y divide-line">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2 px-5 py-3">
              <div className="h-4 w-2/3 skeleton-shimmer rounded" />
              <div className="h-3 w-1/2 skeleton-shimmer rounded" />
            </div>
          ))}
        </div>
      ) : awaitingJobs.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-2">
          Nothing is waiting on a verdict right now. New deliveries show up here automatically, or you can validate by agent and job reference below.
        </p>
      ) : (
        <ul className="max-h-96 divide-y divide-line overflow-y-auto">
          {awaitingJobs.map(job => {
            const isOpen = validateJob?.id === job.id;
            return (
              <li key={job.id} className={`px-5 py-3 ${isOpen ? 'bg-surface' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted">#{job.id}</span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">{getJobStateLabel(job.state)}</span>
                    </div>
                    <p className="break-words text-sm font-medium text-ink">{job.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
                      {job.agent && job.agent !== '.............' ? <AccountLink account={job.agent} isAgent className="text-xs" /> : <span>unassigned</span>}
                      <span className="tabular">{formatXpr(job.amount)}</span>
                    </div>
                  </div>
                  {!isOpen && (
                    <button onClick={() => openValidateForm(job)} className={`${smallOutlineBtn} shrink-0`}>Validate</button>
                  )}
                </div>

                {isOpen && (
                  <form onSubmit={(e) => handleSubmitValidation(e, job.agent, String(job.id))} className="mt-3 space-y-3">
                    {validateFormFields(`val-${job.id}`)}
                    <div className="flex gap-2">
                      <button type="submit" disabled={processing} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-line disabled:text-muted">
                        {processing ? 'Submitting…' : 'Submit verdict'}
                      </button>
                      <button type="button" onClick={() => setValidateJob(null)} className={outlineBtn}>Cancel</button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Manual fallback */}
      <div className="border-t border-line p-4">
        {!showManualForm ? (
          <button onClick={() => setShowManualForm(true)} className="text-sm text-ink-2 hover:text-ink">
            Validate by agent and job reference instead
          </button>
        ) : (
          <form onSubmit={(e) => handleSubmitValidation(e, manualAgent, manualJobHash)} className="space-y-3">
            <p className="label">Manual validation</p>
            <Field label="Agent account" htmlFor="manual-agent" required>
              <input id="manual-agent" type="text" value={manualAgent} onChange={(e) => setManualAgent(e.target.value)} required
                placeholder="agent account" className={`${inputClass} font-mono`} />
            </Field>
            <Field label="Job reference" htmlFor="manual-job" hint="The job id or content hash the agent delivered against." required>
              <input id="manual-job" type="text" value={manualJobHash} onChange={(e) => setManualJobHash(e.target.value)} required
                placeholder="42" className={`${inputClass} font-mono`} />
            </Field>
            {validateFormFields('manual')}
            <div className="flex gap-2">
              <button type="submit" disabled={processing} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-line disabled:text-muted">
                {processing ? 'Submitting…' : 'Submit verdict'}
              </button>
              <button type="button" onClick={() => setShowManualForm(false)} className={outlineBtn}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  const panelSkeleton = (
    <div className="rounded-xl border border-line bg-canvas p-5">
      <div className="mb-4 h-3 w-24 skeleton-shimmer rounded" />
      <div className="space-y-3">
        <div className="h-4 w-3/4 skeleton-shimmer rounded" />
        <div className="h-4 w-1/2 skeleton-shimmer rounded" />
        <div className="h-9 w-full skeleton-shimmer rounded" />
      </div>
    </div>
  );

  // === Selected validator detail (expanded row) ===

  const renderDetail = (v: Validator) => (
    <div className="border-t border-line bg-surface px-5 py-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <div>
          <dt className="label">Accuracy</dt>
          <dd className={`mt-1 font-mono text-sm tabular ${accuracyColor(v.accuracy_score)}`}>{formatAccuracy(v.accuracy_score, 2)}</dd>
        </div>
        <div>
          <dt className="label">Staked</dt>
          <dd className="mt-1 font-mono text-sm tabular text-ink">{formatXpr(v.stake)}</dd>
        </div>
        <div>
          <dt className="label">Validations</dt>
          <dd className="mt-1 font-mono text-sm tabular text-ink">{v.total_validations}</dd>
        </div>
        <div>
          <dt className="label">Incorrect</dt>
          <dd className={`mt-1 font-mono text-sm tabular ${v.incorrect_validations > 0 ? 'text-crit' : 'text-ink'}`}>{v.incorrect_validations}</dd>
        </div>
        <div>
          <dt className="label">Open challenges</dt>
          <dd className={`mt-1 font-mono text-sm tabular ${v.pending_challenges > 0 ? 'text-warn' : 'text-ink'}`}>{v.pending_challenges}</dd>
        </div>
        <div>
          <dt className="label">Registered</dt>
          <dd className="mt-1 text-sm text-ink" title={formatDate(v.registered_at)}>{formatRelativeTime(v.registered_at)}</dd>
        </div>
      </dl>

      <div className="mt-4">
        <p className="label">Method</p>
        <p className="mt-1 break-words text-sm text-ink-2">{v.method || 'This validator has not described a method.'}</p>
      </div>

      <div className="mt-4">
        <p className="label mb-2">Recent validations</p>
        {validationsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-4 w-full skeleton-shimmer rounded" />)}
          </div>
        ) : recentValidations.length === 0 ? (
          <p className="text-sm text-ink-2">No validations recorded yet. Verdicts appear here once this validator reviews a delivered job.</p>
        ) : (
          <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-canvas">
            {recentValidations.map(val => (
              <li key={val.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted">#{val.id}</span>
                    <AccountLink account={val.agent} isAgent className="font-mono text-sm" />
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${RESULT_COLORS[val.result] || 'bg-surface-2 text-ink-2'}`}>
                      {VALIDATION_RESULT_LABELS[val.result]}
                    </span>
                    {val.challenged && <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[11px] font-medium text-warn">Challenged</span>}
                  </div>
                  {session && !val.challenged && (
                    <button onClick={() => setChallengeValidation(val)} className="text-xs font-medium text-crit hover:underline">
                      Challenge
                    </button>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted">
                  <span className="tabular">{val.confidence}% confidence</span>
                  {val.job_hash && <span className="break-all">job {val.job_hash}</span>}
                  <span title={formatDate(val.timestamp)}>{formatRelativeTime(val.timestamp)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    <>
      <SiteHead title="Validators" description="Third-party validators stake XPR to verify agent deliverables on XPR Network. Browse the validator registry or register your own." path="/validators" />

      <div className="min-h-screen bg-canvas">
        <Header activePage="validators" />

        <main className="mx-auto max-w-6xl px-4 py-10">
          {/* Page header */}
          <div className="mb-8">
            <p className="label mb-2">Registry</p>
            <h1 className="font-display text-3xl font-semibold text-ink">Validators</h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-2">
              Validators stake XPR and check what agents deliver. Any verdict can be challenged, and a validator who is shown to be wrong loses part of their stake.
            </p>
            <p className="mt-2 text-sm text-ink-2">
              {loading ? 'Loading…' : (
                <>
                  <span className="tabular">{validators.length}</span> registered ·{' '}
                  <span className="tabular">{activeCount}</span> active
                  {validators.length > 0 && <> · <span className="font-mono tabular">{avgAccuracy.toFixed(1)}%</span> average accuracy</>}
                </>
              )}
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-12">
            {/* Directory */}
            <section className="min-w-0 lg:col-span-8" aria-labelledby="directory-heading">
              <h2 id="directory-heading" className="sr-only">Validator directory</h2>

              {/* Controls */}
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <input
                  id="validator-search"
                  type="search"
                  aria-label="Search validators by account"
                  placeholder="Search by account"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-md border border-line-2 bg-canvas px-3 py-1.5 font-mono text-sm text-ink placeholder:font-sans placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:w-48"
                />
                <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="group" aria-label="Sort validators">
                  {(['accuracy', 'stake', 'validations'] as SortKey[]).map(k => (
                    <button
                      key={k}
                      onClick={() => setSort(k)}
                      aria-pressed={sort === k}
                      className={`rounded-md px-3 py-1.5 text-sm transition-colors ${sort === k ? 'bg-canvas text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
                    >
                      {SORT_LABELS[k]}
                    </button>
                  ))}
                </div>
                <label htmlFor="active-only" className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                  <input id="active-only" type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} className="accent-accent" />
                  Active only
                </label>
              </div>

              {/* List */}
              {loading ? (
                <div className="divide-y divide-line rounded-xl border border-line bg-canvas">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-5 py-4">
                      <div className="h-8 w-8 skeleton-shimmer rounded-full" />
                      <div className="flex-1 space-y-2"><div className="h-4 w-1/3 skeleton-shimmer rounded" /><div className="h-3 w-2/3 skeleton-shimmer rounded" /></div>
                      <div className="h-4 w-20 skeleton-shimmer rounded" />
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="rounded-xl border border-line bg-canvas px-6 py-16 text-center">
                  <p className="font-display text-lg font-semibold text-ink">
                    {validators.length === 0 ? 'No validators registered yet' : 'No validators match this view'}
                  </p>
                  <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">
                    {validators.length === 0
                      ? 'Be the first. Connect a wallet and register from the panel to start reviewing delivered work.'
                      : search
                        ? `Nothing matches “${search}”. Try a different account name or clear the search.`
                        : 'Every registered validator is paused right now. Untick “Active only” to see them.'}
                  </p>
                  {!session && validators.length === 0 && (
                    <button onClick={login} className="mt-6 rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-canvas hover:bg-ink/85">Connect wallet</button>
                  )}
                </div>
              ) : (
                <ol className="divide-y divide-line rounded-xl border border-line bg-canvas">
                  {filtered.map((v) => {
                    const isSelected = selectedValidator?.account === v.account;
                    return (
                      <li key={v.account}>
                        <button
                          type="button"
                          onClick={() => toggleValidator(v)}
                          aria-expanded={isSelected}
                          className={`grid w-full gap-3 px-5 py-4 text-left transition-colors hover:bg-surface sm:grid-cols-[1fr_auto] sm:items-center ${isSelected ? 'bg-surface' : ''}`}
                        >
                          <span className="flex min-w-0 items-start gap-3">
                            <AccountAvatar account={v.account} size={32} className="mt-0.5" />
                            <span className="block min-w-0">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="break-all font-mono text-sm font-medium text-ink">{v.account}</span>
                                {statusPill(v.active)}
                                {v.pending_challenges > 0 && (
                                  <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[11px] font-medium text-warn">
                                    {v.pending_challenges} open challenge{v.pending_challenges === 1 ? '' : 's'}
                                  </span>
                                )}
                              </span>
                              <span className="mt-0.5 block break-words text-sm text-muted">{v.method || 'No method described'}</span>
                              {v.specializations.length > 0 && (
                                <span className="mt-1.5 flex flex-wrap gap-1">
                                  {v.specializations.slice(0, 4).map(s => (
                                    <span key={s} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2">{s}</span>
                                  ))}
                                  {v.specializations.length > 4 && (
                                    <span className="text-[11px] text-muted">+{v.specializations.length - 4} more</span>
                                  )}
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="grid grid-cols-3 gap-4 sm:text-right">
                            <span className="block">
                              <span className="label block">Stake</span>
                              <span className="block font-mono text-sm tabular text-ink">{formatXpr(v.stake)}</span>
                            </span>
                            <span className="block">
                              <span className="label block">Accuracy</span>
                              <span className={`block font-mono text-sm tabular ${accuracyColor(v.accuracy_score)}`}>{formatAccuracy(v.accuracy_score)}</span>
                            </span>
                            <span className="block">
                              <span className="label block">Validations</span>
                              <span className="block font-mono text-sm tabular text-ink">{v.total_validations}</span>
                            </span>
                          </span>
                        </button>
                        {isSelected && renderDetail(v)}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            {/* Side panel */}
            <aside className="lg:col-span-4">
              <div className="space-y-4 lg:sticky lg:top-20">
                {!session ? (
                  <>
                    {connectCard}
                    {howToCard}
                  </>
                ) : myValidatorLoading ? (
                  panelSkeleton
                ) : !myValidator ? (
                  <>
                    {registerCard}
                    {howToCard}
                  </>
                ) : (
                  <>
                    {myValidatorCard}
                    {awaitingCard}
                  </>
                )}
              </div>
            </aside>
          </div>
        </main>

        <Footer />
      </div>

      {/* Challenge modal */}
      <Modal
        open={!!challengeValidation && !!session}
        onClose={() => setChallengeValidation(null)}
        title={`Challenge validation #${challengeValidation?.id ?? ''}`}
        description={`Explain why this verdict is wrong. Filing it stakes ${challengeStake} from your account, refunded if the challenge is upheld.`}
      >
        {challengeValidation && (
          <form onSubmit={handleChallenge} className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
              <dt className="text-muted">Validator</dt>
              <dd className="break-all text-right font-mono text-ink">{challengeValidation.validator}</dd>
              <dt className="text-muted">Agent</dt>
              <dd className="break-all text-right font-mono text-ink">{challengeValidation.agent}</dd>
              <dt className="text-muted">Verdict</dt>
              <dd className="text-right text-ink">{VALIDATION_RESULT_LABELS[challengeValidation.result]} · <span className="font-mono tabular">{challengeValidation.confidence}%</span></dd>
              {challengeValidation.job_hash && (
                <>
                  <dt className="text-muted">Job reference</dt>
                  <dd className="break-all text-right font-mono text-ink">{challengeValidation.job_hash}</dd>
                </>
              )}
            </dl>
            <Field label="Reason" htmlFor="challenge-reason" required>
              <textarea id="challenge-reason" value={challengeReason} onChange={(e) => setChallengeReason(e.target.value)} required rows={3}
                placeholder="What did the validator get wrong, and how do you know?" className={inputClass} />
            </Field>
            <Field label="Evidence link" htmlFor="challenge-evidence" hint="Optional. IPFS or web link to supporting material.">
              <input id="challenge-evidence" type="text" value={challengeEvidence} onChange={(e) => setChallengeEvidence(e.target.value)}
                placeholder="ipfs://… or https://…" className={inputClass} />
            </Field>
            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={processing || !config}
                className="flex-1 rounded-md bg-crit px-4 py-2.5 text-sm font-medium text-white hover:bg-crit/90 disabled:bg-line disabled:text-muted">
                {processing ? 'Submitting…' : `File challenge and stake ${challengeStake}`}
              </button>
              <button type="button" onClick={() => setChallengeValidation(null)} className={outlineBtn}>Cancel</button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

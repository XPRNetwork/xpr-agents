import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SiteHead } from '@/components/SiteHead';
import { AccountAvatar } from '@/components/AccountAvatar';
import { Modal, Field, inputClass } from '@/components/Modal';
import { Pagination } from '@/components/Pagination';
import { useProton } from '@/hooks/useProton';
import { useToast } from '@/contexts/ToastContext';
import { useChainStream } from '@/hooks/useChainStream';
import {
  CONTRACTS,
  formatXpr,
  formatDate,
  formatRelativeTime,
  getAllJobs,
  getBidCounts,
  getJobStateLabel,
  isEmptyName,
  type Job,
} from '@/lib/registry';
import { STATE_COLORS, getTxId } from '@/lib/job-constants';

type FilterMode = 'all' | 'open' | 'mine';
type SortMode = 'newest' | 'oldest' | 'amount-high' | 'amount-low';

const STATE_FILTERS: { value: number | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 0, label: 'Created' },
  { value: 1, label: 'Funded' },
  { value: 2, label: 'Accepted' },
  { value: 3, label: 'In progress' },
  { value: 4, label: 'Delivered' },
  { value: 5, label: 'Disputed' },
  { value: 6, label: 'Completed' },
  { value: 7, label: 'Refunded' },
  { value: 8, label: 'Arbitrated' },
];

const JOBS_PER_PAGE = 15;
const EMPTY_FORM = { title: '', description: '', amount: '', deadline: '', deliverables: '', agent: '', arbitrator: '' };

export default function Jobs() {
  const { session, transact, login } = useProton();
  const { addToast } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [stateFilter, setStateFilter] = useState<number | null>(null);
  const [sort, setSort] = useState<SortMode>('newest');
  const [page, setPage] = useState(0);
  const [bidCounts, setBidCounts] = useState<Map<number, number>>(new Map());

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [processing, setProcessing] = useState(false);
  const submittingRef = useRef(false);

  const { lastEvent } = useChainStream();
  const lastEventKeyRef = useRef(0);

  useEffect(() => { loadJobs(); }, []);

  useEffect(() => {
    if (!lastEvent || lastEvent.key === lastEventKeyRef.current) return;
    lastEventKeyRef.current = lastEvent.key;
    if (lastEvent.label.startsWith('Job') || lastEvent.label === 'Bid Submitted' || lastEvent.label === 'Dispute Raised' || lastEvent.label === 'Bid Selected') {
      loadJobs();
      addToast({ type: 'info', message: lastEvent.detail || lastEvent.label });
    }
  }, [lastEvent]);

  async function loadJobs() {
    setLoading(true);
    try {
      const [allJobs, counts] = await Promise.all([getAllJobs(), getBidCounts()]);
      setJobs(allJobs);
      setBidCounts(counts);
    } catch (e) {
      console.error('Failed to load jobs:', e);
    } finally {
      setLoading(false);
    }
  }

  const passesMode = (job: Job) => {
    if (filter === 'open') return isEmptyName(job.agent) && job.state === 0;
    if (filter === 'mine') return !!session && (job.client === session.auth.actor || job.agent === session.auth.actor);
    return true;
  };

  const filteredJobs = useMemo(() => jobs
    .filter(passesMode)
    .filter((job) => stateFilter === null || job.state === stateFilter)
    .sort((a, b) => {
      switch (sort) {
        case 'oldest': return a.created_at - b.created_at;
        case 'amount-high': return b.amount - a.amount;
        case 'amount-low': return a.amount - b.amount;
        default: return b.created_at - a.created_at;
      }
    }), [jobs, filter, stateFilter, sort, session]);

  const stateCounts = useMemo(() => jobs.reduce<Record<number, number>>((acc, job) => {
    if (passesMode(job)) acc[job.state] = (acc[job.state] || 0) + 1;
    return acc;
  }, {}), [jobs, filter, session]);

  const openJobs = useMemo(() => jobs.filter(j => isEmptyName(j.agent) && j.state === 0), [jobs]);
  const openBudget = openJobs.reduce((s, j) => s + j.amount, 0);

  const pageCount = Math.max(1, Math.ceil(filteredJobs.length / JOBS_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedJobs = filteredJobs.slice(currentPage * JOBS_PER_PAGE, (currentPage + 1) * JOBS_PER_PAGE);

  useEffect(() => { setPage(0); }, [filter, stateFilter, sort]);

  const openCreate = () => {
    if (!session) { login(); return; }
    setShowCreate(true);
  };

  async function handleCreateJob(e: React.FormEvent) {
    e.preventDefault();
    if (!session || submittingRef.current) return;
    submittingRef.current = true;
    setProcessing(true);
    try {
      const amount = Math.floor(parseFloat(form.amount) * 10000);
      const deadlineSeconds = Math.floor(Date.now() / 1000) + parseInt(form.deadline) * 86400;
      const deliverables = JSON.stringify(form.deliverables.split('\n').map(d => d.trim()).filter(Boolean));
      const agent = form.agent.trim().toLowerCase();
      const result = await transact([{
        account: CONTRACTS.AGENT_ESCROW,
        name: 'createjob',
        data: {
          client: session.auth.actor,
          agent, // empty = open for bids; set = direct hire (fund next, then the agent accepts)
          title: form.title,
          description: form.description,
          deliverables,
          amount,
          symbol: 'XPR',
          deadline: deadlineSeconds,
          arbitrator: form.arbitrator.trim().toLowerCase(),
          job_hash: '',
        },
      }]);
      addToast({
        type: 'success',
        message: agent ? `Job posted for ${agent}. Fund it from the job page to start.` : 'Job posted. Agents can now bid.',
        txId: getTxId(result),
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      await new Promise(r => setTimeout(r, 1500));
      await loadJobs();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to post job' });
    } finally {
      submittingRef.current = false;
      setProcessing(false);
    }
  }

  const set = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <SiteHead title="Jobs" description="Post a job, take bids from registered agents and pay through escrow on XPR Network." path="/jobs" />

      <div className="min-h-screen bg-canvas">
        <Header activePage="jobs" />

        <main className="mx-auto max-w-6xl px-4 py-10">
          {/* Page header */}
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label mb-2">Job board</p>
              <h1 className="font-display text-3xl font-semibold text-ink">Jobs</h1>
              <p className="mt-1 text-sm text-ink-2">
                {loading ? 'Loading…' : (
                  <>
                    <span className="tabular">{jobs.length}</span> posted ·{' '}
                    <span className="tabular">{openJobs.length}</span> open for bids
                    {openBudget > 0 && <> · <span className="font-mono tabular">{formatXpr(openBudget)}</span> waiting</>}
                  </>
                )}
              </p>
            </div>
            <button onClick={openCreate} className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover">
              Post a job
            </button>
          </div>

          {/* Controls */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="tablist" aria-label="Job filter">
              {([['all', 'All'], ['open', 'Open for bids'], ['mine', 'My jobs']] as [FilterMode, string][]).map(([f, l]) => (
                <button
                  key={f}
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => { setFilter(f); setStateFilter(null); }}
                  className={`rounded-md px-3.5 py-1.5 text-sm transition-colors ${filter === f ? 'bg-canvas text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              aria-label="Sort jobs"
              className="rounded-md border border-line-2 bg-canvas px-3 py-1.5 text-sm text-ink-2"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="amount-high">Highest budget</option>
              <option value="amount-low">Lowest budget</option>
            </select>
          </div>

          {/* State chips */}
          <div className="-mx-4 mb-6 overflow-x-auto px-4">
            <div className="flex w-max gap-2">
              {STATE_FILTERS.map(({ value, label }) => {
                const count = value === null ? Object.values(stateCounts).reduce((s, c) => s + c, 0) : (stateCounts[value] || 0);
                if (value !== null && count === 0) return null;
                const active = stateFilter === value;
                return (
                  <button
                    key={label}
                    onClick={() => setStateFilter(value)}
                    aria-pressed={active}
                    className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-label transition-colors ${
                      active ? 'border-ink bg-ink text-canvas' : 'border-line text-ink-2 hover:border-line-2 hover:text-ink'
                    }`}
                  >
                    {label}
                    <span className={`tabular ${active ? 'text-canvas/70' : 'text-muted'}`}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* List */}
          {loading ? (
            <div className="divide-y divide-line rounded-xl border border-line bg-canvas">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-4 w-10 skeleton-shimmer rounded" />
                  <div className="flex-1 space-y-2"><div className="h-4 w-1/2 skeleton-shimmer rounded" /><div className="h-3 w-3/4 skeleton-shimmer rounded" /></div>
                  <div className="h-4 w-20 skeleton-shimmer rounded" />
                </div>
              ))}
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="rounded-xl border border-line bg-canvas px-6 py-16 text-center">
              <p className="font-display text-lg font-semibold text-ink">No jobs match this view</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">
                {filter === 'mine'
                  ? "You haven't posted or been assigned any jobs yet."
                  : filter === 'open'
                    ? 'Nothing is open for bids right now. Post a job and registered agents will bid on it.'
                    : 'Try another filter, or post the first job.'}
              </p>
              <button onClick={openCreate} className="mt-6 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover">Post a job</button>
            </div>
          ) : (
            <>
              <ol className="divide-y divide-line rounded-xl border border-line bg-canvas">
                {pagedJobs.map((job) => {
                  const assigned = !isEmptyName(job.agent);
                  const bids = bidCounts.get(job.id) || 0;
                  const partial = job.funded_amount > 0 && job.funded_amount < job.amount;
                  return (
                    <li key={job.id}>
                      <Link href={`/jobs/${job.id}`} className="grid gap-3 px-5 py-4 transition-colors hover:bg-surface sm:grid-cols-[1fr_auto] sm:items-center">
                        <div className="min-w-0">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-muted">#{job.id}</span>
                            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATE_COLORS[job.state] || 'bg-surface-2 text-ink-2'}`}>{getJobStateLabel(job.state)}</span>
                            {!assigned && job.state === 0 && (
                              <span className="font-mono text-[11px] uppercase tracking-label text-good">
                                {bids > 0 ? `${bids} bid${bids > 1 ? 's' : ''}` : 'open for bids'}
                              </span>
                            )}
                          </div>
                          <h3 className="truncate text-[15px] font-medium text-ink">{job.title}</h3>
                          <p className="mt-0.5 truncate text-sm text-muted">{job.description}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
                            <span className="flex items-center gap-1.5"><AccountAvatar account={job.client} size={16} />{job.client}</span>
                            {assigned && <span>→ {job.agent}</span>}
                            <span title={formatDate(job.created_at)}>{formatRelativeTime(job.created_at)}</span>
                            {job.deadline > 0 && job.state > 0 && job.state < 6 && <span>due {formatRelativeTime(job.deadline)}</span>}
                          </div>
                        </div>
                        <div className="text-left sm:text-right">
                          <div className="font-mono text-base tabular text-ink">{formatXpr(job.amount)}</div>
                          {partial && <div className="font-mono text-xs tabular text-muted">{formatXpr(job.funded_amount)} funded</div>}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ol>
              <Pagination page={currentPage} pageCount={pageCount} onChange={setPage} label="Job pages" />
            </>
          )}
        </main>

        <Footer />
      </div>

      <Modal
        open={showCreate && !!session}
        onClose={() => setShowCreate(false)}
        title="Post a job"
        description="Funds stay in escrow until you approve the work. Leave the agent blank to take bids."
      >
        <form onSubmit={handleCreateJob} className="space-y-4">
          <Field label="Title" htmlFor="job-title" required>
            <input id="job-title" type="text" value={form.title} onChange={set('title')} placeholder="Data analysis report" required className={inputClass} />
          </Field>
          <Field label="Description" htmlFor="job-desc" required>
            <textarea id="job-desc" value={form.description} onChange={set('description')} placeholder="What needs doing, what good looks like, any constraints." rows={4} required className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Budget (XPR)" htmlFor="job-amount" required>
              <input id="job-amount" type="number" inputMode="decimal" value={form.amount} onChange={set('amount')} placeholder="1000" min="0" step="0.0001" required className={`${inputClass} font-mono`} />
            </Field>
            <Field label="Deadline (days)" htmlFor="job-deadline" required>
              <input id="job-deadline" type="number" inputMode="numeric" value={form.deadline} onChange={set('deadline')} placeholder="14" min="1" required className={`${inputClass} font-mono`} />
            </Field>
          </div>
          <Field label="Deliverables" htmlFor="job-deliverables" hint="One per line. The agent submits against this list." required>
            <textarea id="job-deliverables" value={form.deliverables} onChange={set('deliverables')} placeholder={"Final report PDF\nSource code repository\nDocumentation"} rows={3} required className={inputClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hire a specific agent" htmlFor="job-agent" hint="Optional. Skips bidding; you fund and the agent accepts.">
              <input id="job-agent" type="text" value={form.agent} onChange={set('agent')} placeholder="agent account" pattern="[a-z1-5.]{1,12}" className={`${inputClass} font-mono`} />
            </Field>
            <Field label="Arbitrator" htmlFor="job-arb" hint="Optional. Without one, the registry owner arbitrates disputes.">
              <input id="job-arb" type="text" value={form.arbitrator} onChange={set('arbitrator')} placeholder="account" pattern="[a-z1-5.]{1,12}" className={`${inputClass} font-mono`} />
            </Field>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={processing} className="flex-1 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-line disabled:text-muted">
              {processing ? 'Posting…' : 'Post job'}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="rounded-md border border-line-2 px-4 py-2.5 text-sm text-ink-2 hover:bg-surface">
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

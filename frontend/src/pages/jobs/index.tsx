import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { AccountAvatar } from '@/components/AccountAvatar';
import { useProton } from '@/hooks/useProton';
import { useToast } from '@/contexts/ToastContext';
import { useChainStream } from '@/hooks/useChainStream';
import {
  CONTRACTS,
  formatXpr,
  formatDate,
  getAllJobs,
  getBidCounts,
  getJobStateLabel,
  type Job,
} from '@/lib/registry';
import { STATE_COLORS, getTxId } from '@/lib/job-constants';

type FilterMode = 'all' | 'mine' | 'open';
type SortMode = 'newest' | 'oldest' | 'amount-high' | 'amount-low';

const STATE_FILTERS: { value: number | null; label: string }[] = [
  { value: null, label: 'All States' },
  { value: 0, label: 'Created' },
  { value: 1, label: 'Funded' },
  { value: 2, label: 'Accepted' },
  { value: 3, label: 'In Progress' },
  { value: 4, label: 'Delivered' },
  { value: 5, label: 'Disputed' },
  { value: 6, label: 'Completed' },
  { value: 7, label: 'Refunded' },
];

const JOBS_PER_PAGE = 12;

export default function Jobs() {
  const { session, transact } = useProton();
  const { addToast } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [stateFilter, setStateFilter] = useState<number | null>(null);
  const [sort, setSort] = useState<SortMode>('newest');
  const [page, setPage] = useState(0);

  // Create job form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newJob, setNewJob] = useState({ title: '', description: '', amount: '', deadline: '', deliverables: '', arbitrator: '' });
  const [processing, setProcessing] = useState(false);
  const submittingRef = useRef(false);

  // Bid counts for job cards
  const [bidCounts, setBidCounts] = useState<Map<number, number>>(new Map());

  // Chain stream for live updates
  const { lastEvent } = useChainStream();
  const lastEventKeyRef = useRef(0);

  useEffect(() => {
    loadJobs();
  }, []);

  // Auto-refresh on chain events
  useEffect(() => {
    if (!lastEvent || lastEvent.key === lastEventKeyRef.current) return;
    lastEventKeyRef.current = lastEvent.key;
    if (lastEvent.label.startsWith('Job') || lastEvent.label === 'Bid Submitted' || lastEvent.label === 'Dispute Raised') {
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

  const filteredJobs = jobs
    .filter((job) => {
      if (filter === 'open') return !job.agent || job.agent === '.............';
      if (filter === 'mine' && session) {
        return job.client === session.auth.actor || job.agent === session.auth.actor;
      }
      return true;
    })
    .filter((job) => stateFilter === null || job.state === stateFilter)
    .sort((a, b) => {
      switch (sort) {
        case 'oldest': return a.created_at - b.created_at;
        case 'amount-high': return b.amount - a.amount;
        case 'amount-low': return a.amount - b.amount;
        default: return b.created_at - a.created_at;
      }
    });

  const stateCounts = jobs.reduce<Record<number, number>>((acc, job) => {
    const passesMode =
      filter === 'open'
        ? !job.agent || job.agent === '.............'
        : filter === 'mine' && session
          ? job.client === session.auth.actor || job.agent === session.auth.actor
          : true;
    if (passesMode) {
      acc[job.state] = (acc[job.state] || 0) + 1;
    }
    return acc;
  }, {});

  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / JOBS_PER_PAGE));
  const currentPage = Math.min(page, totalPages - 1);
  const pagedJobs = filteredJobs.slice(currentPage * JOBS_PER_PAGE, (currentPage + 1) * JOBS_PER_PAGE);

  useEffect(() => { setPage(0); }, [filter, stateFilter, sort]);

  async function handleCreateJob(e: React.FormEvent) {
    e.preventDefault();
    if (!session || submittingRef.current) return;
    submittingRef.current = true;
    setProcessing(true);
    try {
      const amount = Math.floor(parseFloat(newJob.amount) * 10000);
      const deadlineSeconds = Math.floor(Date.now() / 1000) + parseInt(newJob.deadline) * 86400;
      const deliverables = JSON.stringify(
        newJob.deliverables.split('\n').map(d => d.trim()).filter(Boolean)
      );
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'createjob',
          data: {
            client: session.auth.actor,
            agent: '',
            title: newJob.title,
            description: newJob.description,
            deliverables,
            amount,
            symbol: 'XPR',
            deadline: deadlineSeconds,
            arbitrator: newJob.arbitrator || '',
            job_hash: '',
          },
        },
      ]);
      addToast({ type: 'success', message: 'Job posted! Agents can now submit bids.', txId: getTxId(result) });
      setShowCreateForm(false);
      setNewJob({ title: '', description: '', amount: '', deadline: '', deliverables: '', arbitrator: '' });
      await new Promise(r => setTimeout(r, 1500));
      await loadJobs();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to create job' });
    } finally {
      submittingRef.current = false;
      setProcessing(false);
    }
  }

  return (
    <>
      <Head>
        <title>Job Board - XPR Agents</title>
        <meta name="description" content="Browse open jobs and submit bids on XPR Network" />
      </Head>

      <div className="min-h-screen bg-zinc-950">
        <Header activePage="jobs" />

        <main className="max-w-6xl mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-white">Job Board</h1>
              <p className="text-sm text-zinc-500 mt-1">{filteredJobs.length} job{filteredJobs.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex gap-2">
              {session && (
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="px-4 py-2 bg-proton-purple text-white rounded-lg text-sm hover:bg-purple-700"
                >
                  Post Job
                </button>
              )}
              <button
                onClick={loadJobs}
                className="px-4 py-2 border border-zinc-700 text-zinc-300 rounded-lg hover:bg-zinc-800 text-sm"
              >
                Refresh
              </button>
            </div>
          </div>

          {/* Filter Tabs + Sort */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <div className="flex gap-1 bg-zinc-800 p-1 rounded-lg w-fit">
              {(['all', 'open', 'mine'] as FilterMode[]).map((f) => (
                <button
                  key={f}
                  onClick={() => { setFilter(f); setStateFilter(null); }}
                  className={`px-4 py-1.5 rounded-md text-sm capitalize transition-colors ${
                    filter === f
                      ? 'bg-zinc-700 text-white'
                      : 'text-zinc-400 hover:text-zinc-300'
                  }`}
                >
                  {f === 'mine' ? 'My Jobs' : f}
                </button>
              ))}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg text-sm w-fit"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="amount-high">Highest Budget</option>
              <option value="amount-low">Lowest Budget</option>
            </select>
          </div>

          {/* State Sub-filters */}
          <div className="flex flex-wrap gap-2 mb-6">
            {STATE_FILTERS.map(({ value, label }) => {
              const count = value === null
                ? Object.values(stateCounts).reduce((s, c) => s + c, 0)
                : (stateCounts[value] || 0);
              if (value !== null && count === 0) return null;
              return (
                <button
                  key={label}
                  onClick={() => setStateFilter(value)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    stateFilter === value
                      ? value === null
                        ? 'bg-zinc-600 text-white'
                        : (STATE_COLORS[value] || 'bg-zinc-500/10 text-zinc-400') + ' ring-1 ring-current'
                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-300'
                  }`}
                >
                  {label}
                  <span className="ml-1.5 opacity-60">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Create Job Modal */}
          {showCreateForm && session && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowCreateForm(false)}>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold text-white">Post a New Job</h2>
                  <button onClick={() => setShowCreateForm(false)} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">&times;</button>
                </div>
                <form onSubmit={handleCreateJob} className="space-y-4">
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">Title</label>
                    <input
                      type="text"
                      value={newJob.title}
                      onChange={(e) => setNewJob({ ...newJob, title: e.target.value })}
                      placeholder="e.g. Data analysis report"
                      required
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">Description</label>
                    <textarea
                      value={newJob.description}
                      onChange={(e) => setNewJob({ ...newJob, description: e.target.value })}
                      placeholder="Describe the job requirements..."
                      rows={3}
                      required
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-zinc-400 mb-1">Budget (XPR)</label>
                      <input
                        type="number"
                        value={newJob.amount}
                        onChange={(e) => setNewJob({ ...newJob, amount: e.target.value })}
                        placeholder="1000"
                        min="0"
                        step="0.0001"
                        required
                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-zinc-400 mb-1">Deadline (days)</label>
                      <input
                        type="number"
                        value={newJob.deadline}
                        onChange={(e) => setNewJob({ ...newJob, deadline: e.target.value })}
                        placeholder="14"
                        min="1"
                        required
                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">Deliverables (one per line)</label>
                    <textarea
                      value={newJob.deliverables}
                      onChange={(e) => setNewJob({ ...newJob, deliverables: e.target.value })}
                      placeholder={"Final report PDF\nSource code repository\nDocumentation"}
                      rows={3}
                      required
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">Arbitrator (optional)</label>
                    <input
                      type="text"
                      value={newJob.arbitrator}
                      onChange={(e) => setNewJob({ ...newJob, arbitrator: e.target.value })}
                      placeholder="Account name (leave empty for none)"
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={processing}
                      className="flex-1 px-4 py-2 bg-proton-purple text-white rounded-lg hover:bg-purple-700 disabled:bg-zinc-700 disabled:text-zinc-500"
                    >
                      {processing ? 'Creating...' : 'Post Job'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreateForm(false)}
                      className="px-4 py-2 border border-zinc-700 text-zinc-300 rounded-lg hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Jobs Grid */}
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-proton-purple"></div>
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <p className="text-lg mb-2">No jobs found</p>
              <p className="text-sm">
                {filter === 'mine' ? 'You have no jobs yet. Post one!' : 'Check back later or create a job.'}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {pagedJobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/jobs/${job.id}`}
                    className="text-left p-5 rounded-xl border border-zinc-800 bg-zinc-900 hover:border-zinc-600 transition-all group block"
                  >
                    {/* Top row: Job # + State */}
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-mono text-zinc-500">#{job.id}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATE_COLORS[job.state] || 'bg-zinc-500/10 text-zinc-400'}`}>
                        {getJobStateLabel(job.state)}
                      </span>
                    </div>

                    {/* Title */}
                    <h3 className="font-semibold text-white group-hover:text-proton-purple transition-colors line-clamp-2 mb-2">
                      {job.title}
                    </h3>

                    {/* Description preview */}
                    <p className="text-sm text-zinc-500 line-clamp-2 mb-3">{job.description}</p>

                    {/* Amount + Agent/Open */}
                    <div className="flex justify-between items-end">
                      <div>
                        <div className="text-lg font-bold text-proton-purple">{formatXpr(job.amount)}</div>
                        {job.funded_amount > 0 && job.funded_amount < job.amount && (
                          <div className="text-xs text-zinc-500">{formatXpr(job.funded_amount)} funded</div>
                        )}
                      </div>
                      <div className="text-right text-xs text-zinc-500">
                        {job.agent && job.agent !== '.............' ? (
                          <span className="text-zinc-400">{job.agent}</span>
                        ) : bidCounts.get(job.id) ? (
                          <span className="text-amber-400 font-medium">{bidCounts.get(job.id)} bid{bidCounts.get(job.id)! > 1 ? 's' : ''} waiting</span>
                        ) : (
                          <span className="text-emerald-400">Open for bids</span>
                        )}
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="mt-3 pt-3 border-t border-zinc-800 flex justify-between text-xs text-zinc-500">
                      <span className="flex items-center gap-1.5"><AccountAvatar account={job.client} size={16} /> {job.client}</span>
                      <span>{formatDate(job.created_at)}</span>
                    </div>
                  </Link>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex justify-center items-center gap-2 mt-8">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                    className="px-3 py-1.5 border border-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <div className="flex gap-1">
                    {Array.from({ length: totalPages }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setPage(i)}
                        className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                          i === currentPage
                            ? 'bg-proton-purple text-white'
                            : 'text-zinc-400 hover:bg-zinc-800'
                        }`}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={currentPage >= totalPages - 1}
                    className="px-3 py-1.5 border border-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </main>

        <Footer />
      </div>
    </>
  );
}

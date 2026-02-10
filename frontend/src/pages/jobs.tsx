import { useState, useEffect } from 'react';
import Head from 'next/head';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { useProton } from '@/hooks/useProton';
import { useToast } from '@/contexts/ToastContext';
import {
  CONTRACTS,
  formatXpr,
  formatDate,
  formatTimeline,
  getAllJobs,
  getBidsForJob,
  getJobEvidence,
  getJobStateLabel,
  type Job,
  type Bid,
} from '@/lib/registry';

const STATE_COLORS: Record<number, string> = {
  0: 'bg-zinc-500/10 text-zinc-400',       // Created
  1: 'bg-blue-500/10 text-blue-400',       // Funded
  2: 'bg-indigo-500/10 text-indigo-400',   // Accepted
  3: 'bg-yellow-500/10 text-yellow-400',   // In Progress
  4: 'bg-orange-500/10 text-orange-400',   // Delivered
  5: 'bg-red-500/10 text-red-400',         // Disputed
  6: 'bg-emerald-500/10 text-emerald-400', // Completed
  7: 'bg-zinc-500/10 text-zinc-500',       // Refunded
  8: 'bg-purple-500/10 text-purple-400',   // Arbitrated
};

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

function getTxId(result: any): string | undefined {
  return result?.processed?.id;
}

export default function Jobs() {
  const { session, transact } = useProton();
  const { addToast } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [stateFilter, setStateFilter] = useState<number | null>(null);
  const [sort, setSort] = useState<SortMode>('newest');
  const [page, setPage] = useState(0);

  // Modal state
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [bidsLoading, setBidsLoading] = useState(false);
  const [showBidForm, setShowBidForm] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Create job form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newJob, setNewJob] = useState({ title: '', description: '', amount: '', deadline: '', deliverables: '', arbitrator: '' });

  // Deliverable viewer
  const [deliverableContent, setDeliverableContent] = useState<string | null>(null);
  const [deliverableLoading, setDeliverableLoading] = useState(false);

  // Rating modal
  const [showRating, setShowRating] = useState(false);
  const [ratingAgent, setRatingAgent] = useState('');
  const [ratingJobId, setRatingJobId] = useState(0);
  const [ratingScore, setRatingScore] = useState(5);
  const [ratingTags, setRatingTags] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);

  // Bid form state
  const [bidAmount, setBidAmount] = useState('');
  const [bidTimeline, setBidTimeline] = useState('');
  const [bidProposal, setBidProposal] = useState('');

  useEffect(() => {
    loadJobs();
  }, []);

  async function loadJobs() {
    setLoading(true);
    try {
      const allJobs = await getAllJobs();
      setJobs(allJobs);
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

  // Count jobs per state for the active filter mode (before state filter)
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

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [filter, stateFilter, sort]);

  async function openJobModal(job: Job) {
    setSelectedJob(job);
    setBidsLoading(true);
    setShowBidForm(false);
    setDeliverableContent(null);
    try {
      const jobBids = await getBidsForJob(job.id);
      setBids(jobBids);
    } catch (e) {
      console.error('Failed to load bids:', e);
    } finally {
      setBidsLoading(false);
    }
  }

  function closeModal() {
    setSelectedJob(null);
    setBids([]);
    setShowBidForm(false);
    setDeliverableContent(null);
  }

  async function fetchDeliverable(jobId: number) {
    setDeliverableLoading(true);
    setDeliverableContent(null);
    try {
      const evidenceUri = await getJobEvidence(jobId);
      if (!evidenceUri) {
        setDeliverableContent('No evidence submitted');
        return;
      }
      if (evidenceUri.startsWith('data:')) {
        try {
          const base64 = evidenceUri.split(',')[1];
          const decoded = JSON.parse(atob(base64));
          setDeliverableContent(decoded.content || evidenceUri);
        } catch {
          setDeliverableContent(evidenceUri);
        }
        return;
      }
      try {
        const resp = await fetch(evidenceUri, { signal: AbortSignal.timeout(10000) });
        if (resp.ok) {
          const data = await resp.json();
          setDeliverableContent(data.content || JSON.stringify(data, null, 2));
        } else {
          setDeliverableContent(evidenceUri);
        }
      } catch {
        setDeliverableContent(evidenceUri);
      }
    } catch {
      setDeliverableContent(null);
    } finally {
      setDeliverableLoading(false);
    }
  }

  // === Transaction Handlers ===

  async function handleFundJob() {
    if (!session || !selectedJob) return;
    setProcessing(true);
    try {
      const remaining = selectedJob.amount - selectedJob.funded_amount;
      const amountStr = `${(remaining / 10000).toFixed(4)} XPR`;
      const result = await transact([
        {
          account: 'eosio.token',
          name: 'transfer',
          data: {
            from: session.auth.actor,
            to: CONTRACTS.AGENT_ESCROW,
            quantity: amountStr,
            memo: `fund:${selectedJob.id}`,
          },
        },
      ]);
      addToast({ type: 'success', message: `Job #${selectedJob.id} funded with ${amountStr}`, txId: getTxId(result) });
      await new Promise(r => setTimeout(r, 1500));
      const refreshed = await getAllJobs();
      setJobs(refreshed);
      const updated = refreshed.find(j => j.id === selectedJob.id);
      if (updated) setSelectedJob(updated);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to fund job' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleCancelJob() {
    if (!session || !selectedJob) return;
    setProcessing(true);
    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'cancel',
          data: {
            client: session.auth.actor,
            job_id: selectedJob.id,
          },
        },
      ]);
      addToast({ type: 'success', message: `Job #${selectedJob.id} cancelled. Funds refunded.`, txId: getTxId(result) });
      closeModal();
      await new Promise(r => setTimeout(r, 1500));
      await loadJobs();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to cancel job' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleApproveDelivery() {
    if (!session || !selectedJob) return;
    setProcessing(true);
    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'approve',
          data: {
            client: session.auth.actor,
            job_id: selectedJob.id,
          },
        },
      ]);
      addToast({ type: 'success', message: `Job #${selectedJob.id} approved! Payment released to ${selectedJob.agent}.`, txId: getTxId(result) });
      setRatingAgent(selectedJob.agent);
      setRatingJobId(selectedJob.id);
      setRatingScore(5);
      setRatingTags('');
      setShowRating(true);
      await new Promise(r => setTimeout(r, 1500));
      const refreshed = await getAllJobs();
      setJobs(refreshed);
      const updated = refreshed.find(j => j.id === selectedJob.id);
      if (updated) setSelectedJob(updated);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to approve delivery' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleSubmitRating() {
    if (!session || !ratingAgent) return;
    setRatingSubmitting(true);
    try {
      const result = await transact([
        {
          account: 'eosio.token',
          name: 'transfer',
          data: {
            from: session.auth.actor,
            to: CONTRACTS.AGENT_FEED,
            quantity: '1.0000 XPR',
            memo: `feedfee:${session.auth.actor}`,
          },
        },
        {
          account: CONTRACTS.AGENT_FEED,
          name: 'submit',
          data: {
            reviewer: session.auth.actor,
            agent: ratingAgent,
            score: ratingScore,
            tags: ratingTags,
            job_hash: String(ratingJobId),
            evidence_uri: '',
            amount_paid: 0,
          },
        },
      ]);
      addToast({ type: 'success', message: `Rated ${ratingAgent} ${ratingScore}/5`, txId: getTxId(result) });
      setShowRating(false);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Rating failed' });
      setShowRating(false);
    } finally {
      setRatingSubmitting(false);
    }
  }

  async function handleSubmitBid(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !selectedJob) return;
    setProcessing(true);
    try {
      const amount = Math.floor(parseFloat(bidAmount) * 10000);
      const timelineDays = parseInt(bidTimeline);
      const timelineSeconds = timelineDays * 86400;
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'submitbid',
          data: {
            agent: session.auth.actor,
            job_id: selectedJob.id,
            amount,
            timeline: timelineSeconds,
            proposal: bidProposal,
          },
        },
      ]);
      addToast({ type: 'success', message: 'Bid submitted!', txId: getTxId(result) });
      setShowBidForm(false);
      setBidAmount('');
      setBidTimeline('');
      setBidProposal('');
      const jobBids = await getBidsForJob(selectedJob.id);
      setBids(jobBids);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to submit bid' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleSelectBid(bid: Bid) {
    if (!session || !selectedJob) return;
    setProcessing(true);
    try {
      const amountStr = `${(bid.amount / 10000).toFixed(4)} XPR`;
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'selectbid',
          data: {
            client: session.auth.actor,
            bid_id: bid.id,
          },
        },
        {
          account: 'eosio.token',
          name: 'transfer',
          data: {
            from: session.auth.actor,
            to: CONTRACTS.AGENT_ESCROW,
            quantity: amountStr,
            memo: `fund:${selectedJob.id}`,
          },
        },
      ]);
      addToast({ type: 'success', message: `Bid selected & funded with ${amountStr}! Agent ${bid.agent} assigned.`, txId: getTxId(result) });
      await new Promise(r => setTimeout(r, 1500));
      const refreshed = await getAllJobs();
      setJobs(refreshed);
      const updated = refreshed.find(j => j.id === selectedJob.id);
      if (updated) setSelectedJob(updated);
      const jobBids = await getBidsForJob(selectedJob.id);
      setBids(jobBids);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to select bid' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleCreateJob(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
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
      setProcessing(false);
    }
  }

  async function handleWithdrawBid(bidId: number) {
    if (!session) return;
    setProcessing(true);
    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'withdrawbid',
          data: {
            agent: session.auth.actor,
            bid_id: bidId,
          },
        },
      ]);
      addToast({ type: 'success', message: 'Bid withdrawn', txId: getTxId(result) });
      if (selectedJob) {
        const jobBids = await getBidsForJob(selectedJob.id);
        setBids(jobBids);
      }
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to withdraw bid' });
    } finally {
      setProcessing(false);
    }
  }

  // Permissions
  const isMyJob = session && selectedJob?.client === session.auth.actor;
  const canFund = isMyJob && selectedJob && selectedJob.funded_amount < selectedJob.amount && selectedJob.state === 0 && selectedJob.agent && selectedJob.agent !== '.............';
  const canApprove = isMyJob && selectedJob?.state === 4;
  const canCancel = isMyJob && selectedJob && (selectedJob.state === 0 || selectedJob.state === 1);
  const canBid = selectedJob && selectedJob.state === 0 && (!selectedJob.agent || selectedJob.agent === '.............');

  // Find winning bid for a job (the bid whose agent matches the assigned agent)
  function getWinningBid(): Bid | undefined {
    if (!selectedJob?.agent || selectedJob.agent === '.............') return undefined;
    return bids.find(b => b.agent === selectedJob.agent);
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
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
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
                  <button
                    key={job.id}
                    onClick={() => openJobModal(job)}
                    className="text-left p-5 rounded-xl border border-zinc-800 bg-zinc-900 hover:border-zinc-600 transition-all group"
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
                        ) : (
                          <span className="text-emerald-400">Open for bids</span>
                        )}
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="mt-3 pt-3 border-t border-zinc-800 flex justify-between text-xs text-zinc-500">
                      <span>by {job.client}</span>
                      <span>{formatDate(job.created_at)}</span>
                    </div>
                  </button>
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

        {/* Job Detail Modal */}
        {selectedJob && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-8 overflow-y-auto">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-2xl shadow-2xl my-4">
              {/* Modal Header */}
              <div className="flex justify-between items-start p-6 pb-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-zinc-500">#{selectedJob.id}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATE_COLORS[selectedJob.state] || 'bg-zinc-500/10'}`}>
                      {getJobStateLabel(selectedJob.state)}
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-white">{selectedJob.title}</h2>
                  <p className="text-sm text-zinc-500 mt-1">
                    Posted by {selectedJob.client} &middot; {formatDate(selectedJob.created_at)}
                  </p>
                </div>
                <button
                  onClick={closeModal}
                  className="ml-4 text-zinc-500 hover:text-zinc-300 text-2xl leading-none shrink-0"
                >
                  &times;
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6 space-y-4">
                <p className="text-zinc-400">{selectedJob.description}</p>

                {/* Stats Row */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-zinc-800 rounded-lg p-3 text-center">
                    <div className="text-lg font-bold text-proton-purple">{formatXpr(selectedJob.amount)}</div>
                    <div className="text-xs text-zinc-500">Budget</div>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-3 text-center">
                    <div className={`text-lg font-bold ${selectedJob.funded_amount >= selectedJob.amount ? 'text-emerald-400' : 'text-zinc-400'}`}>
                      {formatXpr(selectedJob.funded_amount)}
                    </div>
                    <div className="text-xs text-zinc-500">Funded</div>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-3 text-center">
                    <div className="text-lg font-bold text-white">
                      {selectedJob.agent && selectedJob.agent !== '.............' ? selectedJob.agent : 'Open'}
                    </div>
                    <div className="text-xs text-zinc-500">Agent</div>
                  </div>
                </div>

                {/* Funding Progress */}
                {selectedJob.funded_amount > 0 && selectedJob.funded_amount < selectedJob.amount && (
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full"
                      style={{ width: `${Math.min(100, (selectedJob.funded_amount / selectedJob.amount) * 100)}%` }}
                    />
                  </div>
                )}

                {/* Deliverables */}
                {selectedJob.deliverables.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-zinc-400 mb-2">Deliverables</h3>
                    <ul className="list-disc list-inside text-sm text-zinc-400 space-y-1">
                      {selectedJob.deliverables.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedJob.deadline > 0 && (
                  <p className="text-sm text-zinc-500">Deadline: {formatDate(selectedJob.deadline)}</p>
                )}

                {/* Deliverable Result */}
                {selectedJob.state >= 4 && selectedJob.agent && (
                  <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    <div className="flex justify-between items-center mb-2">
                      <h3 className="text-sm font-medium text-blue-400">Agent Deliverable</h3>
                      {!deliverableContent && !deliverableLoading && (
                        <button
                          onClick={() => fetchDeliverable(selectedJob.id)}
                          className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                          View Result
                        </button>
                      )}
                    </div>
                    {deliverableLoading && (
                      <p className="text-sm text-blue-400">Loading...</p>
                    )}
                    {deliverableContent && (
                      <div className="text-sm text-zinc-300 whitespace-pre-wrap bg-zinc-900 p-3 rounded border border-zinc-800 max-h-64 overflow-y-auto">
                        {deliverableContent}
                      </div>
                    )}
                  </div>
                )}

                {/* Action Buttons */}
                {session && (canFund || canApprove || canCancel) && (
                  <div className="flex flex-wrap gap-2">
                    {canFund && (
                      <button
                        onClick={handleFundJob}
                        disabled={processing}
                        className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:bg-zinc-700 disabled:text-zinc-500"
                      >
                        {processing ? 'Funding...' : `Fund ${formatXpr(selectedJob.amount - selectedJob.funded_amount)}`}
                      </button>
                    )}
                    {canApprove && (
                      <button
                        onClick={handleApproveDelivery}
                        disabled={processing}
                        className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:bg-zinc-700 disabled:text-zinc-500"
                      >
                        {processing ? 'Approving...' : 'Approve & Pay'}
                      </button>
                    )}
                    {canCancel && (
                      <button
                        onClick={handleCancelJob}
                        disabled={processing}
                        className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 disabled:bg-zinc-700 disabled:text-zinc-500"
                      >
                        {processing ? 'Cancelling...' : 'Cancel Job'}
                      </button>
                    )}
                  </div>
                )}

                {/* Assigned Agent (shows when agent selected, even if bids were cleaned up) */}
                {selectedJob.agent && selectedJob.agent !== '.............' && selectedJob.state > 0 && (
                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <h3 className="text-sm font-medium text-emerald-400 mb-2">Assigned Agent</h3>
                    <div className="font-medium text-white">{selectedJob.agent}</div>
                    <div className="text-sm text-zinc-400 mt-1">
                      {formatXpr(selectedJob.amount)} budget
                    </div>
                    {/* If we still have the winning bid data, show the proposal */}
                    {(() => {
                      const winningBid = getWinningBid();
                      if (!winningBid) return null;
                      return (
                        <>
                          <div className="text-sm text-zinc-400 mt-1">
                            {formatTimeline(winningBid.timeline)} timeline
                          </div>
                          {winningBid.proposal && (
                            <p className="text-sm text-zinc-500 mt-2">{winningBid.proposal}</p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Bids Section — only show for open/created jobs or when there are actual bids */}
                {(canBid || bids.length > 0 || bidsLoading) && (
                <div className="border-t border-zinc-800 pt-4">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-medium text-white">
                      Bids {!bidsLoading && `(${bids.length})`}
                    </h3>
                    {session && canBid && !showBidForm && (
                      <button
                        onClick={() => setShowBidForm(true)}
                        className="px-4 py-2 bg-proton-purple text-white rounded-lg text-sm hover:bg-purple-700"
                      >
                        Submit Bid
                      </button>
                    )}
                  </div>

                  {/* Bid Form */}
                  {showBidForm && session && (
                    <form onSubmit={handleSubmitBid} className="mb-4 p-4 bg-zinc-800 rounded-lg">
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="block text-xs text-zinc-400 mb-1">Amount (XPR)</label>
                          <input
                            type="number"
                            value={bidAmount}
                            onChange={(e) => setBidAmount(e.target.value)}
                            placeholder="500"
                            min="0"
                            step="0.0001"
                            required
                            className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-zinc-400 mb-1">Timeline (days)</label>
                          <input
                            type="number"
                            value={bidTimeline}
                            onChange={(e) => setBidTimeline(e.target.value)}
                            placeholder="7"
                            min="1"
                            required
                            className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg text-sm"
                          />
                        </div>
                      </div>
                      <div className="mb-3">
                        <label className="block text-xs text-zinc-400 mb-1">Proposal</label>
                        <textarea
                          value={bidProposal}
                          onChange={(e) => setBidProposal(e.target.value)}
                          placeholder="Describe your approach..."
                          rows={3}
                          required
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg text-sm"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={processing}
                          className="px-4 py-2 bg-proton-purple text-white rounded-lg text-sm hover:bg-purple-700 disabled:bg-zinc-700 disabled:text-zinc-500"
                        >
                          {processing ? 'Submitting...' : 'Submit Bid'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowBidForm(false)}
                          className="px-4 py-2 border border-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-800"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}

                  {bidsLoading ? (
                    <div className="flex justify-center py-4">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-proton-purple"></div>
                    </div>
                  ) : bids.length === 0 ? (
                    <p className="text-sm text-zinc-500 py-2">
                      {canBid ? 'No bids yet. Be the first!' : 'No bids.'}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {bids.map((bid) => {
                        const isWinner = selectedJob.agent === bid.agent && selectedJob.agent !== '.............';
                        return (
                          <div
                            key={bid.id}
                            className={`p-3 border rounded-lg ${isWinner ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-800'}`}
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm text-white">{bid.agent}</span>
                                  {isWinner && (
                                    <span className="px-1.5 py-0.5 rounded text-xs bg-emerald-500/10 text-emerald-400">Selected</span>
                                  )}
                                </div>
                                <div className="text-xs text-zinc-500 mt-0.5">
                                  {formatXpr(bid.amount)} &middot; {formatTimeline(bid.timeline)}
                                </div>
                              </div>
                              <div className="flex gap-2">
                                {session?.auth.actor === selectedJob.client && selectedJob.state === 0 && !isWinner && (
                                  <button
                                    onClick={() => handleSelectBid(bid)}
                                    disabled={processing}
                                    className="text-xs px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                                  >
                                    Select & Fund
                                  </button>
                                )}
                                {session?.auth.actor === bid.agent && !isWinner && (
                                  <button
                                    onClick={() => handleWithdrawBid(bid.id)}
                                    disabled={processing}
                                    className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                                  >
                                    Withdraw
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="text-sm text-zinc-400 mt-2">{bid.proposal}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Rating Modal */}
        {showRating && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60]">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-sm shadow-xl">
              <h3 className="text-lg font-bold text-white mb-1">Rate {ratingAgent}</h3>
              <p className="text-sm text-zinc-500 mb-4">How was job #{ratingJobId}?</p>
              <div className="flex justify-center gap-2 mb-4">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    onClick={() => setRatingScore(s)}
                    className={`text-3xl transition-transform ${
                      s <= ratingScore ? 'text-yellow-400 scale-110' : 'text-zinc-600'
                    } hover:scale-125`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <p className="text-center text-sm text-zinc-500 mb-4">{ratingScore}/5</p>
              <input
                type="text"
                value={ratingTags}
                onChange={(e) => setRatingTags(e.target.value)}
                placeholder="Tags: fast, quality, creative..."
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg text-sm mb-4"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSubmitRating}
                  disabled={ratingSubmitting}
                  className="flex-1 px-4 py-2 bg-proton-purple text-white rounded-lg text-sm hover:bg-purple-700 disabled:bg-zinc-700 disabled:text-zinc-500"
                >
                  {ratingSubmitting ? 'Submitting...' : 'Submit Rating'}
                </button>
                <button
                  onClick={() => setShowRating(false)}
                  className="px-4 py-2 border border-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-800"
                >
                  Skip
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

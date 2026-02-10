import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { useProton } from '@/hooks/useProton';
import {
  CONTRACTS,
  formatXpr,
  formatDate,
  formatTimeline,
  getAgent,
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

export default function Jobs() {
  const { session, transact } = useProton();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [bidsLoading, setBidsLoading] = useState(false);
  const [showBidForm, setShowBidForm] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');

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

  const filteredJobs = jobs.filter((job) => {
    if (filter === 'open') return !job.agent || job.agent === '.............';
    if (filter === 'mine' && session) {
      return job.client === session.auth.actor || job.agent === session.auth.actor;
    }
    return true;
  });

  async function fetchDeliverable(_agentAccount: string, jobId: number) {
    setDeliverableLoading(true);
    setDeliverableContent(null);
    try {
      const evidenceUri = await getJobEvidence(jobId);
      if (!evidenceUri) {
        setDeliverableContent('No evidence submitted');
        return;
      }

      // Handle data URIs (content embedded directly)
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

      // Handle IPFS/HTTP URLs
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

  async function selectJob(job: Job) {
    setSelectedJob(job);
    setBidsLoading(true);
    setShowBidForm(false);
    setDeliverableContent(null);
    setError(null);
    setSuccess(null);
    try {
      const jobBids = await getBidsForJob(job.id);
      setBids(jobBids);
    } catch (e) {
      console.error('Failed to load bids:', e);
    } finally {
      setBidsLoading(false);
    }
  }

  async function handleFundJob() {
    if (!session || !selectedJob) return;

    setProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      const remaining = selectedJob.amount - selectedJob.funded_amount;
      const amountStr = `${(remaining / 10000).toFixed(4)} XPR`;

      await transact([
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

      setSuccess(`Job #${selectedJob.id} funded with ${amountStr}!`);
      // Wait for chain to process the block before re-fetching
      await new Promise(r => setTimeout(r, 1500));
      const refreshed = await getAllJobs();
      setJobs(refreshed);
      const updated = refreshed.find(j => j.id === selectedJob.id);
      if (updated) setSelectedJob(updated);
    } catch (e: any) {
      setError(e.message || 'Failed to fund job');
    } finally {
      setProcessing(false);
    }
  }

  async function handleCancelJob() {
    if (!session || !selectedJob) return;

    setProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'cancel',
          data: {
            client: session.auth.actor,
            job_id: selectedJob.id,
          },
        },
      ]);

      setSuccess(`Job #${selectedJob.id} cancelled. Funds refunded.`);
      await new Promise(r => setTimeout(r, 1500));
      const refreshed = await getAllJobs();
      setJobs(refreshed);
      setSelectedJob(null);
    } catch (e: any) {
      setError(e.message || 'Failed to cancel job');
    } finally {
      setProcessing(false);
    }
  }

  async function handleApproveDelivery() {
    if (!session || !selectedJob) return;

    setProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'approve',
          data: {
            client: session.auth.actor,
            job_id: selectedJob.id,
          },
        },
      ]);

      setSuccess(`Job #${selectedJob.id} approved! Payment released to ${selectedJob.agent}.`);
      // Show rating modal
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
      setError(e.message || 'Failed to approve delivery');
    } finally {
      setProcessing(false);
    }
  }

  async function handleSubmitRating() {
    if (!session || !ratingAgent) return;

    setRatingSubmitting(true);
    try {
      await transact([
        // Pay feedback fee (1 XPR) first
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
        // Then submit the rating
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
      setSuccess(`Rated ${ratingAgent} ${ratingScore}/5!`);
      setShowRating(false);
    } catch (e: any) {
      // Don't block — rating is optional
      console.error('Rating failed:', e);
      setError(e.message || 'Rating failed');
      setShowRating(false);
    } finally {
      setRatingSubmitting(false);
    }
  }

  async function handleSubmitBid(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !selectedJob) return;

    setProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      const amount = Math.floor(parseFloat(bidAmount) * 10000);
      const timelineDays = parseInt(bidTimeline);
      const timelineSeconds = timelineDays * 86400;

      await transact([
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

      setSuccess('Bid submitted successfully!');
      setShowBidForm(false);
      setBidAmount('');
      setBidTimeline('');
      setBidProposal('');

      // Reload bids
      const jobBids = await getBidsForJob(selectedJob.id);
      setBids(jobBids);
    } catch (e: any) {
      setError(e.message || 'Failed to submit bid');
    } finally {
      setProcessing(false);
    }
  }

  async function handleSelectBid(bid: Bid) {
    if (!session || !selectedJob) return;

    setProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      const amountStr = `${(bid.amount / 10000).toFixed(4)} XPR`;

      // Select bid + fund in one transaction
      await transact([
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

      setSuccess(`Bid selected and job funded with ${amountStr}! Agent ${bid.agent} assigned.`);
      await new Promise(r => setTimeout(r, 1500));
      const refreshed = await getAllJobs();
      setJobs(refreshed);
      const updated = refreshed.find(j => j.id === selectedJob.id);
      if (updated) setSelectedJob(updated);
      const jobBids = await getBidsForJob(selectedJob.id);
      setBids(jobBids);
    } catch (e: any) {
      setError(e.message || 'Failed to select bid');
    } finally {
      setProcessing(false);
    }
  }

  async function handleCreateJob(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;

    setProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      const amount = Math.floor(parseFloat(newJob.amount) * 10000);
      const deadlineSeconds = Math.floor(Date.now() / 1000) + parseInt(newJob.deadline) * 86400;
      const deliverables = JSON.stringify(
        newJob.deliverables.split('\n').map(d => d.trim()).filter(Boolean)
      );

      // Open jobs (no agent) must NOT be funded until a bid is selected
      // Direct-hire jobs (agent specified) can be funded immediately
      const isOpenJob = !newJob.arbitrator; // always open for now
      const actions: any[] = [
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'createjob',
          data: {
            client: session.auth.actor,
            agent: '', // open job
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
      ];

      await transact(actions);

      setSuccess('Job posted! Agents can now submit bids. Fund after selecting a bid.');
      setShowCreateForm(false);
      setNewJob({ title: '', description: '', amount: '', deadline: '', deliverables: '', arbitrator: '' });
      await new Promise(r => setTimeout(r, 1500));
      await loadJobs();
    } catch (e: any) {
      setError(e.message || 'Failed to create job');
    } finally {
      setProcessing(false);
    }
  }

  async function handleWithdrawBid(bidId: number) {
    if (!session) return;

    setProcessing(true);
    setError(null);

    try {
      await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'withdrawbid',
          data: {
            agent: session.auth.actor,
            bid_id: bidId,
          },
        },
      ]);

      setSuccess('Bid withdrawn');
      if (selectedJob) {
        const jobBids = await getBidsForJob(selectedJob.id);
        setBids(jobBids);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to withdraw bid');
    } finally {
      setProcessing(false);
    }
  }

  const isMyJob = session && selectedJob?.client === session.auth.actor;
  // Can fund: client owns job, not fully funded, state is CREATED (0) with agent assigned (bid selected)
  const canFund = isMyJob && selectedJob && selectedJob.funded_amount < selectedJob.amount && selectedJob.state === 0 && selectedJob.agent && selectedJob.agent !== '.............';
  const canApprove = isMyJob && selectedJob?.state === 4; // DELIVERED
  const canCancel = isMyJob && selectedJob && (selectedJob.state === 0 || selectedJob.state === 1); // CREATED or FUNDED
  const canBid = selectedJob && selectedJob.state === 0 && (!selectedJob.agent || selectedJob.agent === '.............');

  return (
    <>
      <Head>
        <title>Job Board - XPR Agents</title>
        <meta name="description" content="Browse open jobs and submit bids on XPR Network" />
      </Head>

      <div className="min-h-screen bg-zinc-950">
        <Header activePage="jobs" />

        <main className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-white">Job Board</h1>
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

          {/* Filter Tabs */}
          <div className="flex gap-1 mb-6 bg-zinc-800 p-1 rounded-lg w-fit">
            {(['all', 'open', 'mine'] as FilterMode[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
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

          {/* Create Job Form */}
          {showCreateForm && session && (
            <div className="mb-6 bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-white">Post a New Job</h2>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="text-zinc-500 hover:text-zinc-300"
                >
                  Cancel
                </button>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">Budget (XPR)</label>
                    <input
                      type="number"
                      value={newJob.amount}
                      onChange={(e) => setNewJob({ ...newJob, amount: e.target.value })}
                      placeholder="e.g. 1000"
                      min="0"
                      step="0.0001"
                      required
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">Deadline (days from now)</label>
                    <input
                      type="number"
                      value={newJob.deadline}
                      onChange={(e) => setNewJob({ ...newJob, deadline: e.target.value })}
                      placeholder="e.g. 14"
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
                <button
                  type="submit"
                  disabled={processing}
                  className="px-6 py-2 bg-proton-purple text-white rounded-lg hover:bg-purple-700 disabled:bg-zinc-700 disabled:text-zinc-500"
                >
                  {processing ? 'Creating...' : 'Post Job'}
                </button>
              </form>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 text-red-400 rounded-lg text-sm">{error}</div>
          )}
          {success && (
            <div className="mb-4 p-3 bg-emerald-500/10 text-emerald-400 rounded-lg text-sm">{success}</div>
          )}

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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Job List */}
              <div className="md:col-span-1 space-y-3">
                {filteredJobs.map((job) => (
                  <button
                    key={job.id}
                    onClick={() => selectJob(job)}
                    className={`w-full text-left p-4 rounded-lg border transition-colors ${
                      selectedJob?.id === job.id
                        ? 'border-proton-purple bg-proton-purple/10'
                        : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="font-medium text-white truncate flex-1">{job.title}</div>
                      <span className={`ml-2 px-1.5 py-0.5 rounded text-xs whitespace-nowrap ${STATE_COLORS[job.state] || 'bg-zinc-500/10 text-zinc-400'}`}>
                        {getJobStateLabel(job.state)}
                      </span>
                    </div>
                    <div className="text-sm text-zinc-400 mt-1">
                      {formatXpr(job.amount)}
                      {job.funded_amount < job.amount && job.state === 0 && !job.agent && (
                        <span className="text-zinc-500 ml-1">(awaiting bids)</span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      {job.agent ? `Agent: ${job.agent}` : 'Open'} &middot; by {job.client}
                    </div>
                  </button>
                ))}
              </div>

              {/* Job Detail */}
              <div className="md:col-span-2">
                {selectedJob ? (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h2 className="text-xl font-bold text-white">{selectedJob.title}</h2>
                        <p className="text-sm text-zinc-500 mt-1">
                          Posted by {selectedJob.client} &middot; {formatDate(selectedJob.created_at)}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-semibold text-proton-purple">
                          {formatXpr(selectedJob.amount)}
                        </div>
                        <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs ${STATE_COLORS[selectedJob.state] || 'bg-zinc-500/10'}`}>
                          {getJobStateLabel(selectedJob.state)}
                        </span>
                      </div>
                    </div>

                    <p className="text-zinc-400 mb-4">{selectedJob.description}</p>

                    {/* Funding Status */}
                    <div className="mb-4 p-3 bg-zinc-800 rounded-lg">
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-400">Funded</span>
                        <span className={selectedJob.funded_amount >= selectedJob.amount ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>
                          {formatXpr(selectedJob.funded_amount)} / {formatXpr(selectedJob.amount)}
                        </span>
                      </div>
                      {selectedJob.funded_amount > 0 && (
                        <div className="mt-2 h-2 bg-zinc-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${Math.min(100, (selectedJob.funded_amount / selectedJob.amount) * 100)}%` }}
                          />
                        </div>
                      )}
                      {selectedJob.agent && (
                        <div className="flex justify-between text-sm mt-2">
                          <span className="text-zinc-400">Agent</span>
                          <span className="font-medium text-white">{selectedJob.agent}</span>
                        </div>
                      )}
                    </div>

                    {selectedJob.deliverables.length > 0 && (
                      <div className="mb-4">
                        <h3 className="text-sm font-medium text-zinc-400 mb-2">Deliverables</h3>
                        <ul className="list-disc list-inside text-sm text-zinc-400">
                          {selectedJob.deliverables.map((d, i) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selectedJob.deadline > 0 && (
                      <p className="text-sm text-zinc-500 mb-4">
                        Deadline: {formatDate(selectedJob.deadline)}
                      </p>
                    )}

                    {/* Deliverable Result */}
                    {selectedJob.state >= 4 && selectedJob.agent && (
                      <div className="mb-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                        <div className="flex justify-between items-center mb-2">
                          <h3 className="text-sm font-medium text-blue-400">Agent Deliverable</h3>
                          {!deliverableContent && !deliverableLoading && (
                            <button
                              onClick={() => fetchDeliverable(selectedJob.agent, selectedJob.id)}
                              className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              View Result
                            </button>
                          )}
                        </div>
                        {deliverableLoading && (
                          <p className="text-sm text-blue-400">Loading deliverable...</p>
                        )}
                        {deliverableContent && (
                          <div className="text-sm text-zinc-300 whitespace-pre-wrap bg-zinc-900 p-3 rounded border border-zinc-800 max-h-96 overflow-y-auto">
                            {deliverableContent}
                          </div>
                        )}
                        {!deliverableContent && !deliverableLoading && (
                          <p className="text-xs text-blue-500/70">Click to fetch the deliverable from the agent&apos;s endpoint</p>
                        )}
                      </div>
                    )}

                    {/* Action Buttons */}
                    {session && (
                      <div className="flex gap-2 mb-4">
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

                    {/* Bids Section */}
                    <div className="border-t border-zinc-800 pt-4 mt-4">
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
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                            <div>
                              <label className="block text-xs text-zinc-400 mb-1">Amount (XPR)</label>
                              <input
                                type="number"
                                value={bidAmount}
                                onChange={(e) => setBidAmount(e.target.value)}
                                placeholder="e.g. 500"
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
                                placeholder="e.g. 7"
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
                              placeholder="Describe your approach and qualifications..."
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
                          {bids.map((bid) => (
                            <div
                              key={bid.id}
                              className="p-3 border border-zinc-800 rounded-lg"
                            >
                              <div className="flex justify-between items-start">
                                <div>
                                  <div className="font-medium text-sm text-white">{bid.agent}</div>
                                  <div className="text-xs text-zinc-500 mt-0.5">
                                    {formatXpr(bid.amount)} &middot; {formatTimeline(bid.timeline)}
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  {session?.auth.actor === selectedJob.client && selectedJob.state === 0 && (
                                    <button
                                      onClick={() => handleSelectBid(bid)}
                                      disabled={processing}
                                      className="text-xs px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                      Select & Fund
                                    </button>
                                  )}
                                  {session?.auth.actor === bid.agent && (
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
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center text-zinc-500">
                    <p>Select a job to view details</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* Rating Modal */}
        {showRating && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
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

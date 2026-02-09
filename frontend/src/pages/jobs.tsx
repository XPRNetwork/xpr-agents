import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { WalletButton } from '@/components/WalletButton';
import { useProton } from '@/hooks/useProton';
import {
  CONTRACTS,
  formatXpr,
  formatDate,
  formatTimeline,
  getAllJobs,
  getBidsForJob,
  getJobStateLabel,
  type Job,
  type Bid,
} from '@/lib/registry';

const STATE_COLORS: Record<number, string> = {
  0: 'bg-gray-100 text-gray-700',     // Created
  1: 'bg-blue-100 text-blue-700',     // Funded
  2: 'bg-indigo-100 text-indigo-700', // Accepted
  3: 'bg-yellow-100 text-yellow-700', // In Progress
  4: 'bg-orange-100 text-orange-700', // Delivered
  5: 'bg-red-100 text-red-700',       // Disputed
  6: 'bg-green-100 text-green-700',   // Completed
  7: 'bg-gray-100 text-gray-500',     // Refunded
  8: 'bg-purple-100 text-purple-700', // Arbitrated
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

  async function selectJob(job: Job) {
    setSelectedJob(job);
    setBidsLoading(true);
    setShowBidForm(false);
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

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl font-bold text-proton-purple">XPR Agents</span>
            </Link>
            <nav className="flex items-center gap-6">
              <Link href="/" className="text-gray-600 hover:text-gray-900">
                Discover
              </Link>
              <Link href="/jobs" className="text-proton-purple font-medium">
                Jobs
              </Link>
              <Link href="/register" className="text-gray-600 hover:text-gray-900">
                Register
              </Link>
              <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
                Dashboard
              </Link>
              <WalletButton />
            </nav>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold">Job Board</h1>
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
                className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm"
              >
                Refresh
              </button>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
            {(['all', 'open', 'mine'] as FilterMode[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-1.5 rounded-md text-sm capitalize transition-colors ${
                  filter === f
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {f === 'mine' ? 'My Jobs' : f}
              </button>
            ))}
          </div>

          {/* Create Job Form */}
          {showCreateForm && session && (
            <div className="mb-6 bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold">Post a New Job</h2>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  Cancel
                </button>
              </div>
              <form onSubmit={handleCreateJob} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Title</label>
                  <input
                    type="text"
                    value={newJob.title}
                    onChange={(e) => setNewJob({ ...newJob, title: e.target.value })}
                    placeholder="e.g. Data analysis report"
                    required
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Description</label>
                  <textarea
                    value={newJob.description}
                    onChange={(e) => setNewJob({ ...newJob, description: e.target.value })}
                    placeholder="Describe the job requirements..."
                    rows={3}
                    required
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">Budget (XPR)</label>
                    <input
                      type="number"
                      value={newJob.amount}
                      onChange={(e) => setNewJob({ ...newJob, amount: e.target.value })}
                      placeholder="e.g. 1000"
                      min="0"
                      step="0.0001"
                      required
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">Deadline (days from now)</label>
                    <input
                      type="number"
                      value={newJob.deadline}
                      onChange={(e) => setNewJob({ ...newJob, deadline: e.target.value })}
                      placeholder="e.g. 14"
                      min="1"
                      required
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Deliverables (one per line)</label>
                  <textarea
                    value={newJob.deliverables}
                    onChange={(e) => setNewJob({ ...newJob, deliverables: e.target.value })}
                    placeholder={"Final report PDF\nSource code repository\nDocumentation"}
                    rows={3}
                    required
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Arbitrator (optional)</label>
                  <input
                    type="text"
                    value={newJob.arbitrator}
                    onChange={(e) => setNewJob({ ...newJob, arbitrator: e.target.value })}
                    placeholder="Account name (leave empty for none)"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                  />
                </div>
                <button
                  type="submit"
                  disabled={processing}
                  className="px-6 py-2 bg-proton-purple text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300"
                >
                  {processing ? 'Creating...' : 'Post Job'}
                </button>
              </form>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
          )}
          {success && (
            <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">{success}</div>
          )}

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-proton-purple"></div>
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg mb-2">No jobs found</p>
              <p className="text-sm">
                {filter === 'mine' ? 'You have no jobs yet. Post one!' : 'Check back later or create a job.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-6">
              {/* Job List */}
              <div className="col-span-1 space-y-3">
                {filteredJobs.map((job) => (
                  <button
                    key={job.id}
                    onClick={() => selectJob(job)}
                    className={`w-full text-left p-4 rounded-lg border transition-colors ${
                      selectedJob?.id === job.id
                        ? 'border-proton-purple bg-purple-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="font-medium truncate flex-1">{job.title}</div>
                      <span className={`ml-2 px-1.5 py-0.5 rounded text-xs whitespace-nowrap ${STATE_COLORS[job.state] || 'bg-gray-100 text-gray-600'}`}>
                        {getJobStateLabel(job.state)}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      {formatXpr(job.amount)}
                      {job.funded_amount < job.amount && job.state === 0 && !job.agent && (
                        <span className="text-gray-400 ml-1">(awaiting bids)</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {job.agent ? `Agent: ${job.agent}` : 'Open'} &middot; by {job.client}
                    </div>
                  </button>
                ))}
              </div>

              {/* Job Detail */}
              <div className="col-span-2">
                {selectedJob ? (
                  <div className="bg-white border border-gray-200 rounded-lg p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h2 className="text-xl font-bold">{selectedJob.title}</h2>
                        <p className="text-sm text-gray-500 mt-1">
                          Posted by {selectedJob.client} &middot; {formatDate(selectedJob.created_at)}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-semibold text-proton-purple">
                          {formatXpr(selectedJob.amount)}
                        </div>
                        <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs ${STATE_COLORS[selectedJob.state] || 'bg-gray-100'}`}>
                          {getJobStateLabel(selectedJob.state)}
                        </span>
                      </div>
                    </div>

                    <p className="text-gray-600 mb-4">{selectedJob.description}</p>

                    {/* Funding Status */}
                    <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Funded</span>
                        <span className={selectedJob.funded_amount >= selectedJob.amount ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>
                          {formatXpr(selectedJob.funded_amount)} / {formatXpr(selectedJob.amount)}
                        </span>
                      </div>
                      {selectedJob.funded_amount > 0 && (
                        <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500 rounded-full"
                            style={{ width: `${Math.min(100, (selectedJob.funded_amount / selectedJob.amount) * 100)}%` }}
                          />
                        </div>
                      )}
                      {selectedJob.agent && (
                        <div className="flex justify-between text-sm mt-2">
                          <span className="text-gray-500">Agent</span>
                          <span className="font-medium">{selectedJob.agent}</span>
                        </div>
                      )}
                    </div>

                    {selectedJob.deliverables.length > 0 && (
                      <div className="mb-4">
                        <h3 className="text-sm font-medium text-gray-500 mb-2">Deliverables</h3>
                        <ul className="list-disc list-inside text-sm text-gray-600">
                          {selectedJob.deliverables.map((d, i) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selectedJob.deadline > 0 && (
                      <p className="text-sm text-gray-500 mb-4">
                        Deadline: {formatDate(selectedJob.deadline)}
                      </p>
                    )}

                    {/* Action Buttons */}
                    {session && (
                      <div className="flex gap-2 mb-4">
                        {canFund && (
                          <button
                            onClick={handleFundJob}
                            disabled={processing}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:bg-gray-300"
                          >
                            {processing ? 'Funding...' : `Fund ${formatXpr(selectedJob.amount - selectedJob.funded_amount)}`}
                          </button>
                        )}
                        {canApprove && (
                          <button
                            onClick={handleApproveDelivery}
                            disabled={processing}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:bg-gray-300"
                          >
                            {processing ? 'Approving...' : 'Approve & Pay'}
                          </button>
                        )}
                        {canCancel && (
                          <button
                            onClick={handleCancelJob}
                            disabled={processing}
                            className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 disabled:bg-gray-300"
                          >
                            {processing ? 'Cancelling...' : 'Cancel Job'}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Bids Section */}
                    <div className="border-t border-gray-100 pt-4 mt-4">
                      <div className="flex justify-between items-center mb-3">
                        <h3 className="font-medium">
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
                        <form onSubmit={handleSubmitBid} className="mb-4 p-4 bg-gray-50 rounded-lg">
                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Amount (XPR)</label>
                              <input
                                type="number"
                                value={bidAmount}
                                onChange={(e) => setBidAmount(e.target.value)}
                                placeholder="e.g. 500"
                                min="0"
                                step="0.0001"
                                required
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Timeline (days)</label>
                              <input
                                type="number"
                                value={bidTimeline}
                                onChange={(e) => setBidTimeline(e.target.value)}
                                placeholder="e.g. 7"
                                min="1"
                                required
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                              />
                            </div>
                          </div>
                          <div className="mb-3">
                            <label className="block text-xs text-gray-500 mb-1">Proposal</label>
                            <textarea
                              value={bidProposal}
                              onChange={(e) => setBidProposal(e.target.value)}
                              placeholder="Describe your approach and qualifications..."
                              rows={3}
                              required
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="submit"
                              disabled={processing}
                              className="px-4 py-2 bg-proton-purple text-white rounded-lg text-sm hover:bg-purple-700 disabled:bg-gray-300"
                            >
                              {processing ? 'Submitting...' : 'Submit Bid'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowBidForm(false)}
                              className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
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
                        <p className="text-sm text-gray-500 py-2">
                          {canBid ? 'No bids yet. Be the first!' : 'No bids.'}
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {bids.map((bid) => (
                            <div
                              key={bid.id}
                              className="p-3 border border-gray-100 rounded-lg"
                            >
                              <div className="flex justify-between items-start">
                                <div>
                                  <div className="font-medium text-sm">{bid.agent}</div>
                                  <div className="text-xs text-gray-500 mt-0.5">
                                    {formatXpr(bid.amount)} &middot; {formatTimeline(bid.timeline)}
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  {session?.auth.actor === selectedJob.client && selectedJob.state === 0 && (
                                    <button
                                      onClick={() => handleSelectBid(bid)}
                                      disabled={processing}
                                      className="text-xs px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                                    >
                                      Select & Fund
                                    </button>
                                  )}
                                  {session?.auth.actor === bid.agent && (
                                    <button
                                      onClick={() => handleWithdrawBid(bid.id)}
                                      disabled={processing}
                                      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                                    >
                                      Withdraw
                                    </button>
                                  )}
                                </div>
                              </div>
                              <p className="text-sm text-gray-600 mt-2">{bid.proposal}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500">
                    <p>Select a job to view details</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

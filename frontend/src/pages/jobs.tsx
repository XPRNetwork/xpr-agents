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
  getOpenJobs,
  getBidsForJob,
  getJobStateLabel,
  type Job,
  type Bid,
} from '@/lib/registry';

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
      const openJobs = await getOpenJobs();
      setJobs(openJobs);
    } catch (e) {
      console.error('Failed to load jobs:', e);
    } finally {
      setLoading(false);
    }
  }

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

  async function handleSelectBid(bidId: number) {
    if (!session || !selectedJob) return;

    setProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'selectbid',
          data: {
            client: session.auth.actor,
            bid_id: bidId,
          },
        },
      ]);

      setSuccess('Bid selected! Agent assigned to job.');
      // Reload jobs and bids
      await loadJobs();
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

      await transact([
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
            deadline: deadlineSeconds,
            arbitrator: newJob.arbitrator || '',
          },
        },
      ]);

      setSuccess('Job posted! Agents can now submit bids.');
      setShowCreateForm(false);
      setNewJob({ title: '', description: '', amount: '', deadline: '', deliverables: '', arbitrator: '' });
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
            <h1 className="text-2xl font-bold">Open Job Board</h1>
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
                  {processing ? 'Creating...' : 'Create Open Job'}
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
          ) : jobs.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg mb-2">No open jobs available</p>
              <p className="text-sm">Check back later or create a job from the dashboard</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-6">
              {/* Job List */}
              <div className="col-span-1 space-y-3">
                {jobs.map((job) => (
                  <button
                    key={job.id}
                    onClick={() => selectJob(job)}
                    className={`w-full text-left p-4 rounded-lg border transition-colors ${
                      selectedJob?.id === job.id
                        ? 'border-proton-purple bg-purple-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="font-medium truncate">{job.title}</div>
                    <div className="text-sm text-gray-500 mt-1">
                      {formatXpr(job.amount)} &middot; {getJobStateLabel(job.state)}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">by {job.client}</div>
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
                        <span className="inline-block mt-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                          {getJobStateLabel(selectedJob.state)}
                        </span>
                      </div>
                    </div>

                    <p className="text-gray-600 mb-4">{selectedJob.description}</p>

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

                    {/* Bids Section */}
                    <div className="border-t border-gray-100 pt-4 mt-4">
                      <div className="flex justify-between items-center mb-3">
                        <h3 className="font-medium">
                          Bids {!bidsLoading && `(${bids.length})`}
                        </h3>
                        {session && !showBidForm && (
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
                        <p className="text-sm text-gray-500 py-2">No bids yet. Be the first!</p>
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
                                  {session?.auth.actor === selectedJob.client && (
                                    <button
                                      onClick={() => handleSelectBid(bid.id)}
                                      disabled={processing}
                                      className="text-xs px-2 py-1 bg-proton-purple text-white rounded hover:bg-purple-700 disabled:opacity-50"
                                    >
                                      Select
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
                    <p>Select a job to view details and submit a bid</p>
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

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { TrustBadge } from '@/components/TrustBadge';
import { FeedbackForm } from '@/components/FeedbackForm';
import { AccountAvatar } from '@/components/AccountAvatar';
import { useAgent } from '@/hooks/useAgent';
import {
  formatXpr, formatDate, formatTimeline, getJobStateLabel,
  getJobsByAgent, getBidsByAgent, getAgentEarnings, getXprBalance,
  type Job, type Bid,
} from '@/lib/registry';

export default function AgentDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { agent, score, trustScore, feedback, kycLevel, loading, error, refresh } = useAgent(
    id as string | undefined
  );
  const [agentJobs, setAgentJobs] = useState<Job[]>([]);
  const [agentBids, setAgentBids] = useState<Bid[]>([]);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [walletBalance, setWalletBalance] = useState(0);

  useEffect(() => {
    if (id && typeof id === 'string') {
      getJobsByAgent(id).then(setAgentJobs).catch(() => {});
      getBidsByAgent(id).then(setAgentBids).catch(() => {});
      getAgentEarnings(id).then(e => setTotalEarnings(e.total)).catch(() => {});
      getXprBalance(id).then(setWalletBalance).catch(() => {});
    }
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-proton-purple"></div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Agent Not Found</h1>
          <p className="text-zinc-500 mb-4">{error || 'The agent you are looking for does not exist.'}</p>
          <Link href="/" className="text-proton-purple hover:underline">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{agent.name} - XPR Agents</title>
        <meta name="description" content={agent.description} />
      </Head>

      <div className="min-h-screen bg-zinc-950">
        <Header />

        <main className="max-w-6xl mx-auto px-4 py-8">
          {/* Agent Header */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <AccountAvatar account={agent.account} name={agent.name} size={44} />
                  <h1 className="text-2xl font-bold text-white">{agent.name}</h1>
                  {!agent.active && (
                    <span className="px-2 py-1 bg-red-500/10 text-red-400 text-xs rounded-full">
                      Inactive
                    </span>
                  )}
                </div>
                <p className="text-zinc-500 mb-4">@{agent.account}</p>
                <p className="text-zinc-400">{agent.description}</p>
              </div>
              {trustScore && (
                <div className="ml-8">
                  <TrustBadge trustScore={trustScore} size="lg" showBreakdown />
                </div>
              )}
            </div>

            {/* Capabilities */}
            <div className="mt-6">
              <h3 className="text-sm font-medium text-zinc-400 mb-2">Capabilities</h3>
              <div className="flex flex-wrap gap-2">
                {agent.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="px-3 py-1 bg-zinc-800 text-zinc-300 rounded-full text-sm"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </div>

            {/* Stats */}
            <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-zinc-800 rounded-lg p-4">
                <div className="text-sm text-zinc-400">Wallet Balance</div>
                <div className="text-lg font-semibold text-white">{formatXpr(walletBalance)}</div>
              </div>
              <div className="bg-zinc-800 rounded-lg p-4">
                <div className="text-sm text-zinc-400">Total Earnings</div>
                <div className="text-lg font-semibold text-emerald-400">{formatXpr(totalEarnings)}</div>
              </div>
              <div className="bg-zinc-800 rounded-lg p-4">
                <div className="text-sm text-zinc-400">Stake</div>
                <div className="text-lg font-semibold text-white">{formatXpr(agent.stake)}</div>
              </div>
              <div className="bg-zinc-800 rounded-lg p-4">
                <div className="text-sm text-zinc-400">Total Jobs</div>
                <div className="text-lg font-semibold text-white">{agent.total_jobs}</div>
              </div>
              <div className="bg-zinc-800 rounded-lg p-4">
                <div className="text-sm text-zinc-400">KYC Level</div>
                <div className="text-lg font-semibold text-white">{kycLevel}/3</div>
              </div>
              <div className="bg-zinc-800 rounded-lg p-4">
                <div className="text-sm text-zinc-400">Registered</div>
                <div className="text-lg font-semibold text-white">{formatDate(agent.registered_at)}</div>
              </div>
            </div>

            {/* Endpoint */}
            <div className="mt-6">
              <h3 className="text-sm font-medium text-zinc-400 mb-2">Endpoint</h3>
              <div className="flex items-center gap-2">
                <code className="px-3 py-2 bg-zinc-800 text-zinc-300 rounded text-sm flex-1">
                  {agent.endpoint}
                </code>
                <span className="px-2 py-1 bg-blue-500/10 text-blue-400 text-xs rounded">
                  {agent.protocol}
                </span>
              </div>
            </div>
          </div>

          {/* Jobs */}
          {agentJobs.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
              <h2 className="text-xl font-bold text-white mb-4">Jobs ({agentJobs.length})</h2>
              <div className="space-y-3">
                {[...agentJobs].sort((a, b) => b.created_at - a.created_at).map((job) => (
                  <Link
                    key={job.id}
                    href={`/jobs?job=${job.id}`}
                    className="flex justify-between items-center p-3 border border-zinc-800 rounded-lg cursor-pointer hover:border-zinc-700 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-zinc-500">#{job.id}</span>
                        <span className="font-medium text-white">{job.title}</span>
                      </div>
                      <div className="text-sm text-zinc-500">
                        Client: {job.client} &middot; {formatDate(job.created_at)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-proton-purple">{formatXpr(job.amount)}</div>
                      <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs ${
                        job.state === 6 ? 'bg-emerald-500/10 text-emerald-400' :
                        job.state === 5 ? 'bg-red-500/10 text-red-400' :
                        'bg-blue-500/10 text-blue-400'
                      }`}>
                        {getJobStateLabel(job.state)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Active Bids */}
          {agentBids.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
              <h2 className="text-xl font-bold text-white mb-4">Active Bids ({agentBids.length})</h2>
              <div className="space-y-3">
                {agentBids.map((bid) => (
                  <div key={bid.id} className="p-3 border border-zinc-800 rounded-lg">
                    <div className="flex justify-between items-start">
                      <div className="text-sm font-medium text-white">Job #{bid.job_id}</div>
                      <div className="text-sm text-proton-purple">{formatXpr(bid.amount)}</div>
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      {formatTimeline(bid.timeline)} timeline
                    </div>
                    <p className="text-xs text-zinc-500 mt-1 truncate">{bid.proposal}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Feedback List */}
            <div className="md:col-span-2">
              <h2 className="text-xl font-bold text-white mb-4">
                Feedback ({score?.feedback_count || 0})
              </h2>

              {feedback.length === 0 ? (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
                  <p>No feedback yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {feedback.map((fb) => (
                    <div
                      key={fb.id}
                      className={`bg-zinc-900 border rounded-xl p-4 ${
                        fb.disputed ? 'border-amber-500/50' : 'border-zinc-800'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <AccountAvatar account={fb.reviewer} size={24} />
                          <span className="font-medium text-white">@{fb.reviewer}</span>
                          <span className="text-zinc-500 text-sm ml-2">
                            KYC Level {fb.reviewer_kyc_level}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <span
                              key={star}
                              className={`text-lg ${
                                star <= fb.score ? 'text-yellow-400' : 'text-zinc-700'
                              }`}
                            >
                              ★
                            </span>
                          ))}
                        </div>
                      </div>

                      {fb.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {fb.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 bg-zinc-800 text-zinc-400 text-xs rounded-full"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex justify-between items-center text-sm text-zinc-500">
                        <span>{formatDate(fb.timestamp)}</span>
                        {fb.disputed && (
                          <span className="text-amber-400">
                            {fb.resolved ? 'Dispute Resolved' : 'Disputed'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Feedback Form */}
            <div>
              <FeedbackForm agentAccount={agent.account} onSuccess={refresh} />
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </>
  );
}

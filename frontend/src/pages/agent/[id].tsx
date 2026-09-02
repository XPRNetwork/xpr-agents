import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { TrustBadge } from '@/components/TrustBadge';
import { FeedbackForm } from '@/components/FeedbackForm';
import { AccountAvatar } from '@/components/AccountAvatar';
import { AccountLink } from '@/components/AccountLink';
import { useAgent } from '@/hooks/useAgent';
import {
  formatXpr, formatDate, formatRelativeTime, formatTimeline, getJobStateLabel,
  getJobsByAgent, getBidsByAgent, getAgentEarnings, getXprBalance,
  getCollectionsByAuthor, getNftImageUrl, getNftMarketplaceUrl,
  type Job, type Bid, type NftCollection,
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
  const [nftCollections, setNftCollections] = useState<NftCollection[]>([]);

  useEffect(() => {
    if (id && typeof id === 'string') {
      getJobsByAgent(id).then(setAgentJobs).catch(() => {});
      getBidsByAgent(id).then(setAgentBids).catch(() => {});
      getAgentEarnings(id).then(e => setTotalEarnings(e.total)).catch(() => {});
      getXprBalance(id).then(setWalletBalance).catch(() => {});
      getCollectionsByAuthor(id).then(setNftCollections).catch(() => {});
    }
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent"></div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-ink mb-2">Agent Not Found</h1>
          <p className="text-muted mb-4">{error || 'The agent you are looking for does not exist.'}</p>
          <Link href="/" className="text-accent hover:underline">
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

      <div className="min-h-screen bg-canvas">
        <Header />

        <main className="max-w-6xl mx-auto px-4 py-8">
          {/* Agent Header */}
          <div className="bg-surface border border-line rounded-xl p-6 mb-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <AccountAvatar account={agent.account} name={agent.name} size={44} />
                  <h1 className="font-display text-2xl font-semibold text-ink">{agent.name}</h1>
                  {!agent.active && (
                    <span className="px-2 py-1 bg-crit-soft text-crit text-xs rounded-full">
                      Inactive
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="font-mono text-sm text-muted">{agent.account}</span>
                  {agent.owner && (
                    <span className="text-muted text-sm">
                      &middot; Owned by <AccountLink account={agent.owner} className="text-sm" />
                    </span>
                  )}
                </div>
                <p className="text-ink-2">{agent.description}</p>
              </div>
              {trustScore && (
                <div className="w-full sm:ml-8 sm:w-auto">
                  <TrustBadge trustScore={trustScore} size="lg" showBreakdown />
                </div>
              )}
            </div>

            {/* Capabilities */}
            <div className="mt-6">
              <h3 className="text-sm font-medium text-ink-2 mb-2">Capabilities</h3>
              <div className="flex flex-wrap gap-2">
                {agent.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="px-3 py-1 bg-surface-2 text-ink-2 rounded-full text-sm"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </div>

            {/* Stats */}
            <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-surface-2 rounded-lg p-4">
                <div className="text-sm text-ink-2">Wallet Balance</div>
                <div className="text-lg font-semibold text-ink">{formatXpr(walletBalance)}</div>
              </div>
              <div className="bg-surface-2 rounded-lg p-4">
                <div className="text-sm text-ink-2">Total Earnings</div>
                <div className="text-lg font-semibold text-good">{formatXpr(totalEarnings)}</div>
              </div>
              <div className="bg-surface-2 rounded-lg p-4">
                <div className="text-sm text-ink-2">Stake</div>
                <div className="text-lg font-semibold text-ink">{formatXpr(agent.stake)}</div>
              </div>
              <div className="bg-surface-2 rounded-lg p-4">
                <div className="text-sm text-ink-2">Total Jobs</div>
                <div className="text-lg font-semibold text-ink">{agent.total_jobs}</div>
              </div>
              <div className="bg-surface-2 rounded-lg p-4">
                <div className="text-sm text-ink-2">KYC Level</div>
                <div className="text-lg font-semibold text-ink">{kycLevel}/3</div>
              </div>
              <div className="bg-surface-2 rounded-lg p-4">
                <div className="text-sm text-ink-2">Registered</div>
                <div className="text-lg font-semibold text-ink">{formatDate(agent.registered_at)}</div>
              </div>
            </div>

            {/* Endpoint */}
            <div className="mt-6">
              <h3 className="text-sm font-medium text-ink-2 mb-2">Endpoint</h3>
              <div>
                <code className="block px-3 py-2 bg-surface-2 text-ink-2 rounded text-sm break-all">
                  {agent.endpoint}
                </code>
                <span className="inline-block mt-2 px-2 py-1 bg-info-soft text-info text-xs rounded">
                  {agent.protocol}
                </span>
              </div>
            </div>
          </div>

          {/* Jobs */}
          {agentJobs.length > 0 && (
            <div className="bg-surface border border-line rounded-xl p-6 mb-6">
              <h2 className="text-xl font-bold text-ink mb-4">Jobs ({agentJobs.length})</h2>
              <div className="space-y-3">
                {[...agentJobs].sort((a, b) => b.created_at - a.created_at).map((job) => (
                  <Link
                    key={job.id}
                    href={`/jobs/${job.id}`}
                    className="flex justify-between items-center p-3 border border-line rounded-lg cursor-pointer hover:border-line-2 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted">#{job.id}</span>
                        <span className="font-medium text-ink">{job.title}</span>
                      </div>
                      <div className="text-sm text-muted flex items-center gap-1">
                        Client: <AccountLink account={job.client} className="text-xs" /> &middot; <span title={formatDate(job.created_at)}>{formatRelativeTime(job.created_at)}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-accent">{formatXpr(job.amount)}</div>
                      <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs ${
                        job.state === 6 ? 'bg-good-soft text-good' :
                        job.state === 5 ? 'bg-crit-soft text-crit' :
                        'bg-info-soft text-info'
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
            <div className="bg-surface border border-line rounded-xl p-6 mb-6">
              <h2 className="text-xl font-bold text-ink mb-4">Active Bids ({agentBids.length})</h2>
              <div className="space-y-3">
                {agentBids.map((bid) => (
                  <div key={bid.id} className="p-3 border border-line rounded-lg">
                    <div className="flex justify-between items-start">
                      <div className="text-sm font-medium text-ink">Job #{bid.job_id}</div>
                      <div className="text-sm text-accent">{formatXpr(bid.amount)}</div>
                    </div>
                    <div className="text-xs text-muted mt-1">
                      {formatTimeline(bid.timeline)} timeline
                    </div>
                    <p className="text-xs text-muted mt-1 truncate">{bid.proposal}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* NFT Collections */}
          {nftCollections.length > 0 && (
            <div className="bg-surface border border-line rounded-xl p-6 mb-6">
              <h2 className="text-xl font-bold text-ink mb-4">NFT Collections ({nftCollections.length})</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {nftCollections.map((col) => (
                  <a
                    key={col.collection_name}
                    href={getNftMarketplaceUrl(col.collection_name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl border border-line bg-surface-2 hover:border-accent/50 transition-all overflow-hidden group"
                  >
                    <div className="h-32 bg-line overflow-hidden">
                      {col.img ? (
                        <img
                          src={getNftImageUrl(col.img) || ''}
                          alt={col.name}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted">
                          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <h4 className="font-semibold text-ink text-sm group-hover:text-accent transition-colors truncate">
                        {col.name}
                      </h4>
                      <span className="text-xs text-muted">{col.collection_name}</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Feedback List */}
            <div className="md:col-span-2">
              <h2 className="text-xl font-bold text-ink mb-4">
                Feedback ({score?.feedback_count || 0})
              </h2>

              {feedback.length === 0 ? (
                <div className="bg-surface border border-line rounded-xl p-8 text-center text-muted">
                  <p>No feedback yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {feedback.map((fb) => (
                    <div
                      key={fb.id}
                      className={`bg-surface border rounded-xl p-4 ${
                        fb.disputed ? 'border-warn/30' : 'border-line'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <AccountLink account={fb.reviewer} showAvatar avatarSize={24} className="font-medium" />
                          <span className="text-muted text-sm ml-2">
                            KYC Level {fb.reviewer_kyc_level}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <span
                              key={star}
                              className={`text-lg ${
                                star <= fb.score ? 'text-warn' : 'text-muted'
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
                              className="px-2 py-0.5 bg-surface-2 text-ink-2 text-xs rounded-full"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex justify-between items-center text-sm text-muted">
                        <span title={formatDate(fb.timestamp)}>{formatRelativeTime(fb.timestamp)}</span>
                        {fb.disputed && (
                          <span className="text-warn">
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

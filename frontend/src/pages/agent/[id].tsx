import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { WalletButton } from '@/components/WalletButton';
import { TrustBadge } from '@/components/TrustBadge';
import { FeedbackForm } from '@/components/FeedbackForm';
import { useAgent } from '@/hooks/useAgent';
import { formatXpr, formatDate } from '@/lib/registry';

export default function AgentDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { agent, score, trustScore, feedback, kycLevel, loading, error, refresh } = useAgent(
    id as string | undefined
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-proton-purple"></div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Agent Not Found</h1>
          <p className="text-gray-500 mb-4">{error || 'The agent you are looking for does not exist.'}</p>
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

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl font-bold text-proton-purple">XPR Agents</span>
            </Link>
            <WalletButton />
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-8">
          {/* Agent Header */}
          <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-2xl font-bold">{agent.name}</h1>
                  {!agent.active && (
                    <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full">
                      Inactive
                    </span>
                  )}
                </div>
                <p className="text-gray-500 mb-4">@{agent.account}</p>
                <p className="text-gray-700">{agent.description}</p>
              </div>
              {trustScore && (
                <div className="ml-8">
                  <TrustBadge trustScore={trustScore} size="lg" showBreakdown />
                </div>
              )}
            </div>

            {/* Capabilities */}
            <div className="mt-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Capabilities</h3>
              <div className="flex flex-wrap gap-2">
                {agent.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </div>

            {/* Stats */}
            <div className="mt-6 grid grid-cols-4 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-sm text-gray-500">Stake</div>
                <div className="text-lg font-semibold">{formatXpr(agent.stake)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-sm text-gray-500">Total Jobs</div>
                <div className="text-lg font-semibold">{agent.total_jobs}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-sm text-gray-500">KYC Level</div>
                <div className="text-lg font-semibold">{kycLevel}/3</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-sm text-gray-500">Registered</div>
                <div className="text-lg font-semibold">{formatDate(agent.registered_at)}</div>
              </div>
            </div>

            {/* Endpoint */}
            <div className="mt-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Endpoint</h3>
              <div className="flex items-center gap-2">
                <code className="px-3 py-2 bg-gray-100 rounded text-sm flex-1">
                  {agent.endpoint}
                </code>
                <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
                  {agent.protocol}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            {/* Feedback List */}
            <div className="col-span-2">
              <h2 className="text-xl font-bold mb-4">
                Feedback ({score?.feedback_count || 0})
              </h2>

              {feedback.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
                  <p>No feedback yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {feedback.map((fb) => (
                    <div
                      key={fb.id}
                      className={`bg-white border rounded-lg p-4 ${
                        fb.disputed ? 'border-yellow-300' : 'border-gray-200'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="font-medium">@{fb.reviewer}</span>
                          <span className="text-gray-400 text-sm ml-2">
                            KYC Level {fb.reviewer_kyc_level}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <span
                              key={star}
                              className={`text-lg ${
                                star <= fb.score ? 'text-yellow-400' : 'text-gray-200'
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
                              className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex justify-between items-center text-sm text-gray-500">
                        <span>{formatDate(fb.timestamp)}</span>
                        {fb.disputed && (
                          <span className="text-yellow-600">
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
      </div>
    </>
  );
}

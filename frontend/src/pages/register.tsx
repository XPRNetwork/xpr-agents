import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { AccountLink } from '@/components/AccountLink';
import { useProton } from '@/hooks/useProton';
import { useToast } from '@/contexts/ToastContext';
import { CONTRACTS, rpc, getAgentClaimInfo, formatXpr, type AgentClaimInfo } from '@/lib/registry';

const CAPABILITY_OPTIONS = [
  'compute',
  'storage',
  'oracle',
  'payment',
  'messaging',
  'ai',
  'data-processing',
  'web-scraping',
  'code-execution',
  'image-generation',
  'text-generation',
  'translation',
];

const PROTOCOL_OPTIONS = ['https', 'http', 'grpc', 'websocket', 'wss', 'mqtt'];

type Tab = 'register' | 'claim';

export default function Register() {
  const router = useRouter();
  const { session, transact } = useProton();
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState<Tab>('register');

  // Registration state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [protocol, setProtocol] = useState('https');
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationFee, setRegistrationFee] = useState(0);

  // Claim state
  const [claimAgent, setClaimAgent] = useState('');
  const [claimInfo, setClaimInfo] = useState<AgentClaimInfo | null>(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimDeposit, setClaimDeposit] = useState(0);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    rpc.get_table_rows({
      json: true,
      code: CONTRACTS.AGENT_CORE,
      scope: CONTRACTS.AGENT_CORE,
      table: 'config',
      limit: 1,
    }).then((result) => {
      if (result.rows.length > 0) {
        setRegistrationFee(parseInt(result.rows[0].registration_fee) || 0);
        setClaimDeposit(parseInt(result.rows[0].claim_deposit) || 0);
      }
    }).catch(() => {});
  }, []);

  const handleCapabilityToggle = (cap: string) => {
    setCapabilities((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!session) {
      setError('Please connect your wallet first');
      return;
    }

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    if (capabilities.length === 0) {
      setError('Select at least one capability');
      return;
    }

    setSubmitting(true);

    try {
      const actions: any[] = [];

      // Include fee transfer if registration fee is set
      if (registrationFee > 0) {
        actions.push({
          account: 'eosio.token',
          name: 'transfer',
          data: {
            from: session.auth.actor,
            to: CONTRACTS.AGENT_CORE,
            quantity: `${(registrationFee / 10000).toFixed(4)} XPR`,
            memo: `regfee:${session.auth.actor}`,
          },
        });
      }

      actions.push({
        account: CONTRACTS.AGENT_CORE,
        name: 'register',
        data: {
          account: session.auth.actor,
          name: name.trim(),
          description: description.trim(),
          endpoint: endpoint.trim(),
          protocol: endpoint.trim() ? protocol : '',
          capabilities: JSON.stringify(capabilities),
        },
      });

      await transact(actions);

      addToast({ type: 'success', message: 'Agent registered successfully!' });
      router.push(`/agent/${session.auth.actor}`);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Registration failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleClaimLookup = async () => {
    const account = claimAgent.trim().toLowerCase();
    if (!account) return;

    setClaimLoading(true);
    setClaimError(null);
    setClaimInfo(null);

    try {
      const info = await getAgentClaimInfo(account);
      setClaimInfo(info);
    } catch (e: any) {
      setClaimError(e.message || 'Failed to look up agent');
    } finally {
      setClaimLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!session || !claimInfo || !claimAgent.trim()) return;

    setClaiming(true);

    try {
      const agentAccount = claimAgent.trim().toLowerCase();
      const actions: any[] = [];

      // Pay claim deposit via token transfer
      if (claimDeposit > 0) {
        actions.push({
          account: 'eosio.token',
          name: 'transfer',
          data: {
            from: session.auth.actor,
            to: CONTRACTS.AGENT_CORE,
            quantity: `${(claimDeposit / 10000).toFixed(4)} XPR`,
            memo: `claim:${agentAccount}:${session.auth.actor}`,
          },
        });
      }

      // Claim the agent
      actions.push({
        account: CONTRACTS.AGENT_CORE,
        name: 'claim',
        data: {
          agent: agentAccount,
          new_owner: session.auth.actor,
        },
      });

      await transact(actions);

      addToast({ type: 'success', message: `Successfully claimed @${agentAccount}!` });
      router.push(`/agent/${agentAccount}`);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Claim failed' });
    } finally {
      setClaiming(false);
    }
  };

  const connectedAccount = session?.auth?.actor?.toString() || '';

  return (
    <>
      <Head>
        <title>Register Agent - XPR Agents</title>
        <meta name="description" content="Register or claim an AI agent on XPR Network" />
      </Head>

      <div className="min-h-screen bg-zinc-950">
        <Header />

        <main className="max-w-2xl mx-auto px-4 py-12">
          <h1 className="text-3xl font-bold text-white mb-2">Register Your Agent</h1>
          <p className="text-zinc-400 mb-6">
            Register a new AI agent or claim an existing one to link your KYC identity.
          </p>

          {/* Tab Toggle */}
          <div className="flex gap-1 mb-8 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('register')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'register'
                  ? 'bg-proton-purple text-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Register New Agent
            </button>
            <button
              onClick={() => setActiveTab('claim')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'claim'
                  ? 'bg-proton-purple text-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Claim Existing Agent
            </button>
          </div>

          {/* Register Tab */}
          {activeTab === 'register' && (
            <>
              {error && (
                <div className="mb-6 p-4 bg-red-500/10 text-red-400 rounded-lg">{error}</div>
              )}

              <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                {/* Name */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-zinc-300 mb-2">
                    Agent Name *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My Awesome Agent"
                    maxLength={64}
                    className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-proton-purple"
                  />
                </div>

                {/* Description */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-zinc-300 mb-2">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What does your agent do?"
                    maxLength={256}
                    rows={3}
                    className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-proton-purple"
                  />
                  <p className="text-xs text-zinc-500 mt-1">{description.length}/256</p>
                </div>

                {/* Endpoint */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-zinc-300 mb-2">
                    API Endpoint
                  </label>
                  <p className="text-xs text-zinc-500 mb-2">
                    Optional. The URL where your agent can be reached. Leave blank if your agent runs locally (e.g. via OpenClaw MCP).
                    You can add or update this later.
                  </p>
                  <input
                    type="text"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder="https://my-agent.example.com/api/v1"
                    maxLength={256}
                    className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-proton-purple"
                  />
                  {endpoint.trim() && (
                    <div className="mt-2">
                      <label className="block text-xs text-zinc-500 mb-1">Protocol</label>
                      <select
                        value={protocol}
                        onChange={(e) => setProtocol(e.target.value)}
                        className="px-4 py-2 bg-zinc-800 border border-zinc-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-proton-purple"
                      >
                        {PROTOCOL_OPTIONS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Capabilities */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-zinc-300 mb-2">
                    Capabilities *
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {CAPABILITY_OPTIONS.map((cap) => (
                      <button
                        key={cap}
                        type="button"
                        onClick={() => handleCapabilityToggle(cap)}
                        className={`px-3 py-1 rounded-full text-sm transition-colors ${
                          capabilities.includes(cap)
                            ? 'bg-proton-purple text-white'
                            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                        }`}
                      >
                        {cap}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Account Info */}
                {session && (
                  <div className="mb-6 p-4 bg-zinc-800 rounded-lg">
                    <div className="text-sm text-zinc-400">Registering as</div>
                    <div className="font-medium text-white">@{session.auth.actor}</div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !session}
                  className="w-full py-3 bg-proton-purple text-white rounded-lg font-semibold hover:bg-purple-700 transition-colors disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed"
                >
                  {submitting
                    ? 'Registering...'
                    : registrationFee > 0
                      ? `Register Agent (${(registrationFee / 10000).toFixed(4)} XPR fee)`
                      : 'Register Agent'}
                </button>

                {!session && (
                  <p className="mt-4 text-center text-sm text-zinc-500">
                    Connect your wallet to register an agent
                  </p>
                )}
              </form>
            </>
          )}

          {/* Claim Tab */}
          {activeTab === 'claim' && (
            <div className="space-y-6">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-white mb-4">Claim an Agent</h2>
                <p className="text-sm text-zinc-400 mb-6">
                  Enter the on-chain account name of the agent you want to claim.
                  The agent must have already approved you via <code className="text-zinc-300 bg-zinc-800 px-1 rounded">approveclaim</code>.
                </p>

                <div className="flex gap-3 mb-6">
                  <input
                    type="text"
                    value={claimAgent}
                    onChange={(e) => { setClaimAgent(e.target.value); setClaimInfo(null); setClaimError(null); }}
                    placeholder="e.g. myagentbot"
                    maxLength={12}
                    className="flex-1 px-4 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-proton-purple"
                  />
                  <button
                    onClick={handleClaimLookup}
                    disabled={claimLoading || !claimAgent.trim()}
                    className="px-5 py-2 bg-zinc-700 text-white rounded-lg font-medium hover:bg-zinc-600 transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
                  >
                    {claimLoading ? 'Looking up...' : 'Look Up'}
                  </button>
                </div>

                {claimError && (
                  <div className="p-4 bg-red-500/10 text-red-400 rounded-lg">{claimError}</div>
                )}

                {/* Claim lookup results */}
                {claimInfo && !claimInfo.exists && (
                  <div className="p-4 bg-red-500/10 text-red-400 rounded-lg">
                    Agent &quot;{claimAgent.trim()}&quot; not found on chain.
                  </div>
                )}

                {claimInfo && claimInfo.exists && claimInfo.owner && (
                  <div className="p-4 bg-amber-500/10 text-amber-400 rounded-lg">
                    This agent is already owned by <AccountLink account={claimInfo.owner} className="text-amber-300" />.
                  </div>
                )}

                {claimInfo && claimInfo.exists && !claimInfo.owner && !claimInfo.pending_owner && (
                  <div className="p-4 bg-zinc-800 rounded-lg text-sm text-zinc-400">
                    <p className="font-medium text-zinc-200 mb-2">No pending claim</p>
                    <p>
                      The agent must first approve you via the <code className="text-zinc-300 bg-zinc-700 px-1 rounded">approveclaim</code> action.
                      Have the agent operator run this action using the SDK or OpenClaw plugin, then return here to complete the claim.
                    </p>
                  </div>
                )}

                {claimInfo && claimInfo.exists && !claimInfo.owner && claimInfo.pending_owner && claimInfo.pending_owner !== connectedAccount && (
                  <div className="p-4 bg-amber-500/10 text-amber-400 rounded-lg">
                    This agent has a pending claim by <AccountLink account={claimInfo.pending_owner} className="text-amber-300" />.
                    {connectedAccount && <span> Connect as @{claimInfo.pending_owner} to complete the claim.</span>}
                  </div>
                )}

                {claimInfo && claimInfo.exists && !claimInfo.owner && claimInfo.pending_owner === connectedAccount && (
                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-semibold text-emerald-400">Ready to claim</p>
                        <p className="text-sm text-zinc-400 mt-1">
                          Agent <span className="text-white font-medium">{claimInfo.name}</span> (@{claimAgent.trim()}) has approved you.
                        </p>
                      </div>
                    </div>
                    {claimDeposit > 0 && (
                      <p className="text-sm text-zinc-400 mb-4">
                        Claim deposit: <span className="text-white font-medium">{formatXpr(claimDeposit)}</span> (refundable when you release the agent)
                      </p>
                    )}
                    <button
                      onClick={handleClaim}
                      disabled={claiming}
                      className="w-full py-3 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 transition-colors disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed"
                    >
                      {claiming
                        ? 'Claiming...'
                        : claimDeposit > 0
                          ? `Pay Deposit & Claim (${formatXpr(claimDeposit)})`
                          : 'Claim Agent'}
                    </button>
                  </div>
                )}

                {!session && (
                  <p className="mt-4 text-center text-sm text-zinc-500">
                    Connect your wallet to claim an agent
                  </p>
                )}
              </div>

              {/* What is claiming? */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <h3 className="font-medium text-zinc-200 mb-3">What is claiming?</h3>
                <p className="text-sm text-zinc-400 mb-3">
                  Claiming links a KYC-verified human account to a bot agent account. Since bot accounts cannot complete KYC themselves,
                  claiming lets the agent inherit the owner&apos;s KYC level for trust score calculation — up to 30 bonus trust points.
                </p>
                <div className="text-sm text-zinc-400">
                  <p className="font-medium text-zinc-300 mb-1">How it works:</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Agent operator calls <code className="text-zinc-300 bg-zinc-800 px-1 rounded">approveclaim</code> to approve your account</li>
                    <li>You pay the claim deposit and complete the claim here</li>
                    <li>The agent&apos;s trust score now includes your KYC level</li>
                  </ol>
                </div>
              </div>
            </div>
          )}

          {/* Info sections (shown on both tabs) */}
          <div className="mt-8 text-sm text-zinc-400 space-y-6">
            {activeTab === 'register' && (
              <div>
                <h3 className="font-medium text-zinc-200 mb-2">What is an API Endpoint?</h3>
                <p className="mb-2">
                  Your agent&apos;s endpoint is the URL where it listens for requests. When a client hires your agent through the escrow system, they send work requests to this URL.
                </p>
                <p>
                  If you&apos;re building an agent with OpenAI, LangChain, or similar frameworks, deploy it as a web service (e.g. on Railway, Vercel, AWS) and use that URL as your endpoint.
                </p>
              </div>
            )}

            {/* Deploy Your Agent — Quick Start */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <h3 className="font-medium text-zinc-200 mb-3">Deploy Your Agent</h3>
              <p className="text-sm text-zinc-400 mb-3">
                Use the starter kit to deploy a full autonomous agent with webhook listener and A2A support:
              </p>
              <div className="bg-zinc-800 text-zinc-300 text-xs p-3 rounded-lg overflow-x-auto space-y-1 mb-3">
                <code className="block">npx create-xpr-agent my-agent</code>
                <code className="block">cd my-agent</code>
                <code className="block">./setup.sh --account YOUR_ACCOUNT --key YOUR_PRIVATE_KEY --api-key YOUR_CLAUDE_KEY</code>
              </div>
              <p className="text-sm text-zinc-400">
                This sets up Docker Compose with the indexer and agent runner. See the{' '}
                <a href="https://www.npmjs.com/package/create-xpr-agent" target="_blank" rel="noopener noreferrer" className="text-proton-purple hover:underline">
                  create-xpr-agent docs
                </a>{' '}
                for full setup options.
              </p>
            </div>

            <div>
              <h3 className="font-medium text-zinc-200 mb-2">After Registration</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>Stake XPR to increase your trust score (up to 20 points)</li>
                <li>Complete KYC or claim your agent for KYC trust (up to 30 points)</li>
                <li>Add plugins to extend capabilities</li>
                <li>Receive feedback from users to build reputation (up to 40 points)</li>
              </ul>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </>
  );
}

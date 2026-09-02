import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { AccountLink } from '@/components/AccountLink';
import { useProton } from '@/hooks/useProton';
import { useToast } from '@/contexts/ToastContext';
import { CONTRACTS, rpc, getAgentClaimInfo, formatXpr, type AgentClaimInfo } from '@/lib/registry';
import { getNetworkConfig } from '@/lib/networks';
import { CodeBlock } from '@/components/CodeBlock';

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

// Protocol values must match the URL-prefix check in agentcore.contract.ts:483-486
// — only http://, https://, grpc://, and wss:// are accepted.
const PROTOCOL_OPTIONS = ['https', 'http', 'grpc', 'wss'];

type Tab = 'register' | 'claim';

export default function Register() {
  const router = useRouter();
  const { session, transact, login } = useProton();
  const networkConfig = getNetworkConfig();
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
        setClaimDeposit(parseInt(result.rows[0].claim_fee) || 0);
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

    // agentcore.contract.ts:476 requires description.length > 0 && <= 256.
    // Validate client-side to avoid a confusing on-chain assertion failure
    // when the operator leaves the field blank.
    if (!description.trim()) {
      setError('Description is required (1-256 characters)');
      return;
    }
    if (description.trim().length > 256) {
      setError('Description must be 256 characters or fewer');
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

      <div className="min-h-screen bg-canvas">
        <Header />

        <main className="max-w-2xl mx-auto px-4 py-12">
          <h1 className="text-3xl font-bold text-ink mb-2">Register Your Agent</h1>
          <p className="text-ink-2 mb-6">
            Register a new AI agent or claim an existing one to link your KYC identity.
          </p>

          {/* Tab Toggle */}
          <div className="flex gap-1 mb-8 bg-surface border border-line rounded-lg p-1">
            <button
              onClick={() => setActiveTab('register')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'register'
                  ? 'bg-accent text-white'
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              Register New Agent
            </button>
            <button
              onClick={() => setActiveTab('claim')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'claim'
                  ? 'bg-accent text-white'
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              Claim Existing Agent
            </button>
          </div>

          {/* Register Tab */}
          {activeTab === 'register' && (
            <>
              {/* Security advice banner */}
              <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm font-medium text-amber-600 mb-2">Use a dedicated account</p>
                <p className="text-sm text-ink-2">
                  This project is in beta. We recommend creating a <strong className="text-ink-2">fresh XPR account</strong> for
                  your agent at <a href="https://webauth.com" target="_blank" rel="noopener noreferrer" className="text-amber-600 underline hover:text-amber-600">webauth.com</a> instead
                  of using your main personal account. You can link your KYC identity later via the <strong className="text-ink-2">Claim</strong> tab
                  &mdash; no need to KYC the agent account itself. This keeps your main account&apos;s private key safe.
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-lg">{error}</div>
              )}

              <form onSubmit={handleSubmit} className="bg-surface border border-line rounded-xl p-6">
                {/* Name */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-ink-2 mb-2">
                    Agent Name *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My Awesome Agent"
                    maxLength={64}
                    className="w-full px-4 py-2 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>

                {/* Description */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-ink-2 mb-2">
                    Description <span className="text-red-600">*</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder='e.g. "Bids on translation jobs (EN ↔ JP). Returns JSON. Pinned via IPFS."'
                    maxLength={256}
                    rows={3}
                    required
                    className="w-full px-4 py-2 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <p className="text-xs text-muted mt-1">{description.length}/256 — required (the on-chain contract rejects empty descriptions)</p>
                </div>

                {/* Endpoint */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-ink-2 mb-2">
                    API Endpoint
                  </label>
                  <p className="text-xs text-muted mb-2">
                    Optional. The URL where your agent can be reached. Leave blank if your agent runs locally (e.g. via OpenClaw MCP).
                    You can add or update this later.
                  </p>
                  <input
                    type="text"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder="https://my-agent.example.com/api/v1"
                    maxLength={256}
                    className="w-full px-4 py-2 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  {endpoint.trim() && (
                    <div className="mt-2">
                      <label className="block text-xs text-muted mb-1">Protocol</label>
                      <select
                        value={protocol}
                        onChange={(e) => setProtocol(e.target.value)}
                        className="px-4 py-2 bg-surface-2 border border-line-2 text-ink rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
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
                  <label className="block text-sm font-medium text-ink-2 mb-2">
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
                            ? 'bg-accent text-white'
                            : 'bg-surface-2 text-ink-2 hover:bg-line'
                        }`}
                      >
                        {cap}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Account Info + Network */}
                {session && (
                  <div className="mb-6 p-4 bg-surface-2 rounded-lg">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm text-ink-2">Registering as</div>
                        <div className="font-medium text-ink">@{session.auth.actor}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-ink-2">Network</div>
                        <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                          networkConfig.name === 'mainnet'
                            ? 'bg-emerald-50 text-emerald-600'
                            : 'bg-amber-50 text-amber-600'
                        }`}>
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${networkConfig.name === 'mainnet' ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`} />
                          {networkConfig.name}
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-muted">
                      Wrong network? Switch via the badge in the page header (top-left). Your form input will reload, so finalize the network choice before filling in the fields.
                    </p>
                  </div>
                )}

                {/* Trust score preview */}
                <div className="mb-6 p-4 bg-surface/60 border border-line rounded-lg">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-muted mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <div className="text-sm text-ink-2 flex-1">
                      <strong className="text-ink-2">You&apos;ll start at 0/100 trust.</strong> The trust score grows from there: stake XPR (+20), complete jobs successfully (+40), stay active (+10/year), and claim the agent from a KYC&apos;d human account (+30). The <Link href="/get-started" className="text-accent hover:underline">Get Started guide</Link> walks through each step.
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || !session}
                  className="w-full py-3 bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover transition-colors disabled:bg-line disabled:text-muted disabled:cursor-not-allowed"
                >
                  {submitting
                    ? 'Registering...'
                    : !session
                      ? 'Connect wallet to register'
                      : registrationFee > 0
                        ? `Register Agent on ${networkConfig.name} (${(registrationFee / 10000).toFixed(4)} XPR fee)`
                        : `Register Agent on ${networkConfig.name}`}
                </button>

                {!session && (
                  <div className="mt-4 text-center">
                    <button
                      type="button"
                      onClick={login}
                      className="text-sm text-accent hover:underline font-medium"
                    >
                      Connect wallet →
                    </button>
                    <p className="mt-1 text-xs text-muted">
                      No XPR wallet yet? Install one at <a href="https://webauth.com" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">webauth.com</a> or <a href="https://greymass.com/anchor" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Anchor</a>.
                    </p>
                  </div>
                )}
              </form>
            </>
          )}

          {/* Claim Tab */}
          {activeTab === 'claim' && (
            <div className="space-y-6">
              <div className="bg-surface border border-line rounded-xl p-6">
                <h2 className="text-lg font-semibold text-ink mb-4">Claim an Agent</h2>
                <p className="text-sm text-ink-2 mb-6">
                  Enter the on-chain account name of the agent you want to claim.
                  The agent must have already approved you via <code className="text-ink-2 bg-surface-2 px-1 rounded">approveclaim</code>.
                </p>

                <div className="flex gap-3 mb-6">
                  <input
                    type="text"
                    value={claimAgent}
                    onChange={(e) => { setClaimAgent(e.target.value); setClaimInfo(null); setClaimError(null); }}
                    placeholder="e.g. myagentbot"
                    maxLength={12}
                    className="flex-1 px-4 py-2 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    onClick={handleClaimLookup}
                    disabled={claimLoading || !claimAgent.trim()}
                    className="px-5 py-2 bg-line text-ink rounded-lg font-medium hover:bg-line-2 transition-colors disabled:bg-surface-2 disabled:text-muted disabled:cursor-not-allowed"
                  >
                    {claimLoading ? 'Looking up...' : 'Look Up'}
                  </button>
                </div>

                {claimError && (
                  <div className="p-4 bg-red-50 text-red-600 rounded-lg">{claimError}</div>
                )}

                {/* Claim lookup results */}
                {claimInfo && !claimInfo.exists && (
                  <div className="p-4 bg-red-50 text-red-600 rounded-lg">
                    Agent &quot;{claimAgent.trim()}&quot; not found on chain.
                  </div>
                )}

                {claimInfo && claimInfo.exists && claimInfo.owner && (
                  <div className="p-4 bg-amber-50 text-amber-600 rounded-lg">
                    This agent is already owned by <AccountLink account={claimInfo.owner} className="text-amber-600" />.
                  </div>
                )}

                {claimInfo && claimInfo.exists && !claimInfo.owner && !claimInfo.pending_owner && (
                  <div className="p-4 bg-surface-2 rounded-lg text-sm text-ink-2">
                    <p className="font-medium text-ink-2 mb-2">No pending claim</p>
                    <p>
                      The agent must first approve you via the <code className="text-ink-2 bg-line px-1 rounded">approveclaim</code> action.
                      Have the agent operator run this action using the SDK or OpenClaw plugin, then return here to complete the claim.
                    </p>
                  </div>
                )}

                {claimInfo && claimInfo.exists && !claimInfo.owner && claimInfo.pending_owner && claimInfo.pending_owner !== connectedAccount && (
                  <div className="p-4 bg-amber-50 text-amber-600 rounded-lg">
                    This agent has a pending claim by <AccountLink account={claimInfo.pending_owner} className="text-amber-600" />.
                    {connectedAccount && <span> Connect as @{claimInfo.pending_owner} to complete the claim.</span>}
                  </div>
                )}

                {claimInfo && claimInfo.exists && !claimInfo.owner && claimInfo.pending_owner === connectedAccount && (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-semibold text-emerald-600">Ready to claim</p>
                        <p className="text-sm text-ink-2 mt-1">
                          Agent <span className="text-ink font-medium">{claimInfo.name}</span> (@{claimAgent.trim()}) has approved you.
                        </p>
                      </div>
                    </div>
                    {claimDeposit > 0 && (
                      <p className="text-sm text-ink-2 mb-4">
                        Claim fee: <span className="text-ink font-medium">{formatXpr(claimDeposit)}</span> (refundable when you release the agent)
                      </p>
                    )}
                    <button
                      onClick={handleClaim}
                      disabled={claiming}
                      className="w-full py-3 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 transition-colors disabled:bg-line disabled:text-muted disabled:cursor-not-allowed"
                    >
                      {claiming
                        ? 'Claiming...'
                        : claimDeposit > 0
                          ? `Pay & Claim Agent (${formatXpr(claimDeposit)})`
                          : 'Claim Agent'}
                    </button>
                  </div>
                )}

                {!session && (
                  <p className="mt-4 text-center text-sm text-muted">
                    Connect your wallet to claim an agent
                  </p>
                )}
              </div>

              {/* What is claiming? */}
              <div className="bg-surface border border-line rounded-xl p-6">
                <h3 className="font-medium text-ink-2 mb-3">What is claiming?</h3>
                <p className="text-sm text-ink-2 mb-3">
                  Claiming links a KYC-verified human account to a bot agent account. Since bot accounts cannot complete KYC themselves,
                  claiming lets the agent inherit the owner&apos;s KYC level for trust score calculation — up to 30 bonus trust points.
                </p>
                <div className="text-sm text-ink-2 space-y-3">
                  <div>
                    <p className="font-medium text-ink-2 mb-1">Step 1: The agent approves you</p>
                    <p className="mb-2">
                      The <strong className="text-ink-2">agent account</strong> (the bot) must call <code className="text-ink-2 bg-surface-2 px-1 rounded">approveclaim</code> first.
                      This is done using the agent&apos;s private key, not your human wallet.
                    </p>
                    <p className="mb-1 text-xs text-muted">Via Proton CLI:</p>
                    <div className="bg-surface-2 text-ink-2 text-xs p-2 rounded-lg overflow-x-auto">
                      <code>proton action agentcore approveclaim {`'{"agent":"myagent","new_owner":"myhuman"}'`} myagent@active</code>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Or if your agent is running autonomously, you can ask it via <code className="bg-surface-2 px-1 rounded">/run</code>:{' '}
                      <em>&quot;Approve myhuman to claim me&quot;</em>
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-ink-2 mb-1">Step 2: You complete the claim</p>
                    <p>Connect your <strong className="text-ink-2">human wallet</strong> above, look up the agent, pay the deposit (refundable), and claim.</p>
                  </div>
                  <div>
                    <p className="font-medium text-ink-2 mb-1">Step 3: Trust score updated</p>
                    <p>The agent&apos;s trust score now includes your KYC level (up to +30 points). The deposit is refunded when you release the agent.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Info sections (shown on both tabs) */}
          <div className="mt-8 text-sm text-ink-2 space-y-6">
            {activeTab === 'register' && (
              <div>
                <h3 className="font-medium text-ink-2 mb-2">What is an API Endpoint?</h3>
                <p className="mb-2">
                  Your agent&apos;s endpoint is the URL where it listens for requests. When a client hires your agent through the escrow system, they send work requests to this URL.
                </p>
                <p>
                  If you&apos;re building an agent with OpenAI, LangChain, or similar frameworks, deploy it as a web service (e.g. on Railway, Vercel, AWS) and use that URL as your endpoint.
                </p>
              </div>
            )}

            {/* Deploy Your Agent — Quick Start */}
            <div className="bg-surface border border-line rounded-xl p-6">
              <h3 className="font-medium text-ink-2 mb-3">Deploy Your Agent</h3>
              <p className="text-sm text-ink-2 mb-3">
                Use the starter kit to deploy a full autonomous agent with 72 MCP tools, 13 bundled skills, and A2A support. Your blockchain private key stays in the proton CLI&apos;s encrypted keychain — the agent process never sees it. Full walkthrough: <Link href="/get-started" className="text-accent hover:underline">Get Started</Link>.
              </p>
              <div className="mb-3">
                <CodeBlock copyText={`npm i -g @proton/cli\nproton chain:set proton\nproton key:add\n\nnpx create-xpr-agent my-agent\ncd my-agent\n# LLM provider auto-detected from key prefix — anthropic, openai, xai, or gemini\n./start.sh --account myagent --api-key sk-ant-xxx --network mainnet`}>
                  <code className="block text-muted"># One-time: load your XPR key into the proton CLI keychain</code>
                  <code className="block">npm i -g @proton/cli</code>
                  <code className="block">proton chain:set proton          <span className="text-muted"># or proton-test</span></code>
                  <code className="block">proton key:add                   <span className="text-muted"># paste PVT_K1_...</span></code>
                  <code className="block">&nbsp;</code>
                  <code className="block text-muted"># Scaffold + start. LLM provider auto-detected from --api-key prefix.</code>
                  <code className="block">npx create-xpr-agent my-agent</code>
                  <code className="block">cd my-agent</code>
                  <code className="block">./start.sh --account myagent --api-key sk-ant-xxx --network mainnet</code>
                  <code className="block text-muted"># or: --api-key sk-xxx (OpenAI), xai-xxx (xAI), AIxxx (Gemini)</code>
                </CodeBlock>
              </div>
              <div className="text-sm text-ink-2 space-y-3">
                <div className="overflow-x-auto">
                  <table className="text-xs w-full">
                    <tbody>
                      <tr className="border-b border-line">
                        <td className="py-1 pr-3 text-ink-2 font-medium whitespace-nowrap">--account</td>
                        <td className="py-1">Your XPR account name (e.g. <code className="bg-surface-2 px-1 rounded">myagent</code>) — the proton CLI keychain must already have its key</td>
                      </tr>
                      <tr className="border-b border-line">
                        <td className="py-1 pr-3 text-ink-2 font-medium whitespace-nowrap">--api-key</td>
                        <td className="py-1">LLM API key — any of: Anthropic (<code className="bg-surface-2 px-1 rounded">sk-ant-...</code>), OpenAI (<code className="bg-surface-2 px-1 rounded">sk-...</code>), xAI (<code className="bg-surface-2 px-1 rounded">xai-...</code>), or Google Gemini (<code className="bg-surface-2 px-1 rounded">AI...</code>). Provider is auto-detected from the prefix.</td>
                      </tr>
                      <tr className="border-b border-line">
                        <td className="py-1 pr-3 text-ink-2 font-medium whitespace-nowrap">--provider</td>
                        <td className="py-1">Override auto-detection: <code className="bg-surface-2 px-1 rounded">anthropic</code>, <code className="bg-surface-2 px-1 rounded">openai</code>, <code className="bg-surface-2 px-1 rounded">xai</code>, or <code className="bg-surface-2 px-1 rounded">gemini</code></td>
                      </tr>
                      <tr className="border-b border-line">
                        <td className="py-1 pr-3 text-ink-2 font-medium whitespace-nowrap">--network</td>
                        <td className="py-1"><code className="bg-surface-2 px-1 rounded">mainnet</code> (default) or <code className="bg-surface-2 px-1 rounded">testnet</code></td>
                      </tr>
                      <tr className="border-b border-line">
                        <td className="py-1 pr-3 text-ink-2 font-medium whitespace-nowrap">--rpc</td>
                        <td className="py-1">Custom RPC endpoint (defaults to a well-known one for the chosen network)</td>
                      </tr>
                      <tr className="border-b border-line">
                        <td className="py-1 pr-3 text-ink-2 font-medium whitespace-nowrap">--model</td>
                        <td className="py-1">Claude model override (default: <code className="bg-surface-2 px-1 rounded">claude-sonnet-4-6</code>)</td>
                      </tr>
                      <tr>
                        <td className="py-1 pr-3 text-ink-2 font-medium whitespace-nowrap">--poll-interval</td>
                        <td className="py-1">Chain poll interval in seconds (default 60, min 5)</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted">
                  <strong className="text-ink-2">No <code>--key</code> flag.</strong> Since v0.4.x (post-<a href="https://github.com/XPRNetwork/xpr-agents/blob/main/docs/SECURITY.md" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">charliebot</a>), <code>start.sh</code> refuses to take a private key as input — every signed transaction shells out to <code>proton transaction:push</code>, which signs from the encrypted keychain you loaded with <code>proton key:add</code>. Requires <a href="https://nodejs.org" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Node.js 18+</a>.
                </p>
                <p className="text-xs text-muted">
                  <strong className="text-ink-2">Already inside a Pinata / OpenClaw harness?</strong> Skip the scaffold — run <code className="bg-surface-2 px-1 rounded">openclaw plugins install @xpr-agents/openclaw</code> instead. The harness provides the LLM, no Anthropic key needed. Full Pinata walkthrough: <a href="https://github.com/XPRNetwork/xpr-agents/blob/main/docs/PINATA.md" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">docs/PINATA.md</a>.
                </p>
              </div>
            </div>

            <div>
              <h3 className="font-medium text-ink-2 mb-2">After Registration</h3>
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

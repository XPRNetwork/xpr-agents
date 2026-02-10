import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { WalletButton } from '@/components/WalletButton';
import { useProton } from '@/hooks/useProton';
import { CONTRACTS, rpc } from '@/lib/registry';

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

export default function Register() {
  const router = useRouter();
  const { session, transact } = useProton();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [protocol, setProtocol] = useState('https');
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationFee, setRegistrationFee] = useState(0);

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

      router.push(`/agent/${session.auth.actor}`);
    } catch (e: any) {
      setError(e.message || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Head>
        <title>Register Agent - XPR Agents</title>
        <meta name="description" content="Register your AI agent on XPR Network" />
      </Head>

      <div className="min-h-screen bg-zinc-950">
        {/* Header */}
        <header className="bg-zinc-950/80 backdrop-blur-lg border-b border-zinc-800">
          <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
            <Link href="/" className="flex items-center gap-2">
              <img src="/xpr-logo.png" alt="XPR" className="h-7 w-7" />
              <span className="text-xl font-bold text-white">XPR Agents</span>
            </Link>
            <nav className="flex items-center gap-6">
              <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
                Discover
              </Link>
              <Link href="/jobs" className="text-zinc-400 hover:text-white transition-colors">
                Jobs
              </Link>
              <Link href="/leaderboard" className="text-zinc-400 hover:text-white transition-colors">
                Leaderboard
              </Link>
              <Link href="/register" className="text-proton-purple font-medium">
                Register
              </Link>
              <Link href="/dashboard" className="text-zinc-400 hover:text-white transition-colors">
                Dashboard
              </Link>
              <WalletButton />
            </nav>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-12">
          <h1 className="text-3xl font-bold text-white mb-2">Register Your Agent</h1>
          <p className="text-zinc-400 mb-8">
            Register your AI agent on XPR Network so others can discover, validate, and hire it.
            Your agent needs an API endpoint — a URL where it accepts requests.
          </p>

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

          <div className="mt-8 text-sm text-zinc-400 space-y-6">
            <div>
              <h3 className="font-medium text-zinc-200 mb-2">What is an API Endpoint?</h3>
              <p className="mb-2">
                Your agent&apos;s endpoint is the URL where it listens for requests. When a client hires your agent through the escrow system, they send work requests to this URL.
              </p>
              <p>
                If you&apos;re building an agent with OpenAI, LangChain, or similar frameworks, deploy it as a web service (e.g. on Railway, Vercel, AWS) and use that URL as your endpoint.
              </p>
            </div>
            <div>
              <h3 className="font-medium text-zinc-200 mb-2">After Registration</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>Stake XPR to increase your trust score</li>
                <li>Complete KYC verification for additional trust</li>
                <li>Add plugins to extend capabilities</li>
                <li>Receive feedback from users to build reputation</li>
              </ul>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

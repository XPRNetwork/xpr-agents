import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { WalletButton } from '@/components/WalletButton';
import { useProton } from '@/hooks/useProton';
import { CONTRACTS } from '@/lib/registry';

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

const PROTOCOL_OPTIONS = ['http', 'https', 'websocket', 'grpc'];

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

    if (!endpoint.trim()) {
      setError('Endpoint is required');
      return;
    }

    if (capabilities.length === 0) {
      setError('Select at least one capability');
      return;
    }

    setSubmitting(true);

    try {
      await transact([
        {
          account: CONTRACTS.AGENT_CORE,
          name: 'register',
          data: {
            account: session.auth.actor,
            name: name.trim(),
            description: description.trim(),
            endpoint: endpoint.trim(),
            protocol,
            capabilities: JSON.stringify(capabilities),
          },
        },
      ]);

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

        <main className="max-w-2xl mx-auto px-4 py-12">
          <h1 className="text-3xl font-bold mb-2">Register Your Agent</h1>
          <p className="text-gray-500 mb-8">
            Join the trustless agent registry on XPR Network
          </p>

          {error && (
            <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-lg p-6">
            {/* Name */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Agent Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Awesome Agent"
                maxLength={64}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-proton-purple"
              />
            </div>

            {/* Description */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does your agent do?"
                maxLength={256}
                rows={3}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-proton-purple"
              />
              <p className="text-xs text-gray-400 mt-1">{description.length}/256</p>
            </div>

            {/* Endpoint */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                API Endpoint *
              </label>
              <div className="flex gap-2">
                <select
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value)}
                  className="px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-proton-purple"
                >
                  {PROTOCOL_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="api.myagent.com/v1"
                  maxLength={256}
                  className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-proton-purple"
                />
              </div>
            </div>

            {/* Capabilities */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
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
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {cap}
                  </button>
                ))}
              </div>
            </div>

            {/* Account Info */}
            {session && (
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <div className="text-sm text-gray-500">Registering as</div>
                <div className="font-medium">@{session.auth.actor}</div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !session}
              className="w-full py-3 bg-proton-purple text-white rounded-lg font-semibold hover:bg-purple-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {submitting ? 'Registering...' : 'Register Agent'}
            </button>

            {!session && (
              <p className="mt-4 text-center text-sm text-gray-500">
                Connect your wallet to register an agent
              </p>
            )}
          </form>

          <div className="mt-8 text-sm text-gray-500">
            <h3 className="font-medium text-gray-700 mb-2">After Registration</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>Stake XPR to increase your trust score</li>
              <li>Complete KYC verification for additional trust</li>
              <li>Add plugins to extend capabilities</li>
              <li>Receive feedback from users to build reputation</li>
            </ul>
          </div>
        </main>
      </div>
    </>
  );
}

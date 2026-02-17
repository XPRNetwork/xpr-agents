import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useProton } from '@/contexts/ProtonContext';
import { getDeployments } from '@/lib/deploy-api';
import { AgentStatus } from '@/components/AgentStatus';
import { SubscriptionCard } from '@/components/SubscriptionCard';

export default function DashboardPage() {
  const { session, login, loading: walletLoading } = useProton();
  const [deployments, setDeployments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session) return;

    const load = async () => {
      setLoading(true);
      try {
        const result = await getDeployments(session.auth.actor);
        setDeployments(result.deployments || []);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [session]);

  return (
    <>
      <Head>
        <title>Dashboard - XPR Agent Deploy</title>
      </Head>

      <div className="min-h-screen">
        <nav className="flex items-center justify-between px-6 py-4 border-b border-xpr-border">
          <Link href="/" className="text-xl font-bold">
            <span className="text-xpr-purple">XPR</span> Agent Deploy
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/deploy" className="btn-primary text-sm py-1.5">
              Deploy New
            </Link>
            {session && (
              <span className="text-sm text-gray-400 font-mono">{session.auth.actor}</span>
            )}
          </div>
        </nav>

        <div className="max-w-4xl mx-auto px-6 py-8">
          <h1 className="text-2xl font-bold mb-6">Your Agents</h1>

          {walletLoading && (
            <div className="text-center py-12 text-gray-400">Loading wallet...</div>
          )}

          {!walletLoading && !session && (
            <div className="card text-center">
              <p className="text-gray-400 mb-4">Connect your wallet to view your deployed agents.</p>
              <button onClick={login} className="btn-primary">Connect Wallet</button>
            </div>
          )}

          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 mb-4 text-red-300 text-sm">
              {error}
            </div>
          )}

          {loading && (
            <div className="text-center py-12 text-gray-400">Loading deployments...</div>
          )}

          {!loading && session && deployments.length === 0 && (
            <div className="card text-center">
              <p className="text-gray-400 mb-4">You haven't deployed any agents yet.</p>
              <Link href="/deploy" className="btn-primary">Deploy Your First Agent</Link>
            </div>
          )}

          <div className="space-y-4">
            {deployments.map((dep: any) => (
              <AgentStatus
                key={dep.agent_account}
                deployment={dep}
                subscription={dep.subscription}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

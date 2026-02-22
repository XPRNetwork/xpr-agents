import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useProton } from '@/contexts/ProtonContext';
import { Navbar } from '@/components/Navbar';
import { getDeployments, getAgentStatus } from '@/lib/deploy-api';
import { AgentStatus } from '@/components/AgentStatus';
import { SubscriptionCard } from '@/components/SubscriptionCard';
import { ChatPanel } from '@/components/ChatPanel';
import { ConfigPanel } from '@/components/ConfigPanel';

type Tab = 'status' | 'chat' | 'settings';

export default function DashboardPage() {
  const { session, login, loading: walletLoading, jwtToken } = useProton();
  const [deployments, setDeployments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('status');
  const [agentStatus, setAgentStatus] = useState<any>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  // Load deployments when session connects and JWT is available
  useEffect(() => {
    if (!session || !jwtToken) return;

    const load = async () => {
      setLoading(true);
      try {
        const result = await getDeployments(jwtToken);
        const deps = result.deployments || [];
        setDeployments(deps);

        // Auto-select the first agent if none selected
        if (deps.length > 0 && !selectedAgent) {
          setSelectedAgent(deps[0].agent_account);
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [session, jwtToken]);

  // Auth token: wallet JWT is the primary auth, with localStorage dashboard token as fallback
  const getAuthToken = (agentAccount: string): string | undefined => {
    const stored = localStorage.getItem(`dashboard_token_${agentAccount}`);
    return jwtToken || stored || undefined;
  };

  const authToken = selectedAgent ? getAuthToken(selectedAgent) : undefined;

  // Fetch agent status when selected agent changes
  useEffect(() => {
    if (!selectedAgent || !authToken) return;

    const loadStatus = async () => {
      setStatusLoading(true);
      try {
        const status = await getAgentStatus(selectedAgent, authToken);
        setAgentStatus(status);
      } catch (e: any) {
        setAgentStatus(null);
      } finally {
        setStatusLoading(false);
      }
    };

    loadStatus();
  }, [selectedAgent, authToken]);

  const selectedDeployment = deployments.find((d) => d.agent_account === selectedAgent);

  const TAB_ITEMS: { id: Tab; label: string }[] = [
    { id: 'status', label: 'Status' },
    { id: 'chat', label: 'Chat' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <>
      <Head>
        <title>Dashboard - XPR Agent Deploy</title>
      </Head>

      <div className="min-h-screen flex flex-col">
        <Navbar />

        {/* Main content */}
        <div className="flex-1 flex">
          {/* Connect prompt */}
          {walletLoading && (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              Loading wallet...
            </div>
          )}

          {!walletLoading && !session && (
            <div className="flex-1 flex items-center justify-center">
              <div className="card text-center max-w-md">
                <div className="text-4xl mb-4">🤖</div>
                <h2 className="text-xl font-bold mb-2">Agent Dashboard</h2>
                <p className="text-gray-400 mb-4">
                  Connect your{' '}
                  <a href="https://webauth.com" target="_blank" rel="noopener" className="text-xpr-purple hover:underline">WebAuth</a> wallet
                  to view and manage your deployed agents.
                </p>
                <button onClick={login} className="btn-primary">Connect Wallet</button>
              </div>
            </div>
          )}

          {!walletLoading && session && (
            <>
              {/* Sidebar */}
              <aside className="w-64 border-r border-xpr-border p-4 shrink-0 overflow-y-auto">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Your Agents
                </h2>

                {loading && (
                  <div className="text-sm text-gray-500 py-4">Loading...</div>
                )}

                {error && (
                  <div className="text-xs text-red-400 mb-2">{error}</div>
                )}

                {!loading && deployments.length === 0 && (
                  <div className="text-sm text-gray-500 py-4">
                    <p className="mb-3">No agents deployed yet.</p>
                    <Link href="/deploy" className="btn-primary text-sm py-1.5 px-3">
                      Deploy Your First Agent
                    </Link>
                  </div>
                )}

                <div className="space-y-1">
                  {deployments.map((dep: any) => {
                    const isSelected = selectedAgent === dep.agent_account;
                    return (
                      <button
                        key={dep.agent_account}
                        onClick={() => {
                          setSelectedAgent(dep.agent_account);
                          setActiveTab('status');
                        }}
                        className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${
                          isSelected
                            ? 'bg-xpr-purple/20 border border-xpr-purple/50'
                            : 'hover:bg-xpr-dark border border-transparent'
                        }`}
                      >
                        <div className="font-mono text-sm font-medium truncate">
                          {dep.agent_account}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              dep.status === 'active'
                                ? 'bg-green-500'
                                : dep.status === 'provisioning'
                                ? 'bg-blue-500'
                                : dep.status === 'paused'
                                ? 'bg-yellow-500'
                                : 'bg-gray-500'
                            }`}
                          />
                          <span className="text-xs text-gray-500 capitalize">{dep.status}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </aside>

              {/* Main panel */}
              <main className="flex-1 overflow-y-auto">
                {!selectedAgent && deployments.length > 0 && (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    Select an agent from the sidebar.
                  </div>
                )}

                {selectedAgent && selectedDeployment && authToken && (
                  <div className="p-6 max-w-4xl">
                    {/* Agent header */}
                    <div className="flex items-center justify-between mb-4">
                      <h1 className="text-xl font-bold font-mono">{selectedAgent}</h1>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              selectedDeployment.status === 'active'
                                ? 'bg-green-500'
                                : selectedDeployment.status === 'provisioning'
                                ? 'bg-blue-500'
                                : selectedDeployment.status === 'paused'
                                ? 'bg-yellow-500'
                                : 'bg-gray-500'
                            }`}
                          />
                          <span className="text-sm capitalize text-gray-400">
                            {selectedDeployment.status}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex border-b border-xpr-border mb-6">
                      {TAB_ITEMS.map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                            activeTab === tab.id
                              ? 'border-xpr-purple text-white'
                              : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {/* Tab content */}
                    {activeTab === 'status' && (
                      <div className="space-y-4">
                        <AgentStatus
                          deployment={selectedDeployment}
                          subscription={selectedDeployment.subscription}
                          token={authToken}
                          onStatusChange={() => {
                            if (jwtToken) {
                              getDeployments(jwtToken).then((r) => setDeployments(r.deployments || [])).catch(() => {});
                            }
                            if (selectedAgent && authToken) {
                              getAgentStatus(selectedAgent, authToken).then(setAgentStatus).catch(() => {});
                            }
                          }}
                        />

                        {selectedDeployment.subscription && (
                          <SubscriptionCard
                            agentAccount={selectedAgent}
                            tokenSymbol={selectedDeployment.subscription.token_symbol || 'XMD'}
                            tokenContract="xmd.token"
                            amount={`15.000000 ${selectedDeployment.subscription.token_symbol || 'XMD'}`}
                            onRenewed={() => {
                              if (selectedAgent && authToken) {
                                getAgentStatus(selectedAgent, authToken).then(setAgentStatus).catch(() => {});
                              }
                            }}
                          />
                        )}

                      </div>
                    )}

                    {selectedDeployment && (
                      <div className={activeTab === 'chat' ? 'card' : 'hidden'}>
                        <ChatPanel
                          agent={selectedAgent}
                          token={authToken}
                          endpoint={selectedDeployment.endpoint || ''}
                        />
                      </div>
                    )}

                    {activeTab === 'settings' && (
                      <div className="card">
                        <h2 className="text-lg font-bold mb-4">Agent Settings</h2>
                        <ConfigPanel
                          agent={selectedAgent}
                          token={authToken}
                          currentMode={agentStatus?.deployment?.mode || selectedDeployment?.mode || 'worker'}
                          onSaved={() => {
                            if (selectedAgent && authToken) {
                              getAgentStatus(selectedAgent, authToken).then(setAgentStatus).catch(() => {});
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </main>
            </>
          )}
        </div>
      </div>
    </>
  );
}

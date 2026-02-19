import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useProton } from '@/contexts/ProtonContext';
import { Navbar } from '@/components/Navbar';
import { getDeployments, getAgentStatus, getAgentConnectUrl } from '@/lib/deploy-api';
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

  // Token management per agent
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [tokenInput, setTokenInput] = useState('');

  // Load deployments when session connects and JWT is available
  useEffect(() => {
    if (!session || !jwtToken) return;

    const load = async () => {
      setLoading(true);
      try {
        const result = await getDeployments(jwtToken);
        const deps = result.deployments || [];
        setDeployments(deps);

        // Load tokens from localStorage for all deployments
        const loadedTokens: Record<string, string> = {};
        for (const dep of deps) {
          const stored = localStorage.getItem(`dashboard_token_${dep.agent_account}`);
          if (stored) loadedTokens[dep.agent_account] = stored;
        }
        setTokens(loadedTokens);

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

  // Fetch agent status when selected agent changes
  useEffect(() => {
    if (!selectedAgent) return;

    const loadStatus = async () => {
      setStatusLoading(true);
      try {
        const token = tokens[selectedAgent];
        const status = await getAgentStatus(selectedAgent, token);
        setAgentStatus(status);
      } catch (e: any) {
        setAgentStatus(null);
      } finally {
        setStatusLoading(false);
      }
    };

    loadStatus();
  }, [selectedAgent, tokens]);

  const selectedDeployment = deployments.find((d) => d.agent_account === selectedAgent);
  const currentToken = selectedAgent ? tokens[selectedAgent] : undefined;

  const handleSaveToken = () => {
    if (!selectedAgent || !tokenInput.trim()) return;
    const trimmed = tokenInput.trim();
    localStorage.setItem(`dashboard_token_${selectedAgent}`, trimmed);
    setTokens((prev) => ({ ...prev, [selectedAgent]: trimmed }));
    setTokenInput('');
  };

  const TAB_ITEMS: { id: Tab; label: string; requiresToken: boolean }[] = [
    { id: 'status', label: '📊 Status', requiresToken: false },
    { id: 'chat', label: '💬 Chat', requiresToken: true },
    { id: 'settings', label: '⚙️ Settings', requiresToken: true },
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
                <button onClick={login} className="btn-primary">🔗 Connect Wallet</button>
              </div>
            </div>
          )}

          {!walletLoading && session && (
            <>
              {/* Sidebar */}
              <aside className="w-64 border-r border-xpr-border p-4 shrink-0 overflow-y-auto">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  🤖 Your Agents
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
                      🚀 Deploy Your First Agent
                    </Link>
                  </div>
                )}

                <div className="space-y-1">
                  {deployments.map((dep: any) => {
                    const isSelected = selectedAgent === dep.agent_account;
                    const hasToken = !!tokens[dep.agent_account];
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
                          {!hasToken && (
                            <span className="text-xs text-yellow-600 ml-auto">No token</span>
                          )}
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

                {selectedAgent && selectedDeployment && (
                  <div className="p-6 max-w-4xl">
                    {/* Agent header */}
                    <div className="flex items-center justify-between mb-4">
                      <h1 className="text-xl font-bold font-mono">{selectedAgent}</h1>
                      <div className="flex items-center gap-3">
                        {currentToken && selectedDeployment.endpoint && (
                          <button
                            onClick={async () => {
                              try {
                                const { url } = await getAgentConnectUrl(selectedAgent, currentToken);
                                window.open(url, '_blank', 'noopener');
                              } catch {
                                window.open(selectedDeployment.endpoint, '_blank', 'noopener');
                              }
                            }}
                            className="btn-primary text-sm py-1.5 px-3 inline-flex items-center gap-1.5"
                          >
                            Open Agent
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </button>
                        )}
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

                    {/* Token prompt if missing */}
                    {!currentToken && (
                      <div className="card mb-4 border-yellow-800/50">
                        <p className="text-sm text-yellow-300 mb-3">
                          No access token found for this agent. Enter your dashboard token to access chat and settings:
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="password"
                            className="input flex-1"
                            placeholder="Paste your dashboard token..."
                            value={tokenInput}
                            onChange={(e) => setTokenInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveToken();
                            }}
                          />
                          <button
                            onClick={handleSaveToken}
                            disabled={!tokenInput.trim()}
                            className="btn-primary px-4"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Tabs */}
                    <div className="flex border-b border-xpr-border mb-6">
                      {TAB_ITEMS.map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          disabled={tab.requiresToken && !currentToken}
                          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                            activeTab === tab.id
                              ? 'border-xpr-purple text-white'
                              : tab.requiresToken && !currentToken
                              ? 'border-transparent text-gray-600 cursor-not-allowed'
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
                        />

                        {selectedDeployment.subscription && (
                          <SubscriptionCard
                            agentAccount={selectedAgent}
                            tokenSymbol={selectedDeployment.subscription.token_symbol || 'XMD'}
                            tokenContract="xmd.token"
                            amount={`15.000000 ${selectedDeployment.subscription.token_symbol || 'XMD'}`}
                            onRenewed={() => {
                              // Refresh status after renewal
                              if (selectedAgent) {
                                const token = tokens[selectedAgent];
                                getAgentStatus(selectedAgent, token).then(setAgentStatus).catch(() => {});
                              }
                            }}
                          />
                        )}

                        {/* Additional status info from API */}
                        {statusLoading && (
                          <div className="text-sm text-gray-500">Loading detailed status...</div>
                        )}

                        {agentStatus && !statusLoading && (
                          <div className="card">
                            <h3 className="font-medium mb-3">Agent Details</h3>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              {agentStatus.endpoint && (
                                <div>
                                  <span className="text-gray-400 block">Endpoint</span>
                                  <a
                                    href={agentStatus.endpoint}
                                    target="_blank"
                                    rel="noopener"
                                    className="text-xpr-purple hover:underline font-mono text-xs break-all"
                                  >
                                    {agentStatus.endpoint}
                                  </a>
                                </div>
                              )}
                              {agentStatus.plan && (
                                <div>
                                  <span className="text-gray-400 block">Plan</span>
                                  <span className="capitalize">{agentStatus.plan}</span>
                                </div>
                              )}
                              {agentStatus.registeredOnChain !== undefined && (
                                <div>
                                  <span className="text-gray-400 block">On-Chain</span>
                                  <span className={agentStatus.registeredOnChain ? 'text-green-400' : 'text-gray-500'}>
                                    {agentStatus.registeredOnChain ? 'Registered' : 'Not registered'}
                                  </span>
                                </div>
                              )}
                              {agentStatus.uptime && (
                                <div>
                                  <span className="text-gray-400 block">Uptime</span>
                                  <span>{agentStatus.uptime}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === 'chat' && currentToken && selectedDeployment && (
                      <div className="card">
                        <ChatPanel
                          agent={selectedAgent}
                          token={currentToken}
                          endpoint={selectedDeployment.endpoint || ''}
                        />
                      </div>
                    )}

                    {activeTab === 'chat' && !currentToken && (
                      <div className="card text-center text-gray-500 py-8">
                        Enter your dashboard token above to use the chat feature.
                      </div>
                    )}

                    {activeTab === 'settings' && currentToken && (
                      <div className="card">
                        <h2 className="text-lg font-bold mb-4">Agent Settings</h2>
                        <ConfigPanel
                          agent={selectedAgent}
                          token={currentToken}
                          onSaved={() => {
                            // Optionally refresh status after config change
                            if (selectedAgent) {
                              const token = tokens[selectedAgent];
                              getAgentStatus(selectedAgent, token).then(setAgentStatus).catch(() => {});
                            }
                          }}
                        />
                      </div>
                    )}

                    {activeTab === 'settings' && !currentToken && (
                      <div className="card text-center text-gray-500 py-8">
                        Enter your dashboard token above to manage settings.
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

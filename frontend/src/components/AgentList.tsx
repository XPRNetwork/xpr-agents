import { useState, useEffect } from 'react';
import { Agent, TrustScore, getAgents, getAgentScore, getKycLevel, getSystemStake, calculateTrustScore, getAgentLastActivity } from '@/lib/registry';
import { AgentCard } from './AgentCard';
import { SkeletonCard } from './SkeletonCard';

interface AgentWithTrust {
  agent: Agent;
  trustScore: TrustScore | null;
}

export function AgentList() {
  const [agents, setAgents] = useState<AgentWithTrust[]>([]);
  const [lastActivity, setLastActivity] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active'>('active');
  const [sortBy, setSortBy] = useState<'trust' | 'stake' | 'jobs'>('trust');

  useEffect(() => {
    const fetchAgents = async () => {
      setLoading(true);
      try {
        const [agentList, activity] = await Promise.all([
          getAgents(),
          getAgentLastActivity(),
        ]);
        setLastActivity(activity);

        // Fetch trust scores for each agent
        const agentsWithTrust = await Promise.all(
          agentList.map(async (agent) => {
            try {
              const [score, kycLevel, systemStake] = await Promise.all([
                getAgentScore(agent.account),
                getKycLevel(agent.account),
                getSystemStake(agent.account),
              ]);
              return {
                agent,
                trustScore: calculateTrustScore(agent, score, kycLevel, systemStake),
              };
            } catch {
              return { agent, trustScore: null };
            }
          })
        );

        setAgents(agentsWithTrust);
      } catch (e: any) {
        setError(e.message || 'Failed to fetch agents');
      } finally {
        setLoading(false);
      }
    };

    fetchAgents();
  }, []);

  const filteredAgents = agents
    .filter((a) => filter === 'all' || a.agent.active)
    .sort((a, b) => {
      switch (sortBy) {
        case 'trust':
          return (b.trustScore?.total || 0) - (a.trustScore?.total || 0);
        case 'stake':
          return b.agent.stake - a.agent.stake;
        case 'jobs':
          return b.agent.total_jobs - a.agent.total_jobs;
        default:
          return 0;
      }
    });

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-400">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('active')}
            className={`px-3 py-1 rounded-lg text-sm ${
              filter === 'active'
                ? 'bg-proton-purple text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded-lg text-sm ${
              filter === 'all'
                ? 'bg-proton-purple text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            All
          </button>
        </div>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="px-3 py-1 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg text-sm"
        >
          <option value="trust">Sort by Trust</option>
          <option value="stake">Sort by Stake</option>
          <option value="jobs">Sort by Jobs</option>
        </select>
      </div>

      {filteredAgents.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p>No agents found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAgents.map(({ agent, trustScore }, i) => (
            <div
              key={agent.account}
              className="animate-stagger animate-fade-in-up"
              style={{ animationDelay: `${Math.min(i, 11) * 50}ms` }}
            >
              <AgentCard agent={agent} trustScore={trustScore} lastActive={lastActivity[agent.account]} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

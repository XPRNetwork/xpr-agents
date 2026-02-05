import Link from 'next/link';
import { Agent, TrustScore, formatXpr } from '@/lib/registry';
import { TrustBadge } from './TrustBadge';

interface AgentCardProps {
  agent: Agent;
  trustScore?: TrustScore | null;
}

export function AgentCard({ agent, trustScore }: AgentCardProps) {
  return (
    <Link href={`/agent/${agent.account}`}>
      <div className="border border-gray-200 rounded-lg p-4 hover:shadow-lg transition-shadow cursor-pointer bg-white">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900">{agent.name}</h3>
            <p className="text-sm text-gray-500">@{agent.account}</p>
          </div>
          {trustScore && <TrustBadge trustScore={trustScore} size="sm" />}
        </div>

        <p className="mt-2 text-sm text-gray-600 line-clamp-2">{agent.description}</p>

        <div className="mt-3 flex flex-wrap gap-1">
          {agent.capabilities.slice(0, 3).map((cap) => (
            <span
              key={cap}
              className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full"
            >
              {cap}
            </span>
          ))}
          {agent.capabilities.length > 3 && (
            <span className="px-2 py-1 text-gray-400 text-xs">
              +{agent.capabilities.length - 3} more
            </span>
          )}
        </div>

        <div className="mt-4 flex justify-between text-sm text-gray-500">
          <span>Stake: {formatXpr(agent.stake)}</span>
          <span>{agent.total_jobs} jobs</span>
        </div>

        {!agent.active && (
          <div className="mt-2 text-xs text-red-500 font-medium">Inactive</div>
        )}
      </div>
    </Link>
  );
}

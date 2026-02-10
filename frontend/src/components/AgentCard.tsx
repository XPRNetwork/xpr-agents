import Link from 'next/link';
import { Agent, TrustScore, formatXpr } from '@/lib/registry';
import { TrustBadge } from './TrustBadge';

interface AgentCardProps {
  agent: Agent;
  trustScore?: TrustScore | null;
  earnings?: number;
  completedJobs?: number;
}

export function AgentCard({ agent, trustScore, earnings, completedJobs }: AgentCardProps) {
  return (
    <Link href={`/agent/${agent.account}`}>
      <div className="border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 hover:bg-zinc-900/80 transition-all cursor-pointer bg-zinc-900">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">{agent.name}</h3>
            <p className="text-sm text-zinc-500">@{agent.account}</p>
          </div>
          {trustScore && <TrustBadge trustScore={trustScore} size="sm" />}
        </div>

        <p className="mt-2 text-sm text-zinc-400 line-clamp-2">{agent.description}</p>

        <div className="mt-3 flex flex-wrap gap-1">
          {agent.capabilities.slice(0, 3).map((cap) => (
            <span
              key={cap}
              className="px-2 py-1 bg-zinc-800 text-zinc-400 text-xs rounded-full"
            >
              {cap}
            </span>
          ))}
          {agent.capabilities.length > 3 && (
            <span className="px-2 py-1 text-zinc-600 text-xs">
              +{agent.capabilities.length - 3} more
            </span>
          )}
        </div>

        <div className="mt-4 flex justify-between items-center text-sm text-zinc-500">
          <span>Stake: {formatXpr(agent.stake)}</span>
          <div className="flex items-center gap-3">
            {earnings !== undefined && earnings > 0 && (
              <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-xs rounded-full font-medium">
                {formatXpr(earnings)} earned
              </span>
            )}
            <span>
              {agent.total_jobs} jobs
              {completedJobs !== undefined && completedJobs > 0 && agent.total_jobs > 0 && (
                <span className="text-zinc-600 ml-1">
                  ({Math.round((completedJobs / agent.total_jobs) * 100)}%)
                </span>
              )}
            </span>
          </div>
        </div>

        {!agent.active && (
          <div className="mt-2 text-xs text-red-400 font-medium">Inactive</div>
        )}
      </div>
    </Link>
  );
}

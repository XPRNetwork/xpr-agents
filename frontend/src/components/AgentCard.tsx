import Link from 'next/link';
import { Agent, TrustScore, formatXpr } from '@/lib/registry';
import { TrustBadge } from './TrustBadge';
import { AccountAvatar } from './AccountAvatar';

interface AgentCardProps {
  agent: Agent;
  trustScore?: TrustScore | null;
  earnings?: number;
  completedJobs?: number;
}

const gradientByRating: Record<string, string> = {
  untrusted: 'from-zinc-600 to-zinc-500',
  low: 'from-red-600 to-red-400',
  medium: 'from-yellow-500 to-amber-400',
  high: 'from-green-500 to-emerald-400',
  verified: 'from-proton-purple to-purple-400',
};

export function AgentCard({ agent, trustScore, earnings, completedJobs }: AgentCardProps) {
  const gradient = trustScore ? gradientByRating[trustScore.rating] : gradientByRating.untrusted;

  return (
    <Link href={`/agent/${agent.account}`}>
      <div className="border border-zinc-800 rounded-xl overflow-hidden card-hover-lift cursor-pointer bg-zinc-900">
        {/* Gradient top border */}
        <div className={`h-0.5 bg-gradient-to-r ${gradient}`} />

        <div className="p-4">
          <div className="flex justify-between items-start">
            <div className="flex items-start gap-3 flex-1">
              <AccountAvatar account={agent.account} name={agent.name} size={36} />
              <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-white truncate">{agent.name}</h3>
                {agent.active && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-pulse-dot absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                )}
              </div>
              <p className="text-sm text-zinc-500">@{agent.account}</p>
              </div>
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
      </div>
    </Link>
  );
}

import Link from 'next/link';
import { Agent, TrustScore, formatXpr } from '@/lib/registry';
import { TrustLedger, trustRatingLabel } from './TrustBadge';
import { AccountAvatar } from './AccountAvatar';

interface AgentCardProps {
  agent: Agent;
  trustScore?: TrustScore | null;
  earnings?: number;
  completedJobs?: number;
  lastActive?: number; // unix seconds of last completed job
}

const RECENTLY_ACTIVE_SECONDS = 24 * 60 * 60;

export function AgentCard({ agent, trustScore, earnings, completedJobs, lastActive }: AgentCardProps) {
  const nowSec = Math.floor(Date.now() / 1000);
  const recentlyActive = lastActive !== undefined && nowSec - lastActive < RECENTLY_ACTIVE_SECONDS;
  const successPct = completedJobs !== undefined && agent.total_jobs > 0
    ? Math.round((completedJobs / agent.total_jobs) * 100)
    : null;

  return (
    <Link
      href={`/agent/${agent.account}`}
      className="group block h-full rounded-xl border border-line bg-canvas p-5 transition-colors hover:border-line-2 focus-visible:border-accent"
    >
      <div className="flex items-start gap-3">
        <AccountAvatar account={agent.account} name={agent.name} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-display text-[17px] font-semibold text-ink">{agent.name}</h3>
            {recentlyActive && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-good" title="Active in the last 24 hours" />
            )}
            {!agent.active && (
              <span className="rounded bg-crit-soft px-1.5 py-0.5 text-[10px] font-medium text-crit">Inactive</span>
            )}
          </div>
          <p className="truncate font-mono text-xs text-muted">{agent.account}</p>
        </div>
        {trustScore && (
          <span className="shrink-0 font-mono text-sm tabular text-ink" title={trustRatingLabel(trustScore.rating)}>
            {trustScore.total}
          </span>
        )}
      </div>

      <p className="mt-3 min-h-[40px] text-sm leading-5 text-ink-2 line-clamp-2">
        {agent.description || 'No description yet.'}
      </p>

      {agent.capabilities.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {agent.capabilities.slice(0, 3).map((cap) => (
            <span key={cap} className="rounded-md bg-surface px-2 py-0.5 font-mono text-[11px] text-ink-2">
              {cap}
            </span>
          ))}
          {agent.capabilities.length > 3 && (
            <span className="px-1 py-0.5 font-mono text-[11px] text-muted">+{agent.capabilities.length - 3}</span>
          )}
        </div>
      )}

      <div className="mt-4 border-t border-line pt-3">
        {trustScore ? (
          <TrustLedger trustScore={trustScore} height={5} />
        ) : (
          <div className="h-[5px] rounded-[2px] bg-surface-2" />
        )}
        <div className="mt-2 flex items-center justify-between font-mono text-xs tabular text-muted">
          <span>
            {agent.total_jobs} {agent.total_jobs === 1 ? 'job' : 'jobs'}
            {successPct !== null && <span className="ml-1 text-ink-2">· {successPct}%</span>}
          </span>
          {earnings !== undefined && earnings > 0 ? (
            <span className="text-good">{formatXpr(earnings)}</span>
          ) : (
            <span>{formatXpr(agent.stake)} staked</span>
          )}
        </div>
      </div>
    </Link>
  );
}

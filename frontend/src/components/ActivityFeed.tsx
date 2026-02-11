import { useState, useEffect, useCallback } from 'react';
import { getRecentCompletedJobs, formatXpr, type Job } from '@/lib/registry';
import { AccountAvatar } from './AccountAvatar';

function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function ActivityFeed() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    try {
      const recent = await getRecentCompletedJobs(5);
      setJobs(recent);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 30000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      <div className="flex justify-between items-center mb-5">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-bold text-white">Recent Activity</h3>
          <span className="relative flex h-2 w-2">
            <span className="animate-pulse-dot absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
        </div>
        <a href="/jobs" className="text-sm text-proton-purple hover:underline">
          All Jobs
        </a>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/30">
              <div className="w-8 h-8 skeleton-shimmer rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 skeleton-shimmer rounded" />
                <div className="h-2 w-1/2 skeleton-shimmer rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <p className="text-zinc-500 text-sm py-4 text-center">No completed jobs yet</p>
      ) : (
        <div className="space-y-3">
          {jobs.map((job, i) => (
            <div
              key={job.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/30 animate-stagger animate-fade-in-up"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <AccountAvatar account={job.agent} size={32} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-white text-sm truncate">{job.title}</div>
                <div className="text-xs text-zinc-500">
                  {job.agent} &middot; {timeAgo(job.created_at)}
                </div>
              </div>
              <div className="text-right ml-4 shrink-0">
                <div className="text-sm font-semibold text-emerald-400">{formatXpr(job.amount)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

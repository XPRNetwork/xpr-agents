import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
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
      setJobs(await getRecentCompletedJobs(5));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 60000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  return (
    <section className="rounded-xl border border-line bg-canvas" aria-labelledby="completed-heading">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h3 id="completed-heading" className="font-display text-base font-semibold text-ink">Recently completed</h3>
        <Link href="/jobs" className="text-sm text-accent hover:text-accent-hover">All jobs</Link>
      </div>

      {loading ? (
        <div className="divide-y divide-line">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5">
              <div className="h-8 w-8 skeleton-shimmer rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 skeleton-shimmer rounded" />
                <div className="h-2 w-1/3 skeleton-shimmer rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-ink-2">No completed jobs yet.</p>
          <Link href="/jobs" className="mt-2 inline-block text-sm text-accent hover:text-accent-hover">Post the first one</Link>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link href={`/jobs/${job.id}`} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface">
                <AccountAvatar account={job.agent} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{job.title}</div>
                  <div className="font-mono text-xs text-muted">{job.agent} · {timeAgo(job.updated_at || job.created_at)}</div>
                </div>
                <div className="shrink-0 font-mono text-sm tabular text-good">{formatXpr(job.amount)}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

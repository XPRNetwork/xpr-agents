import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SiteHead } from '@/components/SiteHead';
import { JobDetail } from '@/components/JobDetail';
import { getJob, type Job } from '@/lib/registry';

export default function JobPage() {
  const router = useRouter();
  const { id } = router.query;
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    const jobId = parseInt(String(id));
    if (isNaN(jobId)) { setError(true); setLoading(false); return; }
    setLoading(true);
    setError(false);
    getJob(jobId)
      .then((j) => { if (j) setJob(j); else setError(true); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <>
      <SiteHead
        title={job ? `${job.title} · Job #${job.id}` : 'Job'}
        description={job ? job.description.slice(0, 160) : 'A job on the XPR Agents escrow board.'}
        path={`/jobs/${id ?? ''}`}
      />

      <div className="min-h-screen bg-canvas">
        <Header activePage="jobs" />

        <main className="mx-auto max-w-6xl px-4 py-8">
          <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-muted" aria-label="Breadcrumb">
            <Link href="/jobs" className="hover:text-ink">Jobs</Link>
            <span aria-hidden="true">/</span>
            <span className="text-ink-2">{job ? `#${job.id}` : loading ? '…' : 'Not found'}</span>
          </nav>

          {loading ? (
            <div className="grid gap-8 lg:grid-cols-12">
              <div className="space-y-4 lg:col-span-8">
                <div className="h-4 w-24 skeleton-shimmer rounded" />
                <div className="h-9 w-3/4 skeleton-shimmer rounded" />
                <div className="h-4 w-full skeleton-shimmer rounded" />
                <div className="h-4 w-5/6 skeleton-shimmer rounded" />
              </div>
              <div className="h-64 skeleton-shimmer rounded-xl lg:col-span-4" />
            </div>
          ) : error || !job ? (
            <div className="rounded-xl border border-line bg-canvas px-6 py-16 text-center">
              <p className="label mb-3">Job not found</p>
              <h1 className="font-display text-2xl font-semibold text-ink">This job doesn&apos;t exist or was removed.</h1>
              <Link href="/jobs" className="mt-6 inline-block rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover">Back to jobs</Link>
            </div>
          ) : (
            <JobDetail job={job} onJobUpdated={setJob} />
          )}
        </main>

        <Footer />
      </div>
    </>
  );
}

/**
 * Server-render the shell so the HTML a link-preview crawler receives carries
 * the real id: og:image (per-item card at /api/og/...) and the canonical URL
 * both derive from the route. Data is still fetched client-side.
 */
export const getServerSideProps = async ({ res }: { res: { setHeader: (k: string, v: string) => void } }) => {
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
  return { props: {} };
};

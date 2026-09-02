import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
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
    if (isNaN(jobId)) {
      setError(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    getJob(jobId)
      .then((j) => {
        if (j) {
          setJob(j);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <>
      <Head>
        <title>{job ? `${job.title} - Job #${job.id}` : 'Job Detail'} - XPR Agents</title>
        {job && <meta name="description" content={job.description.slice(0, 160)} />}
      </Head>

      <div className="min-h-screen bg-canvas">
        <Header activePage="jobs" />

        <main className="max-w-2xl mx-auto px-4 py-8">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-sm text-muted mb-6">
            <Link href="/jobs" className="hover:text-ink-2 transition-colors">Job Board</Link>
            <span>/</span>
            <span className="text-ink-2">
              {job ? `#${job.id}` : loading ? '...' : 'Not Found'}
            </span>
          </nav>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
            </div>
          ) : error || !job ? (
            <div className="text-center py-12">
              <h1 className="text-2xl font-bold text-ink mb-2">Job Not Found</h1>
              <p className="text-muted mb-6">This job doesn&apos;t exist or has been removed.</p>
              <Link href="/jobs" className="px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent-hover">
                Back to Job Board
              </Link>
            </div>
          ) : (
            <div className="bg-surface border border-line rounded-xl p-6">
              <JobDetail job={job} onJobUpdated={setJob} />
            </div>
          )}
        </main>

        <Footer />
      </div>
    </>
  );
}

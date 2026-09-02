import Head from 'next/head';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export default function NotFound() {
  return (
    <>
      <Head>
        <title>Page not found - XPR Agents</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="min-h-screen bg-canvas">
        <Header />
        <main className="mx-auto max-w-6xl px-4 py-24">
          <p className="label mb-4">404</p>
          <h1 className="font-display text-4xl font-semibold text-ink">There's nothing at this address.</h1>
          <p className="mt-4 max-w-lg text-ink-2">
            The page may have moved, or the agent or job you followed may have been removed from the registry.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/" className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-hover">Browse agents</Link>
            <Link href="/jobs" className="rounded-md border border-line-2 px-5 py-2.5 text-sm font-medium text-ink hover:border-ink">Job board</Link>
          </div>
        </main>
        <Footer />
      </div>
    </>
  );
}

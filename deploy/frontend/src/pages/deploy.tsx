import Head from 'next/head';
import Link from 'next/link';
import { DeployWizard } from '@/components/DeployWizard';

export default function DeployPage() {
  return (
    <>
      <Head>
        <title>Deploy Agent - XPR Agent Deploy</title>
      </Head>

      <div className="min-h-screen">
        <nav className="flex items-center justify-between px-6 py-4 border-b border-xpr-border">
          <Link href="/" className="text-xl font-bold">
            <span className="text-xpr-purple">XPR</span> Agent Deploy
          </Link>
          <div className="flex gap-4">
            <Link href="/pricing" className="text-gray-400 hover:text-white transition-colors">
              Pricing
            </Link>
            <Link href="/dashboard" className="text-gray-400 hover:text-white transition-colors">
              Dashboard
            </Link>
          </div>
        </nav>

        <div className="max-w-4xl mx-auto px-6 py-12">
          <DeployWizard />
        </div>
      </div>
    </>
  );
}

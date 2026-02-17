import Head from 'next/head';
import { Navbar } from '@/components/Navbar';
import { DeployWizard } from '@/components/DeployWizard';

export default function DeployPage() {
  return (
    <>
      <Head>
        <title>Deploy Agent - XPR Agent Deploy</title>
      </Head>

      <div className="min-h-screen">
        <Navbar />

        <div className="max-w-4xl mx-auto px-6 py-12">
          <DeployWizard />
        </div>
      </div>
    </>
  );
}

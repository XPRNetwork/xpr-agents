import type { AppProps } from 'next/app';
import Head from 'next/head';
import { Analytics } from '@vercel/analytics/react';
import { ProtonProvider } from '@/contexts/ProtonContext';
import { ToastProvider } from '@/contexts/ToastContext';
import '../styles/globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://xpr-agents-frontend.vercel.app';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ProtonProvider>
      <ToastProvider>
        <Head>
          <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
          <meta property="og:type" content="website" />
          <meta property="og:site_name" content="XPR Agents" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:image" content={`${SITE_URL}/og-image.png`} />
        </Head>
        <Component {...pageProps} />
        <Analytics />
      </ToastProvider>
    </ProtonProvider>
  );
}

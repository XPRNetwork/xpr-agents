import type { AppProps } from 'next/app';
import Head from 'next/head';
import { Instrument_Sans, Geist, Geist_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/react';
import { ProtonProvider } from '@/contexts/ProtonContext';
import { ToastProvider } from '@/contexts/ToastContext';
import '../styles/globals.css';

const instrument = Instrument_Sans({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-instrument', display: 'swap' });
const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://xpragents.com';

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
        <div className={`${instrument.variable} ${geist.variable} ${geistMono.variable} font-sans`}>
          <Component {...pageProps} />
        </div>
        <Analytics />
      </ToastProvider>
    </ProtonProvider>
  );
}

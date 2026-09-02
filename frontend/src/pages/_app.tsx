import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Instrument_Sans, Geist, Geist_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/react';
import { ProtonProvider } from '@/contexts/ProtonContext';
import { ToastProvider } from '@/contexts/ToastContext';
import '../styles/globals.css';

const instrument = Instrument_Sans({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-instrument', display: 'swap' });
const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://xpragents.com';

/** Route → social card. Files live in public/og/. Anything unmatched uses the default. */
const OG_BY_ROUTE: Array<[RegExp, string]> = [
  [/^\/jobs/, 'jobs'],
  [/^\/services/, 'jobs'],   // TODO: dedicated /og/services.jpg
  [/^\/get-started/, 'get-started'],
  [/^\/how-it-works/, 'how-it-works'],
  [/^\/register/, 'register'],
  [/^\/leaderboard/, 'leaderboard'],
  [/^\/validators/, 'validators'],
  [/^\/arbitrators/, 'arbitrators'],
  [/^\/agent\//, 'agent'],
];
export function ogImageForPath(pathname: string): string {
  const match = OG_BY_ROUTE.find(([re]) => re.test(pathname));
  return `${SITE_URL}/og/${match ? match[1] : 'default'}.jpg`;
}

export default function App({ Component, pageProps }: AppProps) {
  const { pathname } = useRouter();
  const ogImage = ogImageForPath(pathname);
  return (
    <ProtonProvider>
      <ToastProvider>
        <Head>
          <meta key="og:image" property="og:image" content={ogImage} />
          <meta key="og:image:width" property="og:image:width" content="1200" />
          <meta key="og:image:height" property="og:image:height" content="630" />
          <meta key="og:type" property="og:type" content="website" />
          <meta key="og:site_name" property="og:site_name" content="XPR Agents" />
          <meta key="twitter:card" name="twitter:card" content="summary_large_image" />
          <meta key="twitter:image" name="twitter:image" content={ogImage} />
        </Head>
        <div className={`${instrument.variable} ${geist.variable} ${geistMono.variable} font-sans`}>
          <Component {...pageProps} />
        </div>
        <Analytics />
      </ToastProvider>
    </ProtonProvider>
  );
}

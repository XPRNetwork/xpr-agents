import type { AppProps } from 'next/app';
import Head from 'next/head';
import { ProtonProvider } from '@/contexts/ProtonContext';
import '@/styles/globals.css';

const SITE_URL = 'https://deploy.xpragents.com';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ProtonProvider>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Open Graph defaults */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="XPR Agent Deploy" />
        <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        {/* Twitter Card defaults */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content={`${SITE_URL}/og-image.png`} />
      </Head>
      <Component {...pageProps} />
    </ProtonProvider>
  );
}

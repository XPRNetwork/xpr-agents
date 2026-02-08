import type { AppProps } from 'next/app';
import { ProtonProvider } from '@/contexts/ProtonContext';
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ProtonProvider>
      <Component {...pageProps} />
    </ProtonProvider>
  );
}

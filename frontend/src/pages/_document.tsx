import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Theme before first paint. Deliberately a same-origin file, not inline: the CSP has
            no 'unsafe-inline' for scripts. Synchronous on purpose, so the page never flashes. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-init.js" />
        {/* The XPR atom on a solid indigo tile. A transparent black glyph disappears on a
            dark browser tab bar, and its thin orbits blur away at 16px — the tile fixes the
            first, and the small sizes are drawn with a heavier stroke to fix the second. */}
        <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content="#4b3adf" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

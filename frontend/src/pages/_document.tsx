import { Html, Head, Main, NextScript } from 'next/document';

/**
 * Applies the saved theme before first paint so there is no flash.
 * Stored value: "light" | "dark". Nothing stored = light (the site default).
 */
const themeInit = `(function(){try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
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

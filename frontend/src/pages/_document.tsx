import { Html, Head, Main, NextScript } from 'next/document';

/**
 * Applies the saved theme before first paint so there is no flash.
 * Stored value: "light" | "dark". Nothing stored = follow the OS.
 */
const themeInit = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

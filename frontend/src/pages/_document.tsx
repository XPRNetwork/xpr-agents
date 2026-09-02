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
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

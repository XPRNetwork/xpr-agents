import Head from 'next/head';

interface Props {
  title?: string;
  description: string;
  /** Path relative to xpragents.com, e.g. "/get-started". Leave blank for home. */
  path?: string;
  /** Defaults to the OG image hosted at the canonical domain. */
  image?: string;
}

const CANONICAL_HOST = 'https://xpragents.com';
const DEFAULT_OG_IMAGE = `${CANONICAL_HOST}/og-image.png`;
const DEFAULT_TITLE = 'XPR Agents — Trustless AI Agent Registry on XPR Network';

/**
 * Shared `<Head>` block for every page on xpragents.com. Centralises
 * og:* / twitter:* / canonical so we don't keep landing in the
 * "only the home page has full metadata" trap that the audit caught.
 */
export function SiteHead({ title, description, path = '', image }: Props) {
  const fullTitle = title ? `${title} — XPR Agents` : DEFAULT_TITLE;
  const shortTitle = title || 'XPR Agents';
  const url = `${CANONICAL_HOST}${path}`;
  const ogImage = image || DEFAULT_OG_IMAGE;

  return (
    <Head>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <link rel="canonical" href={url} />

      {/* Open Graph */}
      <meta property="og:title" content={shortTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="XPR Agents" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={shortTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
    </Head>
  );
}

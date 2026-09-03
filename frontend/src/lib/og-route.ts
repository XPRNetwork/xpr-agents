/**
 * Shared body of /api/og/jobs/[id] and /api/og/services/[id].
 *
 * Contract with the crawlers: always answer with something image-shaped, fast.
 * Anything that is slow, missing or undecodable degrades one step at a time —
 * per-item artwork -> per-item text card -> the static route card.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { renderCard } from './og-card';
import { fetchImageAsDataUri, jobOgItem, serviceOgItem, type OgItem } from './og-image';

export type OgKind = 'jobs' | 'services';

/** Fresh enough that a delivered job gets its artwork within the hour. */
const CACHE_OK = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=604800';
/** A miss should not be pinned in the CDN for long. */
const CACHE_FALLBACK = 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600';

const STATIC_CARD: Record<OgKind, string> = {
  jobs: '/og/jobs.jpg',
  services: '/og/jobs.jpg', // TODO: /og/services.jpg once the art exists
};

/** Absolute, because a few crawlers refuse to resolve a relative image redirect. */
function staticCardUrl(req: NextApiRequest, kind: OgKind): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return `${configured.replace(/\/$/, '')}${STATIC_CARD[kind]}`;
  const host = req.headers.host;
  if (!host) return STATIC_CARD[kind];
  const proto = /^localhost|^127\./.test(host) ? 'http' : 'https';
  return `${proto}://${host}${STATIC_CARD[kind]}`;
}

function fallback(req: NextApiRequest, res: NextApiResponse, kind: OgKind) {
  if (res.headersSent) return;
  res.setHeader('Cache-Control', CACHE_FALLBACK);
  res.redirect(302, staticCardUrl(req, kind));
}

export async function serveOgCard(req: NextApiRequest, res: NextApiResponse, kind: OgKind): Promise<void> {
  const id = parseInt(String(req.query.id ?? ''), 10);
  if (!Number.isFinite(id) || id < 0) return fallback(req, res, kind);

  let item: OgItem | null = null;
  try {
    item = kind === 'jobs' ? await jobOgItem(id) : await serviceOgItem(id);
  } catch {
    item = null;
  }
  if (!item) return fallback(req, res, kind);

  try {
    const image = item.imageUrl ? await fetchImageAsDataUri(item.imageUrl) : null;
    const png = Buffer.from(await (await renderCard({ ...item, image })).arrayBuffer());

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(png.length));
    res.setHeader('Cache-Control', CACHE_OK);
    // Cheap way to see which branch ran when debugging a preview.
    res.setHeader('X-Og-Source', image ? 'item-image' : 'text-only');
    res.status(200).end(req.method === 'HEAD' ? undefined : png);
  } catch {
    fallback(req, res, kind);
  }
}

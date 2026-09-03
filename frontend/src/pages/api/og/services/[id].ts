import type { NextApiRequest, NextApiResponse } from 'next';
import { serveOgCard } from '@/lib/og-route';

/** og:image for /services/:id — the listing's sample image, or a branded text card. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await serveOgCard(req, res, 'services');
}

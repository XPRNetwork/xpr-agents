/**
 * Per-item social-card data: resolve "the first image for a job / service" and
 * fetch it in a shape `next/og` can rasterise.
 *
 * Used only by the /api/og/* routes, which run server-side on Vercel. Link
 * preview crawlers do not run JS, so everything here has to work from the
 * route parameters alone — no wallet, no localStorage, no client state.
 *
 * Manifest semantics are imported from ./registry so the card can never
 * disagree with what the page itself renders.
 */
import { IPFS_GATEWAY, isImageUri, parseDeliverableManifest } from './registry';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** Fits inside a crawler's patience budget; anything slower falls back to a text card. */
export const IMAGE_FETCH_TIMEOUT_MS = 3500;
/** The largest source image we will pull down. The real 1200x1200 samples run ~5 MB. */
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** Item lookup (indexer, then chain) gets its own, tighter budget. */
export const ITEM_FETCH_TIMEOUT_MS = 3000;

const INDEXER_URLS: Record<string, string> = {
  mainnet: 'https://indexer.xpragents.com',
  testnet: 'https://testnet-indexer.xpragents.com',
};
const RPC_URLS: Record<string, string> = {
  mainnet: 'https://proton.eosusa.io',
  testnet: 'https://tn1.protonnz.com',
};

function network(): 'mainnet' | 'testnet' {
  return process.env.NEXT_PUBLIC_NETWORK === 'testnet' ? 'testnet' : 'mainnet';
}
function indexerBase(): string {
  return process.env.OG_INDEXER_URL || INDEXER_URLS[network()];
}
function rpcBase(): string {
  return RPC_URLS[network()];
}
const ESCROW = process.env.NEXT_PUBLIC_AGENT_ESCROW || 'agentescrow';

/** resvg (inside next/og) decodes these; webp/avif would render as a blank box. */
const RASTERISABLE = /^image\/(png|jpeg|jpg|gif|svg\+xml)/i;

/** `ipfs://CID` -> the gateway the rest of the site uses. Everything else passes through. */
export function toGatewayUrl(uri: string): string {
  const s = uri.trim();
  return /^ipfs:\/\//i.test(s) ? `${IPFS_GATEWAY}${s.slice(7)}` : s;
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'];

/**
 * Manifest entry with no declared `type`: trust the filename when it carries an
 * extension, and only then fall back to the URL heuristic (which treats every
 * bare `/ipfs/<cid>` link as a possible image).
 */
function untypedLooksLikeImage(name: string, uri: string): boolean {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name || '')?.[1]?.toLowerCase();
  if (ext) return IMAGE_EXTENSIONS.includes(ext);
  return isImageUri(uri);
}

/**
 * First renderable image in a job's `evidence_uri` or a service's `sample_uri`.
 *
 * Handles every shape those fields take in practice:
 *   - a deliverable manifest `{"v":1,"files":[{name,uri,type}]}` — prefers the
 *     first `image/*` entry, then the first entry that looks like an image
 *   - a bare `https://` / `ipfs://` URL
 *   - a comma-separated list of URLs (older agents)
 *   - a `data:image/...` URI
 * Returns null for NFT payloads, PDFs, plain text deliverables and junk.
 */
export function firstImageUri(raw: string | null | undefined): string | null {
  const s = (raw || '').trim();
  if (!s) return null;

  // data: URIs contain commas, so they must be settled before any splitting.
  if (s.startsWith('data:')) return s.startsWith('data:image/') ? s : null;

  const manifest = parseDeliverableManifest(s);
  if (manifest) {
    const typed = manifest.files.find((f) => (f.type || '').toLowerCase().startsWith('image/'));
    if (typed) return typed.uri; // parseDeliverableManifest already resolved ipfs://
    // A declared non-image type is believed. Only untyped entries are sniffed —
    // otherwise `report.md` on a bare-CID gateway URL looks like an image to
    // isImageUri() and ends up as the card.
    const sniffed = manifest.files.find((f) => !f.type && untypedLooksLikeImage(f.name, f.uri));
    return sniffed ? sniffed.uri : null;
  }

  // Any other JSON payload (NFT deliverables, custom blobs) — no cheap image.
  if (s.startsWith('{') || s.startsWith('[')) return null;

  for (const part of s.split(',').map((p) => p.trim()).filter(Boolean)) {
    if (isImageUri(part)) return toGatewayUrl(part);
  }
  return null;
}

export interface OgItem {
  /** Small mono line above the title. */
  eyebrow: string;
  title: string;
  /** One-line description, already trimmed. */
  subtitle: string;
  /** Absolute https URL of the artwork, or null for a text-only card. */
  imageUrl: string | null;
}

const JOB_STATE_LABELS: Record<number, string> = {
  0: 'Open', 1: 'Funded', 2: 'Accepted', 3: 'In progress', 4: 'Delivered',
  5: 'Disputed', 6: 'Completed', 7: 'Refunded', 8: 'Arbitrated',
};

/** Raw units -> "250 XPR" / "12.5 XPR". */
export function formatXpr(raw: number | string | null | undefined): string {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : raw || 0;
  if (!n || !Number.isFinite(n)) return '0 XPR';
  const xpr = n / 10000;
  const body = xpr >= 100 ? Math.round(xpr).toLocaleString('en-US') : String(Math.round(xpr * 100) / 100);
  return `${body} XPR`;
}

export function clamp(text: string, max: number): string {
  const s = (text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  // Drop the punctuation the cut lands on so it never reads "sentence.…".
  return `${s.slice(0, max - 1).replace(/[\s.,;:!?\-–—]+$/, '')}…`;
}

async function getJson(url: string, timeoutMs = ITEM_FETCH_TIMEOUT_MS): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getTableRow(table: string, id: number): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ITEM_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${rpcBase()}/v1/chain/get_table_rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        json: true, code: ESCROW, scope: ESCROW, table,
        lower_bound: String(id), upper_bound: String(id), limit: 1,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.rows?.[0] ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Card content for /jobs/:id. Indexer first (it joins job_evidence), chain as fallback. */
export async function jobOgItem(id: number): Promise<OgItem | null> {
  let row = await getJson(`${indexerBase()}/api/jobs/${id}`);
  if (!row || typeof row !== 'object' || row.error) {
    const job = await getTableRow('jobs', id);
    if (!job) return null;
    const evidence = await getTableRow('jobevidence', id);
    row = { ...job, evidence_uri: evidence?.evidence_uri || '' };
  }

  const state = typeof row.state === 'number' ? row.state : parseInt(row.state, 10) || 0;
  return {
    eyebrow: `Job #${id} · ${formatXpr(row.amount)} · ${JOB_STATE_LABELS[state] || 'Job'}`,
    title: clamp(row.title || `Job #${id}`, 90),
    subtitle: clamp(row.description || 'A job on the XPR Agents escrow board.', 150),
    imageUrl: firstImageUri(row.evidence_uri),
  };
}

/** Card content for /services/:id. */
export async function serviceOgItem(id: number): Promise<OgItem | null> {
  let row = await getJson(`${indexerBase()}/api/services/${id}`);
  if (row && typeof row === 'object' && (row.service || row.data)) row = row.service ?? row.data;
  if (!row || typeof row !== 'object' || row.error || (row.id === undefined && !row.agent)) {
    row = await getTableRow('services', id);
    if (!row) return null;
  }

  const category = String(row.category || 'service');
  return {
    eyebrow: `${category.charAt(0).toUpperCase()}${category.slice(1)} · ${formatXpr(row.price)} · ${row.agent || 'XPR Agents'}`,
    title: clamp(row.title || `Service #${id}`, 90),
    subtitle: clamp(row.description || 'A fixed-price service on the XPR Agents marketplace.', 150),
    imageUrl: firstImageUri(row.sample_uri),
  };
}

/**
 * Pull the artwork down ourselves rather than letting satori fetch it: that is
 * the only way to bound the time (IPFS gateways 504 and hang) and the size, and
 * to reject formats resvg cannot decode.
 *
 * Returns a `data:` URI for the <img>, or null so the caller renders text only.
 */
export async function fetchImageAsDataUri(url: string): Promise<string | null> {
  if (url.startsWith('data:image/')) return url;
  if (!/^https:\/\//i.test(url)) return null; // crawlers refuse mixed content anyway

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'image/*' } });
    if (!res.ok) return null;

    const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!RASTERISABLE.test(mime)) return null;

    const declared = parseInt(res.headers.get('content-length') || '0', 10);
    if (declared > IMAGE_MAX_BYTES) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > IMAGE_MAX_BYTES) return null;

    return `data:${mime === 'image/jpg' ? 'image/jpeg' : mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

import { useEffect, useMemo, useState } from 'react';

/**
 * <img> that survives flaky IPFS gateways.
 *
 * Deliverables are usually pinned once and referenced through a single public
 * gateway (ipfs.io by default). When that gateway times out the picture simply
 * breaks. This component extracts the CID and, on error, retries the same
 * content through other gateways before giving up and showing a link.
 */

const FALLBACK_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/',
];

/** Returns the CID plus any sub-path for an IPFS URL, or null for non-IPFS URLs. */
export function ipfsPath(url: string): string | null {
  const m = url.match(/^ipfs:\/\/(.+)$/i) || url.match(/\/ipfs\/([A-Za-z0-9]+(?:\/[^?#]*)?)/);
  return m ? m[1] : null;
}

/** All candidate URLs for a deliverable, original first, de-duplicated. */
export function ipfsCandidates(url: string): string[] {
  const p = ipfsPath(url);
  const original = url.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${p}` : url;
  if (!p) return [original];
  const out = [original, ...FALLBACK_GATEWAYS.map(g => g + p)];
  return out.filter((u, i) => out.indexOf(u) === i);
}

interface Props extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  src: string;
  /** Rendered when every gateway fails. Defaults to a link to the original URL. */
  fallback?: React.ReactNode;
}

export default function IpfsImage({ src, fallback, alt, className, ...rest }: Props) {
  const candidates = useMemo(() => ipfsCandidates(src), [src]);
  const [index, setIndex] = useState(0);
  useEffect(() => { setIndex(0); }, [src]);

  if (index >= candidates.length) {
    return (
      <>{fallback ?? (
        <a href={src} target="_blank" rel="noopener noreferrer" className={`flex flex-wrap items-center justify-center gap-2 border border-dashed border-line-2 rounded-lg px-4 py-6 text-center text-sm text-ink-2 hover:text-ink ${className || ''}`}>
          <span>Preview unavailable from IPFS gateways.</span>
          <span className="min-w-0 break-all font-mono text-accent">Open {alt || 'file'} ↗</span>
        </a>
      )}</>
    );
  }

  return (
    <img
      {...rest}
      src={candidates[index]}
      alt={alt}
      className={className}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setIndex(i => i + 1)}
    />
  );
}

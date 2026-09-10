import { useEffect, useMemo, useState } from 'react';
import { ipfsCandidates, ipfsPath } from '@/lib/ipfs';

/**
 * <img> that survives flaky IPFS gateways.
 *
 * Deliverables are usually pinned once and referenced through a single public
 * gateway. When that gateway times out the picture simply breaks. This component
 * takes the CID and, on error, retries the same content through other gateways
 * before giving up and showing a link.
 *
 * The CID parsing and gateway list live in `@/lib/ipfs` so the 3D model viewer
 * falls back over exactly the same gateways. Re-exported here for existing callers.
 */
export { ipfsPath, ipfsCandidates };

interface Props extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  src: string;
  /** Rendered when every gateway fails. Defaults to a link to the original URL. */
  fallback?: React.ReactNode;
}

export default function IpfsImage({ src, fallback, alt, className, ...rest }: Props) {
  const candidates = useMemo(() => ipfsCandidates(src), [src]);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setIndex(0); setLoaded(false); }, [src]);

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
      // Until a gateway answers there is nothing to show, and walking four of them can
      // take a while — hold a pulsing plate rather than blank space.
      className={`${className || ''}${loaded ? '' : ' animate-pulse bg-surface'}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onLoad={() => setLoaded(true)}
      onError={() => setIndex(i => i + 1)}
    />
  );
}

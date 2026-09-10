import { useEffect, useState } from 'react';
import { ipfsCandidates } from '@/lib/ipfs';

export type RemoteFileState = 'loading' | 'ready' | 'failed';

/**
 * Fetch a delivered file's text, walking the IPFS gateway fallbacks.
 *
 * Every inline preview needs the same thing: try each gateway in turn, give up
 * quietly, and refuse anything too large to put on a page. Failure is not an
 * error state worth showing — the manifest's file list is always rendered
 * alongside, so a dead gateway leaves the link rather than a red box.
 */
export function useRemoteFile(uri: string, maxBytes = 1024 * 1024): { state: RemoteFileState; text: string | null } {
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<RemoteFileState>('loading');

  useEffect(() => {
    let active = true;
    setState('loading');
    setText(null);

    (async () => {
      for (const url of ipfsCandidates(uri)) {
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!resp.ok) continue;
          const declared = Number(resp.headers.get('content-length') || 0);
          if (declared > maxBytes) break;
          const body = await resp.text();
          if (!active) return;
          // Gateways often send no content-length, so the real check is after reading.
          if (body.length > maxBytes) break;
          setText(body);
          setState('ready');
          return;
        } catch { /* next gateway */ }
      }
      if (active) setState('failed');
    })();

    return () => { active = false; };
  }, [uri, maxBytes]);

  return { state, text };
}

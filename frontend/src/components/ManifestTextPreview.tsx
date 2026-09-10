import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ipfsCandidates } from '@/lib/ipfs';
import { isMarkdown, renderMarkdown } from '@/lib/markdown';

/** Past this a deliverable is a dataset, not something to read on the page. */
const MAX_BYTES = 512 * 1024;

/**
 * Renders a text file from a delivery manifest inline.
 *
 * Agents ship the substance of a job as `report.md` or `summary.md` inside the
 * manifest, and a bare list of links buries it — the client has to open a raw
 * IPFS gateway to read the work they paid for. This fetches the file (walking
 * the gateway fallbacks like every other pinned asset) and renders it.
 *
 * Failure is silent: the manifest's own file list is always rendered alongside,
 * so an unreachable gateway leaves the link rather than an error box.
 */
export default function ManifestTextPreview({ uri, name }: { uri: string; name: string }) {
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let active = true;
    setState('loading');
    setText(null);

    (async () => {
      for (const url of ipfsCandidates(uri)) {
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!resp.ok) continue;
          const size = Number(resp.headers.get('content-length') || 0);
          if (size > MAX_BYTES) break;
          const body = await resp.text();
          if (!active) return;
          // Gateways send no content-length for many pins, so check after reading too.
          if (body.length > MAX_BYTES) break;
          setText(body);
          setState('ready');
          return;
        } catch { /* next gateway */ }
      }
      if (active) setState('failed');
    })();

    return () => { active = false; };
  }, [uri]);

  // A long report is clipped rather than given its own scrollbar: a nested scroll area
  // inside a page steals the wheel and hides how much is left. Show the fold instead.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [clipped, setClipped] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Only measured while collapsed — once expanded the element is its own full height, so
  // re-measuring would decide nothing was ever clipped and drop the "Show less" control.
  const measure = useCallback(() => {
    const el = contentRef.current;
    if (el && !expanded) setClipped(el.scrollHeight > el.clientHeight + 8);
  }, [expanded]);
  useLayoutEffect(measure, [measure, text, expanded]);
  const bodyClass = `p-4 text-sm text-ink-2${expanded ? '' : ' max-h-[36rem] overflow-hidden'}`;

  if (state === 'failed') return null;

  return (
    <div className="rounded-md border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <span className="truncate font-mono text-xs text-muted">{name}</span>
        <a href={uri} target="_blank" rel="noopener noreferrer" className="shrink-0 font-mono text-xs text-muted hover:text-ink">raw ↗</a>
      </div>
      {state === 'loading' ? (
        <div className="space-y-2 p-4" aria-label={`Loading ${name}`}>
          <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-surface-2" />
        </div>
      ) : (
        <div>
          {/* The fade belongs to the clipped text only — the control below it stays legible. */}
          <div className="relative">
            {isMarkdown(text || '') ? (
              <div
                ref={contentRef}
                className={bodyClass}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(text || '') }}
              />
            ) : (
              <div ref={contentRef} className={`${bodyClass} whitespace-pre-wrap`}>{text}</div>
            )}
            {clipped && !expanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface to-transparent" />
            )}
          </div>
          {clipped && (
            <div className="border-t border-line px-3 py-2 text-center">
              <button
                onClick={() => setExpanded(e => !e)}
                className="font-mono text-xs text-accent hover:text-accent-hover"
              >
                {expanded ? 'Show less' : `Show all of ${name}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

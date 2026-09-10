import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The frame every inline deliverable preview sits in.
 *
 * One filename bar, one link to the raw file, and a body that clips at a fixed
 * height with an expand control rather than growing without limit or taking its
 * own scrollbar — a nested scroll area steals the wheel and hides how much is
 * left. Shared so a report, a dataset and a JSON blob all read the same way.
 */
export default function PreviewShell({
  name,
  uri,
  loading = false,
  meta,
  children,
  maxHeight = 'max-h-[36rem]',
}: {
  name: string;
  uri: string;
  loading?: boolean;
  /** Small right-aligned detail in the header, e.g. "73 rows × 11 columns". */
  meta?: ReactNode;
  children?: ReactNode;
  maxHeight?: string;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [clipped, setClipped] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Only measured while collapsed — once expanded the element is its own full height,
  // so re-measuring would decide nothing was ever clipped and drop the "Show less".
  const measure = useCallback(() => {
    const el = contentRef.current;
    if (el && !expanded) setClipped(el.scrollHeight > el.clientHeight + 8);
  }, [expanded]);
  useLayoutEffect(measure, [measure, children, expanded]);

  return (
    <div className="rounded-md border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <span className="truncate font-mono text-xs text-muted">{name}</span>
        <span className="flex shrink-0 items-center gap-3">
          {meta && <span className="font-mono text-[11px] text-muted">{meta}</span>}
          <a href={uri} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-muted hover:text-ink">raw ↗</a>
        </span>
      </div>

      {loading ? (
        <div className="space-y-2 p-4" aria-label={`Loading ${name}`}>
          <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-surface-2" />
        </div>
      ) : (
        <div>
          {/* The fade belongs to the clipped content only — the control stays legible. */}
          <div className="relative">
            <div ref={contentRef} className={expanded ? '' : `${maxHeight} overflow-hidden`}>
              {children}
            </div>
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

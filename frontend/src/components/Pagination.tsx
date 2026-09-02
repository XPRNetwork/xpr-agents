/** Compact page list: first/last always, a window around the current page, gaps as ellipses. */
function pageWindow(current: number, count: number): Array<number | null> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const pages = new Set<number>([0, count - 1, current - 1, current, current + 1]);
  const list = [...pages].filter(p => p >= 0 && p < count).sort((a, b) => a - b);
  const out: Array<number | null> = [];
  for (let i = 0; i < list.length; i++) {
    if (i > 0 && list[i] - list[i - 1] > 1) out.push(null);
    out.push(list[i]);
  }
  return out;
}

interface PaginationProps {
  page: number;          // 0-based
  pageCount: number;
  onChange: (page: number) => void;
  disabled?: boolean;
  label?: string;
}

export function Pagination({ page, pageCount, onChange, disabled, label = 'Pages' }: PaginationProps) {
  if (pageCount <= 1) return null;
  const go = (p: number) => { const c = Math.min(Math.max(p, 0), pageCount - 1); if (c !== page) onChange(c); };
  const btn = 'rounded-md px-3 py-2 text-sm bg-surface-2 text-ink-2 hover:bg-line disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <nav className="mt-8 flex flex-wrap items-center justify-center gap-1" aria-label={label}>
      <button onClick={() => go(page - 1)} disabled={page === 0 || disabled} className={btn}>Previous</button>
      {pageWindow(page, pageCount).map((p, i) =>
        p === null ? (
          <span key={`gap-${i}`} className="px-2 text-muted">…</span>
        ) : (
          <button
            key={p}
            onClick={() => go(p)}
            disabled={disabled}
            aria-current={p === page ? 'page' : undefined}
            className={`min-w-[40px] rounded-md px-3 py-2 text-sm tabular ${p === page ? 'bg-accent text-white' : 'bg-surface-2 text-ink-2 hover:bg-line'}`}
          >
            {p + 1}
          </button>
        )
      )}
      <button onClick={() => go(page + 1)} disabled={page >= pageCount - 1 || disabled} className={btn}>Next</button>
    </nav>
  );
}

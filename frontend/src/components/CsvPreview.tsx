import { useMemo, useState } from 'react';
import PreviewShell from '@/components/PreviewShell';
import { useRemoteFile } from '@/lib/use-remote-file';
import { compareCells, isNumericColumn, parseCsv } from '@/lib/csv';

const MAX_BYTES = 2 * 1024 * 1024;
/** Rows parsed for display. Beyond this the file is a download, not a table. */
const MAX_ROWS = 500;

/**
 * A delivered CSV, as a sortable table.
 *
 * A dataset was the entire deliverable on several jobs here, and the client's only
 * way to check it was to download the file and open a spreadsheet. Sorting matters
 * more than it looks: it is how someone spot-checks a delivery — sort by amount,
 * see whether the extremes are plausible.
 *
 * Numeric columns right-align and sort numerically, so "1000" does not land before
 * "9" the way a string sort would.
 */
export default function CsvPreview({ uri, name }: { uri: string; name: string }) {
  const { state, text } = useRemoteFile(uri, MAX_BYTES);
  const table = useMemo(() => (text ? parseCsv(text, MAX_ROWS) : null), [text]);
  const numeric = useMemo(
    () => (table ? table.header.map((_, i) => isNumericColumn(table.rows, i)) : []),
    [table]
  );

  const [sort, setSort] = useState<{ column: number; desc: boolean } | null>(null);

  const rows = useMemo(() => {
    if (!table) return [];
    if (!sort) return table.rows;
    const sorted = [...table.rows].sort((a, b) =>
      compareCells(a[sort.column] ?? '', b[sort.column] ?? '', numeric[sort.column])
    );
    return sort.desc ? sorted.reverse() : sorted;
  }, [table, sort, numeric]);

  if (state === 'failed') return null;

  // Not comma-separated after all — show the bytes rather than a one-column grid.
  if (state === 'ready' && !table) {
    return (
      <PreviewShell name={name} uri={uri}>
        <div className="whitespace-pre-wrap p-4 font-mono text-xs text-ink-2">{text}</div>
      </PreviewShell>
    );
  }

  const meta = table
    ? `${table.rows.length}${table.truncated ? '+' : ''} rows × ${table.header.length} cols`
    : undefined;

  const toggle = (i: number) =>
    setSort(s => (s && s.column === i ? (s.desc ? null : { column: i, desc: true }) : { column: i, desc: false }));

  return (
    <PreviewShell name={name} uri={uri} loading={state === 'loading'} meta={meta}>
      {/* The table scrolls sideways on its own; the page never does. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {table?.header.map((h, i) => (
                <th
                  key={i}
                  className={`whitespace-nowrap border-b-2 border-line px-3 py-2 font-medium text-ink ${numeric[i] ? 'text-right' : 'text-left'}`}
                >
                  <button onClick={() => toggle(i)} className="inline-flex items-center gap-1 hover:text-accent" title={`Sort by ${h || `column ${i + 1}`}`}>
                    <span className="font-mono">{h || `col ${i + 1}`}</span>
                    <span className="text-muted">{sort?.column === i ? (sort.desc ? '↓' : '↑') : '↕'}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-line last:border-0">
                {table?.header.map((_, c) => (
                  <td key={c} className={`max-w-[22rem] truncate px-3 py-1.5 font-mono text-ink-2 ${numeric[c] ? 'text-right' : 'text-left'}`} title={row[c] ?? ''}>
                    {row[c] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table?.truncated && (
        <p className="border-t border-line px-3 py-2 text-center font-mono text-[11px] text-muted">
          First {MAX_ROWS} rows shown — open the raw file for the rest.
        </p>
      )}
    </PreviewShell>
  );
}

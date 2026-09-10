/**
 * A CSV parser for rendering delivered datasets as a table.
 *
 * Agents deliver data as CSV constantly, and the interesting failures are always
 * quoting: a title containing a comma, a note containing a newline, an escaped
 * quote inside a quoted field. Splitting on commas gets those wrong and silently
 * shifts every later column, which is worse than not rendering at all — so this
 * follows RFC 4180 properly.
 */

export interface ParsedCsv {
  header: string[];
  rows: string[][];
  /** True when parsing stopped at `maxRows` and the file has more. */
  truncated: boolean;
}

/**
 * Parse CSV text. Handles quoted fields, embedded commas and newlines, doubled
 * quotes, and both CRLF and LF line endings.
 *
 * Returns null when the text does not look like a table at all, so a caller can
 * fall back to showing it as plain text rather than a one-column grid.
 */
export function parseCsv(text: string, maxRows = 500): ParsedCsv | null {
  if (!text.trim()) return null;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let truncated = false;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => {
    endField();
    // A trailing newline produces one empty field, which is not a row.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"' && field === '') { quoted = true; continue; }
    if (c === ',') { endField(); continue; }
    if (c === '\r') continue;
    if (c === '\n') {
      endRow();
      // One row over the cap tells us the file continues past what we render.
      if (rows.length > maxRows) { truncated = true; break; }
      continue;
    }
    field += c;
  }
  if (!truncated && (field !== '' || row.length > 0)) endRow();

  if (rows.length === 0) return null;
  const header = rows[0];
  // A single column everywhere means the delimiter was not a comma — show it as text.
  if (header.length < 2) return null;

  const body = rows.slice(1, maxRows + 1);
  return { header, rows: body, truncated: truncated || rows.length - 1 > body.length };
}

/** Right-align a column when every value in it is a number. */
export function isNumericColumn(rows: string[][], index: number): boolean {
  let seen = 0;
  for (const r of rows) {
    const v = (r[index] ?? '').trim();
    if (v === '') continue;
    if (!/^-?\d+(\.\d+)?$/.test(v)) return false;
    seen++;
  }
  return seen > 0;
}

/** Comparator for a column: numeric when the column is numeric, else locale text. */
export function compareCells(a: string, b: string, numeric: boolean): number {
  const x = (a ?? '').trim();
  const y = (b ?? '').trim();
  // Blanks sort last regardless of direction, so an empty cell never leads the table.
  if (x === '' && y === '') return 0;
  if (x === '') return 1;
  if (y === '') return -1;
  if (numeric) return Number(x) - Number(y);
  return x.localeCompare(y);
}

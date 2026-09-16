/**
 * The small Markdown renderer used for deliverables and agent-written text.
 *
 * Agents write Markdown constantly — reports, summaries, notes — and it arrives
 * either inline in the evidence or as a `.md` file in a delivery manifest. This
 * renders the subset they actually use: headings, lists, tables, code, emphasis,
 * links and images. It is deliberately not a full CommonMark implementation.
 *
 * Everything is HTML-escaped before any markup is added — including both quote
 * characters, because link and image values are placed inside quoted attributes, and
 * an unescaped `"` there closes the attribute and lets agent text append its own
 * (`onerror=…`). Agent text therefore can inject neither tags nor attributes. Only the
 * tags produced here reach `dangerouslySetInnerHTML`, and nothing is un-escaped after
 * the escape pass.
 *
 * Styles are inline rather than classes because the output bypasses Tailwind's
 * scanner; colours read design tokens so it follows the theme.
 */

/** Does this text look like Markdown rather than a plain paragraph? */
export function isMarkdown(text: string): boolean {
  return (
    /^#{1,3} /m.test(text) ||
    /\*\*.+\*\*/.test(text) ||
    /```/.test(text) ||
    /^[-*] /m.test(text) ||
    /^\s*\|.*\|\s*$/m.test(text)
  );
}

/** A `|---|:--:|` row, which is what turns the line above it into a table header. */
function isDelimiterRow(line: string): boolean {
  return /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/.test(line) || /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(line);
}

/** Cells of a pipe row, without the outer pipes. */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map(c => c.trim());
}

function alignmentsFrom(delimiter: string): ('left' | 'right' | 'center')[] {
  return splitRow(delimiter).map(cell => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

/** Escape text for use in HTML content and in double- or single-quoted attributes. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Inline markup. Expects text that has ALREADY been through escapeHtml, which is why it
 * is not exported: called on raw text it would put agent input straight into attributes.
 *
 * URLs stay entity-escaped inside src/href: `&amp;` in a query string is correct HTML and
 * the browser decodes it. Nothing here un-escapes after the escape pass — that is the step
 * that could turn an escaped quote back into a live one.
 */
function applyInline(text: string): string {
  let out = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, (_m, alt, url) =>
    `<img src="${url}" alt="${alt}" style="max-width:100%;border-radius:8px;margin:8px 0" loading="lazy" />`);
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/`([^`]+)`/g, '<code style="background:rgb(var(--c-surface-2));padding:1px 4px;border-radius:3px;font-size:0.9em">$1</code>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_m, label, url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:rgb(var(--c-accent));text-decoration:underline">${label}</a>`);
  return out;
}

const CELL_BASE = 'padding:6px 10px;border-bottom:1px solid rgb(var(--c-line))';

/** Render a GFM pipe table. `rows` are raw lines; the delimiter row is already consumed. */
function renderTable(header: string, delimiter: string, bodyLines: string[]): string {
  const align = alignmentsFrom(delimiter);
  const headerCells = splitRow(header);
  const cellStyle = (i: number, extra = '') =>
    `${CELL_BASE};text-align:${align[i] || 'left'}${extra}`;

  const out: string[] = ['<div style="overflow-x:auto;margin:12px 0">', '<table style="width:100%;border-collapse:collapse;font-size:0.92em">'];
  // A table used purely for layout often has an empty header row — do not print a blank band.
  if (headerCells.some(c => c !== '')) {
    out.push('<thead><tr>');
    headerCells.forEach((cell, i) => {
      out.push(`<th style="${cellStyle(i, ';font-weight:600;color:rgb(var(--c-ink));border-bottom-width:2px')}">${applyInline(cell)}</th>`);
    });
    out.push('</tr></thead>');
  }
  out.push('<tbody>');
  for (const line of bodyLines) {
    out.push('<tr>');
    splitRow(line).forEach((cell, i) => {
      out.push(`<td style="${cellStyle(i)}">${applyInline(cell)}</td>`);
    });
    out.push('</tr>');
  }
  out.push('</tbody></table></div>');
  return out.join('');
}

export function renderMarkdown(text: string): string {
  // Some models wrap citations in <cite> tags; strip them before escaping.
  let html = text.replace(/<cite[^>]*>([\s\S]*?)<\/cite>/g, '$1');
  html = escapeHtml(html);

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre style="background:rgb(var(--c-surface-2));padding:12px;border-radius:8px;overflow-x:auto;margin:8px 0"><code>${code.trim()}</code></pre>`;
  });

  const lines = html.split('\n');
  const result: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { result.push('</ul>'); inList = false; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('<pre ')) {
      result.push(line);
      while (i < lines.length - 1 && !lines[i].includes('</pre>')) {
        i++;
        result.push(lines[i]);
      }
      continue;
    }

    // A pipe row is only a table if the next line is the |---| delimiter.
    if (/^\s*\|/.test(line) && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      closeList();
      const body: string[] = [];
      let j = i + 2;
      while (j < lines.length && /^\s*\|/.test(lines[j])) {
        body.push(lines[j]);
        j++;
      }
      result.push(renderTable(line, lines[i + 1], body));
      i = j - 1;
      continue;
    }

    if (line.startsWith('### ')) {
      closeList();
      result.push(`<h3 style="font-size:1rem;font-weight:600;color:rgb(var(--c-ink));margin:12px 0 4px">${applyInline(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith('## ')) {
      closeList();
      result.push(`<h2 style="font-size:1.1rem;font-weight:700;color:rgb(var(--c-ink));margin:16px 0 6px">${applyInline(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith('# ')) {
      closeList();
      result.push(`<h1 style="font-size:1.25rem;font-weight:700;color:rgb(var(--c-ink));margin:16px 0 8px">${applyInline(line.slice(2))}</h1>`);
      continue;
    }

    if (/^[-*] /.test(line)) {
      if (!inList) { result.push('<ul style="list-style:disc;padding-left:20px;margin:4px 0">'); inList = true; }
      result.push(`<li style="margin:2px 0">${applyInline(line.slice(2))}</li>`);
      continue;
    }

    closeList();

    if (/^---+$/.test(line.trim())) {
      result.push('<hr style="border-color:rgb(var(--c-line));margin:12px 0"/>');
      continue;
    }

    if (line.trim() === '') {
      result.push('<br/>');
      continue;
    }

    result.push(`<p style="margin:4px 0">${applyInline(line)}</p>`);
  }
  closeList();

  return result.join('\n');
}

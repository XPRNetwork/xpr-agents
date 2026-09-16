// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';

/**
 * Agent-written Markdown is rendered into the wallet-connected origin through
 * dangerouslySetInnerHTML, so these tests read the output the way a browser does: they
 * parse it into a DOM and inspect the elements and attributes that actually result.
 * Matching strings alone would miss a payload that only becomes an attribute once parsed.
 */

/** Tags and attributes the renderer is allowed to produce. Anything else is injected. */
const ALLOWED_TAGS = new Set([
  'div', 'p', 'br', 'h1', 'h2', 'h3', 'ul', 'li', 'hr', 'pre', 'code', 'strong',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img',
]);
const ALLOWED_ATTRS = new Set(['style', 'href', 'target', 'rel', 'src', 'alt', 'loading']);

function parse(markdown: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderMarkdown(markdown);
  return host;
}

/** Every element and attribute the parsed output contains that the renderer never emits. */
function injected(host: HTMLElement): string[] {
  const found: string[] = [];
  for (const el of Array.from(host.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) found.push(`<${tag}>`);
    for (const attr of Array.from(el.attributes)) {
      if (!ALLOWED_ATTRS.has(attr.name)) found.push(`${tag}[${attr.name}]`);
    }
  }
  return found;
}

describe('renderMarkdown — attribute injection', () => {
  // Reported 2026-09-17: a double quote closed the attribute and appended a handler.
  it('keeps a double quote in image alt text inside the alt attribute', () => {
    const host = parse('![x" onerror="alert(1)](https://example.com/a.png)');
    expect(injected(host)).toEqual([]);
    expect(host.querySelector('img')?.getAttribute('alt')).toBe('x" onerror="alert(1)');
  });

  it('keeps a double quote in an image URL inside the src attribute', () => {
    const host = parse('![x](https://example.com/a.png" onerror="alert(1))');
    expect(injected(host)).toEqual([]);
  });

  it('keeps a double quote in a link URL inside the href attribute', () => {
    const host = parse('[x](https://example.com/" onmouseover="alert(1))');
    expect(injected(host)).toEqual([]);
  });

  it('escapes single quotes too, so the output survives single-quoted attributes', () => {
    const html = renderMarkdown("![it's](https://example.com/a.png)");
    expect(html).not.toContain("'");
    expect(injected(parse("![x' onerror='alert(1)](https://example.com/a.png)"))).toEqual([]);
  });

  it('renders raw HTML as text, never as elements', () => {
    const host = parse('<img src=x onerror=alert(1)><script>alert(2)</script>');
    expect(injected(host)).toEqual([]);
    expect(host.textContent).toContain('<script>alert(2)</script>');
  });

  it('does not inject through table cells or headings', () => {
    const table = '| a | b |\n|---|---|\n| ![x" onerror="alert(1)](https://e.com/i.png) | [y](https://e.com/" onfocus="alert(2)) |';
    expect(injected(parse(table))).toEqual([]);
    expect(injected(parse('# ![x" onload="alert(1)](https://e.com/i.png)'))).toEqual([]);
  });

  it('does not turn non-http schemes into links', () => {
    const host = parse('[click](javascript:alert(1)) ![x](javascript:alert(2)) [d](data:text/html,x)');
    expect(host.querySelector('a')).toBeNull();
    expect(host.querySelector('img')).toBeNull();
  });
});

describe('renderMarkdown — still renders legitimate Markdown', () => {
  it('keeps an ampersand in a query string intact in the URL the browser sees', () => {
    const host = parse('[q](https://example.com/?a=1&b=2)');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com/?a=1&b=2');
  });

  it('renders headings, emphasis, code, links and images', () => {
    const host = parse('## Title\n\nSome **bold** and `code`, a [link](https://e.com) and ![pic](https://e.com/p.png)');
    expect(host.querySelector('h2')?.textContent).toBe('Title');
    expect(host.querySelector('strong')?.textContent).toBe('bold');
    expect(host.querySelector('code')?.textContent).toBe('code');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://e.com');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://e.com/p.png');
    expect(injected(host)).toEqual([]);
  });

  it('renders a table with the header and every row', () => {
    const host = parse('| token | value |\n|---|---:|\n| XPR | $1.00 |\n| XMD | $1.00 |');
    expect(host.querySelectorAll('th')).toHaveLength(2);
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('shows quotes in ordinary prose as quotes', () => {
    expect(parse('She said "ship it" and it\'s done').textContent).toContain('She said "ship it" and it\'s done');
  });
});

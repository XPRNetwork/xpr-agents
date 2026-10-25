// Fails the build if a prerendered page contains an executable inline <script>.
// The CSP in next.config.js allows scripts from 'self' only, so the browser would block
// such a script and the page would never hydrate (Next 16.4 inlines a Turbopack chunk loader).
// Data blocks (application/json, application/ld+json) are not executed and are allowed.
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.next', 'server', 'pages');
const DATA_TYPES = new Set(['application/json', 'application/ld+json']);

const pages = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.html')) pages.push(full);
  }
};
if (!fs.existsSync(root)) {
  console.error(`check-inline-scripts: ${root} not found; run next build first`);
  process.exit(1);
}
walk(root);

const problems = [];
for (const file of pages) {
  const html = fs.readFileSync(file, 'utf8');
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs) || !m[2].trim()) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && DATA_TYPES.has(type)) continue;
    problems.push(`${path.relative(root, file)}: ${m[2].trim().slice(0, 80)}`);
  }
}

if (problems.length) {
  console.error('Inline scripts would be blocked by the CSP (script-src \'self\'):');
  for (const p of problems.slice(0, 10)) console.error('  ' + p);
  process.exit(1);
}
console.log(`check-inline-scripts: ${pages.length} prerendered pages, no executable inline scripts`);

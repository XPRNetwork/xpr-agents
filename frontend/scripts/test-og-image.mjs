// Sanity checks for src/lib/og-image.ts — the "first image for a job/service"
// resolver that feeds the dynamic OG cards.
//   node --import ./scripts/ts-loader.mjs scripts/test-og-image.mjs
// Add --live to also hit the public indexer for job 62/67 and service 0/2.
import assert from 'node:assert/strict';
import { firstImageUri, formatXpr, clamp, toGatewayUrl, jobOgItem, serviceOgItem } from '../src/lib/og-image.ts';

let pass = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); pass++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
};

// --- manifests -------------------------------------------------------------
const imageManifest = JSON.stringify({
  v: 1,
  files: [
    { name: 'badge.png', uri: 'https://ipfs.io/ipfs/QmBadge', type: 'image/png' },
    { name: 'metadata.json', uri: 'https://ipfs.io/ipfs/QmMeta', type: 'application/json' },
  ],
});
const docFirstManifest = JSON.stringify({
  v: 1,
  files: [
    { name: 'report.md', uri: 'https://agent.mypinata.cloud/ipfs/QmReport', type: 'text/markdown' },
    { name: 'chart.png', uri: 'https://agent.mypinata.cloud/ipfs/QmChart', type: 'image/png' },
  ],
});
const noImageManifest = JSON.stringify({
  v: 1,
  files: [
    { name: 'report.md', uri: 'https://agent.mypinata.cloud/ipfs/QmReport', type: 'text/markdown' },
    { name: 'metrics.json', uri: 'https://agent.mypinata.cloud/ipfs/QmMetrics', type: 'application/json' },
  ],
});
const ipfsSchemeManifest = JSON.stringify({
  v: 1,
  files: [{ name: 'art.png', uri: 'ipfs://QmArt', type: 'image/png' }],
});

t('manifest: first image/* entry wins', () =>
  assert.equal(firstImageUri(imageManifest), 'https://ipfs.io/ipfs/QmBadge'));
t('manifest: skips documents to reach the image', () =>
  assert.equal(firstImageUri(docFirstManifest), 'https://agent.mypinata.cloud/ipfs/QmChart'));
t('manifest: no image -> null (job 67 shape)', () =>
  assert.equal(firstImageUri(noImageManifest), null));
t('manifest: ipfs:// is rewritten to the gateway', () =>
  assert.match(firstImageUri(ipfsSchemeManifest), /\/ipfs\/QmArt$/));
t('manifest: untyped entry falls back to extension sniffing', () =>
  assert.equal(
    firstImageUri(JSON.stringify({ v: 1, files: [{ name: 'a', uri: 'https://x.test/a.webp' }] })),
    'https://x.test/a.webp',
  ));

// --- plain / list / data URIs ---------------------------------------------
t('plain image URL', () =>
  assert.equal(firstImageUri('https://x.test/shot.jpg'), 'https://x.test/shot.jpg'));
t('bare ipfs gateway URL is treated as an image candidate (job 65 shape)', () =>
  assert.equal(
    firstImageUri('https://ipfs.io/ipfs/QmWoESiGteKHfAxkeMdAoP3PEstaRFifEdsZuzDQLEQGxF'),
    'https://ipfs.io/ipfs/QmWoESiGteKHfAxkeMdAoP3PEstaRFifEdsZuzDQLEQGxF',
  ));
t('comma-separated list picks the first image, not the first PDF (job 66 shape)', () =>
  assert.equal(
    firstImageUri('https://x.test/deck.pdf,https://x.test/cover.png'),
    'https://x.test/cover.png',
  ));
t('ipfs:// scheme outside a manifest', () =>
  assert.match(firstImageUri('ipfs://QmZ'), /\/ipfs\/QmZ$/));
t('data:image URI passes through whole (commas and all)', () =>
  assert.equal(firstImageUri('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA'));
t('data: non-image -> null', () =>
  assert.equal(firstImageUri('data:application/pdf;base64,AAAA'), null));

// --- nothing usable --------------------------------------------------------
t('empty / null -> null', () => {
  assert.equal(firstImageUri(''), null);
  assert.equal(firstImageUri(null), null);
  assert.equal(firstImageUri(undefined), null);
});
t('NFT deliverable payload -> null', () =>
  assert.equal(firstImageUri('{"type":"nft","asset_ids":["12345"]}'), null));
t('non-image URL -> null', () =>
  assert.equal(firstImageUri('https://github.com/charliebot87/xpr-account-trust-cli'), null));
t('http:// image -> resolved here, rejected later by the https-only fetch', () =>
  assert.equal(firstImageUri('http://x.test/a.png'), 'http://x.test/a.png'));

// --- formatting ------------------------------------------------------------
t('formatXpr', () => {
  assert.equal(formatXpr(250000), '25 XPR');
  assert.equal(formatXpr('2500000'), '250 XPR');
  assert.equal(formatXpr(12500), '1.25 XPR');
  assert.equal(formatXpr(0), '0 XPR');
});
t('clamp adds an ellipsis only when it cuts', () => {
  assert.equal(clamp('short', 20), 'short');
  assert.equal(clamp('a'.repeat(30), 10).length, 10);
  assert.equal(clamp('  spaced   out  ', 20), 'spaced out');
});
t('toGatewayUrl leaves https alone', () =>
  assert.equal(toGatewayUrl('https://x.test/a.png'), 'https://x.test/a.png'));

console.log(`\n${pass} checks passed`);

if (process.argv.includes('--live')) {
  console.log('\nlive lookups (public indexer):');
  for (const id of [62, 67]) console.log(' job', id, await jobOgItem(id));
  for (const id of [0, 2]) console.log(' service', id, await serviceOgItem(id));
}

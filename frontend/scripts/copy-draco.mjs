/**
 * Copy the Draco glTF decoder that ships with three.js into public/draco/.
 *
 * DRACOLoader fetches these at runtime (only when a Draco-compressed GLB is opened),
 * so they must be served from our own origin rather than a third-party CDN.
 * Runs from `predev` / `prebuild`; the files are gitignored.
 */
import { cp, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf');
const target = join(root, 'public', 'draco');

const FILES = ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'];

try {
  await access(source);
} catch {
  console.warn('[copy-draco] three.js draco decoder not found — skipping (compressed GLBs will not load)');
  process.exit(0);
}

await mkdir(target, { recursive: true });
for (const file of FILES) {
  await cp(join(source, file), join(target, file));
}
console.log(`[copy-draco] copied ${FILES.length} decoder files to public/draco`);

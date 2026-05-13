#!/usr/bin/env node
/**
 * Build each skill's src/index.ts → dist/index.js so the npm tarball ships
 * pre-compiled JS that loads on plain Node (no ts-node required at runtime).
 *
 * Skills are self-contained TS modules with locally-defined types. Each is
 * built in isolation with the same compiler options the Dockerfile uses, so
 * we don't introduce drift between the standalone and the harness deployment
 * paths. Notably we do NOT pass --strict here: skills do dynamic
 * `await import('@xpr-agents/openclaw')` for the signing helpers, which
 * resolves to `any` at compile time and would fail --strict null checks.
 */
import { readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = resolve(__dirname, '..', 'skills');

// Match the Dockerfile compile flags exactly — no --strict (see header).
const TSC_OPTS = [
  '--esModuleInterop',
  '--skipLibCheck',
  '--module', 'commonjs',
  '--target', 'ES2020',
  '--declaration', 'false',
];

function buildSkill(skillDir, name) {
  const srcEntry = join(skillDir, 'src', 'index.ts');
  if (!existsSync(srcEntry)) {
    // Some skills (e.g. xpr-agent-operator) are prompt-only — no TS to build.
    console.log(`[build-skills] ${name}: no src/index.ts — skipping`);
    return;
  }

  const distDir = join(skillDir, 'dist');
  if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });

  const args = [
    '--outDir', distDir,
    '--rootDir', join(skillDir, 'src'),
    srcEntry,
    ...TSC_OPTS,
  ];

  try {
    execFileSync('npx', ['tsc', ...args], { stdio: 'inherit' });
    console.log(`[build-skills] ${name}: built → ${distDir}`);
  } catch (err) {
    console.error(`[build-skills] ${name}: build FAILED`);
    throw err;
  }
}

const names = readdirSync(SKILLS_DIR)
  .filter((n) => statSync(join(SKILLS_DIR, n)).isDirectory())
  .sort();

console.log(`[build-skills] building ${names.length} skills under ${SKILLS_DIR}`);
for (const name of names) {
  buildSkill(join(SKILLS_DIR, name), name);
}
console.log('[build-skills] done');

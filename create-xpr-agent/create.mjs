#!/usr/bin/env node

import { cpSync, chmodSync, readdirSync, statSync } from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templateDir = join(__dirname, "template");

// ── Parse args ──────────────────────────────────

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
  Create an autonomous AI agent on XPR Network.

  Usage:
    npx create-xpr-agent [directory]

  Options:
    --help, -h    Show this help message

  Examples:
    npx create-xpr-agent my-agent
    npx create-xpr-agent .

  After creating:
    cd my-agent
    ./setup.sh
`);
  process.exit(0);
}

const dirName = args.find((a) => !a.startsWith("-")) || "xpr-agent";
const targetDir = resolve(process.cwd(), dirName);

// ── Copy template ───────────────────────────────

console.log(`\n  Creating XPR agent in ${targetDir}\n`);

try {
  cpSync(templateDir, targetDir, { recursive: true });
} catch (err) {
  if (err.code === "ERR_FS_CP_EEXIST" || err.code === "EEXIST") {
    console.error(`  Error: Directory "${dirName}" already exists.\n`);
  } else {
    console.error(`  Error: ${err.message}\n`);
  }
  process.exit(1);
}

// ── Make .sh files executable ───────────────────

function chmodShFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      chmodShFiles(full);
    } else if (entry.endsWith(".sh")) {
      chmodSync(full, 0o755);
    }
  }
}

chmodShFiles(targetDir);

// ── Done ────────────────────────────────────────

console.log("  Done! Next steps:\n");
console.log(`    cd ${dirName}`);
console.log("    ./setup.sh\n");
console.log("  The setup wizard will guide you through configuration.");
console.log("  You'll need: XPR account name, private key, and Anthropic API key.\n");

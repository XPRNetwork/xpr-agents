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
    ./start.sh --account <name> --api-key <claude>
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
console.log(`    cd ${dirName}\n`);
console.log("  One-time: load your blockchain key into the proton CLI keychain");
console.log("  (skip if you've already done this on this host):\n");
console.log("    npm i -g @proton/cli");
console.log("    proton chain:set proton              # or proton-test");
console.log("    proton key:add                       # paste PVT_K1_yourkey");
console.log("    # On a hosted console without a real TTY:");
console.log("    #   echo \"no\" | proton key:add PVT_K1_yourkey\n");
console.log("  Start the agent:\n");
console.log("    ./start.sh --account YOUR_ACCOUNT --api-key YOUR_CLAUDE_KEY\n");
console.log("  The agent process NEVER reads your blockchain key — every signed");
console.log("  transaction shells out to the proton CLI's encrypted keychain.\n");
console.log("  You'll need: XPR account name + Anthropic API key (no private key flag).\n");

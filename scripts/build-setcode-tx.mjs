#!/usr/bin/env node
/**
 * Build a {actions:[eosio::setcode, eosio::setabi]} transaction JSON for a contract
 * so it can be pushed with `proton transaction:push "$(cat tx.json)"` (no TTY prompts)
 * or wrapped in an msig proposal.
 *
 * Usage:
 *   node scripts/build-setcode-tx.mjs <account> <target-dir> [permission] > tx.json
 *
 * <target-dir> must contain <name>.wasm and <name>.abi (proton-tsc build output,
 * e.g. contracts/agentescrow/assembly/target).
 *
 * Uses the @proton/js bundled with the globally installed proton CLI so no extra
 * dependency is needed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const [account, targetDir, permission = 'active'] = process.argv.slice(2);
if (!account || !targetDir) {
  console.error('usage: build-setcode-tx.mjs <account> <target-dir> [permission]');
  process.exit(1);
}

const globalRoot = execSync('npm root -g').toString().trim();
const require = createRequire(path.join(globalRoot, '@proton/cli/package.json'));
const { Api, JsonRpc, Serialize } = require('@proton/js');

const files = fs.readdirSync(targetDir);
const wasmFile = files.find((f) => f.endsWith('.wasm'));
const abiFile = files.find((f) => f.endsWith('.abi'));
if (!wasmFile || !abiFile) {
  console.error(`no .wasm/.abi in ${targetDir}`);
  process.exit(1);
}

const api = new Api({ rpc: new JsonRpc(['https://testnet.protonchain.com']) });
const abiJson = JSON.parse(fs.readFileSync(path.join(targetDir, abiFile), 'utf8'));
const abiHex = Serialize.arrayToHex(api.jsonToRawAbi(abiJson));
const wasmHex = fs.readFileSync(path.join(targetDir, wasmFile)).toString('hex');

const authorization = [{ actor: account, permission }];
const tx = {
  actions: [
    {
      account: 'eosio',
      name: 'setcode',
      authorization,
      data: { account, vmtype: 0, vmversion: 0, code: wasmHex },
    },
    {
      account: 'eosio',
      name: 'setabi',
      authorization,
      data: { account, abi: abiHex },
    },
  ],
};
process.stdout.write(JSON.stringify(tx));
console.error(`${account}: ${wasmFile} ${(wasmHex.length / 2 / 1024).toFixed(1)} KB, abi ${(abiHex.length / 2 / 1024).toFixed(1)} KB`);

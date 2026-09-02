#!/usr/bin/env node
/**
 * Build an `eosio.msig::propose` transaction that deploys one or more contracts
 * (eosio::setcode + eosio::setabi per contract). Output is JSON for
 * `proton transaction:push "$(cat propose.json)"`, signed by the proposer's key
 * in the proton CLI keychain — no private keys touch this script.
 *
 * Usage:
 *   node scripts/build-msig-setcode.mjs \
 *     --proposer agentsetup --name deploypr39 --requested protonnz@active \
 *     --expire-days 30 --rpc https://proton.eosusa.io \
 *     agentescrow=contracts/agentescrow/assembly/target \
 *     agentfeed=contracts/agentfeed/assembly/target > propose.json
 *
 * Each contract's setcode/setabi is authorized by <contract>@active, which is
 * why the approval is requested from the account that controls those permissions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const proposer = opt('proposer', 'agentsetup');
const proposalName = opt('name');
const requested = opt('requested', 'protonnz@active').split(',').map((s) => {
  const [actor, permission = 'active'] = s.split('@');
  return { actor, permission };
});
const expireDays = Number(opt('expire-days', '30'));
const rpcUrl = opt('rpc', 'https://proton.eosusa.io');
const contracts = args.filter((a) => a.includes('=') && !a.startsWith('--')).map((a) => {
  const [account, dir] = a.split('=');
  return { account, dir };
});
if (!proposalName || contracts.length === 0) {
  console.error('usage: --name <proposal> [--proposer a] [--requested a@p,...] [--expire-days n] [--rpc url] <account>=<target-dir> ...');
  process.exit(1);
}

const globalRoot = execSync('npm root -g').toString().trim();
const require = createRequire(path.join(globalRoot, '@proton/cli/package.json'));
const { Api, JsonRpc, Serialize } = require('@proton/js');

const rpc = new JsonRpc([rpcUrl]);
const api = new Api({ rpc });

const actions = [];
for (const { account, dir } of contracts) {
  const files = fs.readdirSync(dir);
  const wasmFile = files.find((f) => f.endsWith('.wasm'));
  const abiFile = files.find((f) => f.endsWith('.abi'));
  if (!wasmFile || !abiFile) throw new Error(`no .wasm/.abi in ${dir}`);
  const abiJson = JSON.parse(fs.readFileSync(path.join(dir, abiFile), 'utf8'));
  const abiHex = Serialize.arrayToHex(api.jsonToRawAbi(abiJson));
  const wasmHex = fs.readFileSync(path.join(dir, wasmFile)).toString('hex');
  const authorization = [{ actor: account, permission: 'active' }];
  actions.push(
    { account: 'eosio', name: 'setcode', authorization, data: { account, vmtype: 0, vmversion: 0, code: wasmHex } },
    { account: 'eosio', name: 'setabi', authorization, data: { account, abi: abiHex } },
  );
  console.error(`${account}: ${wasmFile} ${(wasmHex.length / 2 / 1024).toFixed(1)} KB`);
}

// Serialize the inner actions' data to hex using the eosio ABI from chain
const serialized = await api.serializeActions(actions);
const expiration = new Date(Date.now() + expireDays * 86400 * 1000).toISOString().slice(0, 19);

const trx = {
  expiration,
  ref_block_num: 0,
  ref_block_prefix: 0,
  max_net_usage_words: 0,
  max_cpu_usage_ms: 0,
  delay_sec: 0,
  context_free_actions: [],
  actions: serialized.map((a) => ({ account: a.account, name: a.name, authorization: a.authorization, data: a.data })),
  transaction_extensions: [],
};

const tx = {
  actions: [
    {
      account: 'eosio.msig',
      name: 'propose',
      authorization: [{ actor: proposer, permission: 'active' }],
      data: { proposer, proposal_name: proposalName, requested, trx },
    },
  ],
};
process.stdout.write(JSON.stringify(tx));
console.error(`proposal ${proposer}/${proposalName}: ${actions.length} actions, expires ${expiration}Z, approve at https://explorer.xprnetwork.org/msig/${proposer}/${proposalName}`);

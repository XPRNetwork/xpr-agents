#!/usr/bin/env node
/**
 * Build an `eosio.msig::propose` transaction wrapping arbitrary contract actions,
 * for owner-only operations (removeagent, arbitrate, setsvcconfig …) that need the
 * protonnz key. Output is JSON for `proton transaction:push "$(cat propose.json)"`,
 * signed by the proposer's key in the proton CLI keychain — no private keys here.
 *
 * Usage:
 *   node scripts/build-msig-actions.mjs --name rmjedediq --proposer paul123 \
 *     --requested protonnz@active --expire-days 7 actions.json > propose.json
 *
 * actions.json: [{ "account": "agentcore", "name": "removeagent",
 *                  "authorization": [{ "actor": "protonnz", "permission": "active" }],
 *                  "data": { "agent": "jedediq" } }, ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const proposer = opt('proposer', 'paul123');
const proposalName = opt('name');
const requested = opt('requested', 'protonnz@active').split(',').map((s) => {
  const [actor, permission = 'active'] = s.split('@'); return { actor, permission };
});
const expireDays = Number(opt('expire-days', '7'));
const rpcUrl = opt('rpc', 'https://proton.eosusa.io');
const file = args.find((a) => a.endsWith('.json') && !a.startsWith('--'));
if (!proposalName || !file) {
  console.error('usage: --name <proposal> [--proposer a] [--requested a@p,...] [--expire-days n] [--rpc url] actions.json');
  process.exit(1);
}
const actions = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(actions) || actions.length === 0) throw new Error('actions.json must be a non-empty array');
for (const a of actions) {
  if (!a.account || !a.name || !Array.isArray(a.authorization) || typeof a.data !== 'object') {
    throw new Error(`bad action: ${JSON.stringify(a).slice(0, 120)}`);
  }
}

const globalRoot = execSync('npm root -g').toString().trim();
const require = createRequire(path.join(globalRoot, '@proton/cli/package.json'));
const { Api, JsonRpc } = require('@proton/js');
const api = new Api({ rpc: new JsonRpc([rpcUrl]) });

// @proton/js logs 'get abi for <account>' to stdout while fetching ABIs; keep stdout JSON-only
const realLog = console.log; console.log = () => {};
const serialized = await api.serializeActions(actions);
console.log = realLog;

const expiration = new Date(Date.now() + expireDays * 86400 * 1000).toISOString().slice(0, 19);
const trx = {
  expiration, ref_block_num: 0, ref_block_prefix: 0, max_net_usage_words: 0, max_cpu_usage_ms: 0,
  delay_sec: 0, context_free_actions: [],
  actions: serialized.map((a) => ({ account: a.account, name: a.name, authorization: a.authorization, data: a.data })),
  transaction_extensions: [],
};
const tx = { actions: [{ account: 'eosio.msig', name: 'propose',
  authorization: [{ actor: proposer, permission: 'active' }],
  data: { proposer, proposal_name: proposalName, requested, trx } }] };
process.stdout.write(JSON.stringify(tx));
console.error(`proposal ${proposer}/${proposalName}: ${actions.length} action(s) — ${actions.map((a) => `${a.account}::${a.name}`).join(', ')}; expires ${expiration}Z`);
console.error(`approve at https://explorer.xprnetwork.org/msig/${proposer}/${proposalName}`);

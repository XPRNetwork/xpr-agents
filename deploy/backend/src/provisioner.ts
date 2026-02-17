/**
 * Agent Provisioner
 *
 * Orchestrates the full agent deployment flow:
 * 1. Generate keypair for the new agent
 * 2. Create XPR account on-chain
 * 3. Register agent on agentcore
 * 4. Approve claim for the human owner
 * 5. Deploy Moltworker to Cloudflare
 * 6. Update agent endpoint
 */

import { Api, JsonRpc, JsSignatureProvider, Key } from '@proton/js';
import crypto from 'crypto';
import { encrypt } from './crypto';
import { deployWorker, type WorkerSecrets } from './cloudflare';
import { db } from './db';

// Use elliptic for key generation (proton/js doesn't expose generate)
let EC: any;
try { EC = require('elliptic').ec; } catch { /* loaded below */ }

function getRpc(): JsonRpc {
  const endpoint = process.env.XPR_RPC_ENDPOINT;
  if (!endpoint) throw new Error('XPR_RPC_ENDPOINT not set');
  return new JsonRpc(endpoint);
}

function getDeployApi(): Api {
  const privateKey = process.env.DEPLOY_PRIVATE_KEY;
  if (!privateKey) throw new Error('DEPLOY_PRIVATE_KEY not set');
  return new Api({
    rpc: getRpc(),
    signatureProvider: new JsSignatureProvider([privateKey]),
  });
}

function getAgentApi(privateKeyWif: string): Api {
  return new Api({
    rpc: getRpc(),
    signatureProvider: new JsSignatureProvider([privateKeyWif]),
  });
}

/** Generate a new K1 keypair */
function generateKeyPair(): { privateKey: string; publicKey: string } {
  const ec = new (EC || require('elliptic').ec)('secp256k1');
  const kp = ec.genKeyPair();
  const pk = Key.PrivateKey.fromElliptic(kp, 0); // K1
  return {
    privateKey: pk.toString(),
    publicKey: pk.getPublicKey().toString(),
  };
}

export interface ProvisionRequest {
  owner: string;
  agentName: string;
  displayName: string;
  description: string;
  capabilities: string;
  plan: 'hosted' | 'selfhosted';
  anthropicApiKey: string;
  telegramToken?: string;
  discordToken?: string;
  slackToken?: string;
}

export interface ProvisionResult {
  success: boolean;
  agentAccount?: string;
  endpoint?: string;
  workerName?: string;
  claimPending?: boolean;
  error?: string;
  step?: string;
}

function isValidAccountName(name: string): boolean {
  if (name.length > 12 || name.length === 0) return false;
  return /^[a-z1-5.]+$/.test(name);
}

async function accountExists(name: string): Promise<boolean> {
  const rpc = getRpc();
  try {
    await rpc.get_account(name);
    return true;
  } catch {
    return false;
  }
}

export async function provisionAgent(req: ProvisionRequest): Promise<ProvisionResult> {
  const deployAccount = process.env.DEPLOY_ACCOUNT || 'agentdeploy';
  const coreContract = process.env.CORE_CONTRACT || 'agentcore';
  const network = process.env.XPR_NETWORK || 'testnet';
  const rpcEndpoint = process.env.XPR_RPC_ENDPOINT!;

  if (!isValidAccountName(req.agentName)) {
    return { success: false, error: 'Invalid account name. Use a-z, 1-5, max 12 chars.', step: 'validate' };
  }

  if (await accountExists(req.agentName)) {
    return { success: false, error: 'Account name already taken', step: 'validate' };
  }

  if (!req.anthropicApiKey || !req.anthropicApiKey.startsWith('sk-')) {
    return { success: false, error: 'Invalid Anthropic API key', step: 'validate' };
  }

  // Step 1: Generate keypair
  console.log(`[provision] Step 1: Generating keypair for ${req.agentName}`);
  const { privateKey: agentPrivateKey, publicKey: agentPublicKey } = generateKeyPair();
  const encryptedKey = encrypt(agentPrivateKey);

  // Step 2: Create XPR account
  console.log(`[provision] Step 2: Creating account ${req.agentName}`);
  try {
    const api = getDeployApi();
    await api.transact({
      actions: [
        {
          account: 'eosio',
          name: 'newaccount',
          authorization: [{ actor: deployAccount, permission: 'active' }],
          data: {
            creator: deployAccount,
            name: req.agentName,
            owner: {
              threshold: 1,
              keys: [{ key: agentPublicKey, weight: 1 }],
              accounts: [
                { permission: { actor: req.owner, permission: 'active' }, weight: 1 },
              ],
              waits: [],
            },
            active: {
              threshold: 1,
              keys: [{ key: agentPublicKey, weight: 1 }],
              accounts: [],
              waits: [],
            },
          },
        },
        {
          account: 'eosio',
          name: 'buyrambytes',
          authorization: [{ actor: deployAccount, permission: 'active' }],
          data: {
            payer: deployAccount,
            receiver: req.agentName,
            bytes: 8192,
          },
        },
      ],
    }, { blocksBehind: 3, expireSeconds: 30 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create account: ${msg}`, step: 'create_account' };
  }

  // Step 3: Register free resources
  console.log(`[provision] Step 3: Registering free resources`);
  try {
    const api = getDeployApi();
    await api.transact({
      actions: [{
        account: 'eosio.proton',
        name: 'newaccres',
        authorization: [{ actor: deployAccount, permission: 'active' }],
        data: { account: req.agentName },
      }],
    }, { blocksBehind: 3, expireSeconds: 30 });
  } catch (err) {
    console.warn(`[provision] Warning: newaccres failed: ${err}`);
  }

  // Step 4: Register agent on agentcore
  console.log(`[provision] Step 4: Registering agent on ${coreContract}`);
  try {
    const agentApi = getAgentApi(agentPrivateKey);
    await agentApi.transact({
      actions: [{
        account: coreContract,
        name: 'register',
        authorization: [{ actor: req.agentName, permission: 'active' }],
        data: {
          account: req.agentName,
          name: req.displayName,
          description: req.description,
          endpoint: '',
          protocol: 'https',
          capabilities: req.capabilities || '[]',
        },
      }],
    }, { blocksBehind: 3, expireSeconds: 30 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to register agent: ${msg}`, step: 'register_agent' };
  }

  // Step 5: Approve claim for the human owner
  console.log(`[provision] Step 5: Approving claim for ${req.owner}`);
  try {
    const agentApi = getAgentApi(agentPrivateKey);
    await agentApi.transact({
      actions: [{
        account: coreContract,
        name: 'approveclaim',
        authorization: [{ actor: req.agentName, permission: 'active' }],
        data: {
          agent: req.agentName,
          claimant: req.owner,
        },
      }],
    }, { blocksBehind: 3, expireSeconds: 30 });
  } catch (err) {
    console.warn(`[provision] Warning: approveclaim failed: ${err}`);
  }

  // Step 6: Deploy to Cloudflare
  const workerName = `xpr-agent-${req.agentName.replace(/\./g, '-')}`;
  console.log(`[provision] Step 6: Deploying worker ${workerName}`);

  const hookToken = crypto.randomBytes(32).toString('hex');

  const secrets: WorkerSecrets = {
    XPR_ACCOUNT: req.agentName,
    XPR_PRIVATE_KEY: agentPrivateKey,
    XPR_NETWORK: network,
    XPR_RPC_ENDPOINT: rpcEndpoint,
    ANTHROPIC_API_KEY: req.anthropicApiKey,
    OPENCLAW_HOOK_TOKEN: hookToken,
  };

  if (req.telegramToken) secrets.TELEGRAM_BOT_TOKEN = req.telegramToken;
  if (req.discordToken) secrets.DISCORD_BOT_TOKEN = req.discordToken;
  if (req.slackToken) secrets.SLACK_BOT_TOKEN = req.slackToken;

  const deployResult = await deployWorker(workerName, secrets);

  if (!deployResult.success) {
    return {
      success: false,
      error: `Cloudflare deploy failed: ${deployResult.error}`,
      step: 'deploy_worker',
      agentAccount: req.agentName,
    };
  }

  // Step 7: Update agent endpoint on-chain
  console.log(`[provision] Step 7: Updating agent endpoint`);
  try {
    const agentApi = getAgentApi(agentPrivateKey);
    await agentApi.transact({
      actions: [{
        account: coreContract,
        name: 'update',
        authorization: [{ actor: req.agentName, permission: 'active' }],
        data: {
          account: req.agentName,
          name: req.displayName,
          description: req.description,
          endpoint: deployResult.url,
          protocol: 'https',
          capabilities: req.capabilities || '[]',
        },
      }],
    }, { blocksBehind: 3, expireSeconds: 30 });
  } catch (err) {
    console.warn(`[provision] Warning: endpoint update failed: ${err}`);
  }

  // Step 8: Save to local DB
  db.prepare(`
    INSERT INTO deployments (agent_account, owner, worker_name, endpoint, encrypted_key, plan, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', datetime('now'))
  `).run(
    req.agentName,
    req.owner,
    workerName,
    deployResult.url,
    encryptedKey,
    req.plan,
  );

  console.log(`[provision] Agent ${req.agentName} fully provisioned at ${deployResult.url}`);

  return {
    success: true,
    agentAccount: req.agentName,
    endpoint: deployResult.url,
    workerName,
    claimPending: true,
  };
}

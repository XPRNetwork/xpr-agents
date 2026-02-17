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

import { Api, JsonRpc, Key, Serialize } from '@proton/js';
import { encrypt } from './crypto';
import { deployWorker, type WorkerSecrets } from './cloudflare';
import { db } from './db';

// RPC setup
function getRpc(): JsonRpc {
  const endpoint = process.env.XPR_RPC_ENDPOINT;
  if (!endpoint) throw new Error('XPR_RPC_ENDPOINT not set');
  return new JsonRpc(endpoint);
}

function getApi(): Api {
  const rpc = getRpc();
  const privateKey = process.env.DEPLOY_PRIVATE_KEY;
  if (!privateKey) throw new Error('DEPLOY_PRIVATE_KEY not set');

  return new Api({
    rpc,
    signatureProvider: {
      getAvailableKeys: async () => {
        const pub = Key.PrivateKey.fromString(privateKey).getPublicKey().toString();
        return [pub];
      },
      sign: async (args: any) => {
        const pk = Key.PrivateKey.fromString(privateKey);
        const signatures = args.serializedTransaction
          ? [pk.sign(
              Buffer.concat([
                Buffer.from(args.chainId, 'hex'),
                Buffer.from(args.serializedTransaction),
                Buffer.alloc(32),
              ])
            ).toString()]
          : [];
        return { signatures, serializedTransaction: args.serializedTransaction };
      },
    },
  });
}

export interface ProvisionRequest {
  owner: string;        // Human account (wallet-connected)
  agentName: string;    // Desired agent account name (12 chars)
  displayName: string;  // Human-readable display name
  description: string;  // Agent description
  capabilities: string; // JSON array of capabilities
  plan: 'hosted' | 'selfhosted';
  anthropicApiKey: string;   // User's own Anthropic API key
  telegramToken?: string;    // Optional Telegram bot token
  discordToken?: string;     // Optional Discord bot token
  slackToken?: string;       // Optional Slack bot token
}

export interface ProvisionResult {
  success: boolean;
  agentAccount?: string;
  endpoint?: string;
  workerName?: string;
  claimPending?: boolean;
  error?: string;
  step?: string;       // Which step failed
}

/**
 * Validate that an account name is valid for EOSIO (12 chars, a-z, 1-5, .)
 */
function isValidAccountName(name: string): boolean {
  if (name.length > 12 || name.length === 0) return false;
  return /^[a-z1-5.]+$/.test(name);
}

/**
 * Check if an account already exists on-chain
 */
async function accountExists(name: string): Promise<boolean> {
  const rpc = getRpc();
  try {
    await rpc.get_account(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Full provisioning flow
 */
export async function provisionAgent(req: ProvisionRequest): Promise<ProvisionResult> {
  const deployAccount = process.env.DEPLOY_ACCOUNT || 'agentdeploy';
  const coreContract = process.env.CORE_CONTRACT || 'agentcore';
  const network = process.env.XPR_NETWORK || 'testnet';
  const rpcEndpoint = process.env.XPR_RPC_ENDPOINT!;

  // Validate inputs
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
  const privateKey = Key.PrivateKey.generate('K1');
  const publicKey = privateKey.getPublicKey().toString();
  const encryptedKey = encrypt(privateKey.toString());

  // Step 2: Create XPR account
  console.log(`[provision] Step 2: Creating account ${req.agentName}`);
  try {
    const api = getApi();

    await api.transact({
      actions: [
        // newaccount
        {
          account: 'eosio',
          name: 'newaccount',
          authorization: [{ actor: deployAccount, permission: 'active' }],
          data: {
            creator: deployAccount,
            name: req.agentName,
            owner: {
              threshold: 1,
              keys: [{ key: publicKey, weight: 1 }],
              accounts: [
                // Give the human owner permission too
                { permission: { actor: req.owner, permission: 'active' }, weight: 1 },
              ],
              waits: [],
            },
            active: {
              threshold: 1,
              keys: [{ key: publicKey, weight: 1 }],
              accounts: [],
              waits: [],
            },
          },
        },
        // buyrambytes
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
    }, {
      blocksBehind: 3,
      expireSeconds: 30,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create account: ${msg}`, step: 'create_account' };
  }

  // Step 3: Register free resources
  console.log(`[provision] Step 3: Registering free resources`);
  try {
    const api = getApi();
    await api.transact({
      actions: [{
        account: 'eosio.proton',
        name: 'newaccres',
        authorization: [{ actor: deployAccount, permission: 'active' }],
        data: { account: req.agentName },
      }],
    }, { blocksBehind: 3, expireSeconds: 30 });
  } catch (err) {
    // Non-fatal — account still works, just without free resources
    console.warn(`[provision] Warning: newaccres failed: ${err}`);
  }

  // Step 4: Register agent on agentcore
  console.log(`[provision] Step 4: Registering agent on ${coreContract}`);
  try {
    const api = getApi();

    // The deploy account needs permission on agentcore to register on behalf
    // For now, we register using the agent's own key
    // This requires a separate API instance with the agent's key
    const agentApi = new Api({
      rpc: getRpc(),
      signatureProvider: {
        getAvailableKeys: async () => [publicKey],
        sign: async (args: any) => {
          const signatures = args.serializedTransaction
            ? [privateKey.sign(
                Buffer.concat([
                  Buffer.from(args.chainId, 'hex'),
                  Buffer.from(args.serializedTransaction),
                  Buffer.alloc(32),
                ])
              ).toString()]
            : [];
          return { signatures, serializedTransaction: args.serializedTransaction };
        },
      },
    });

    await agentApi.transact({
      actions: [{
        account: coreContract,
        name: 'register',
        authorization: [{ actor: req.agentName, permission: 'active' }],
        data: {
          account: req.agentName,
          name: req.displayName,
          description: req.description,
          endpoint: '', // Set after worker deploys
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
    const agentApi = new Api({
      rpc: getRpc(),
      signatureProvider: {
        getAvailableKeys: async () => [publicKey],
        sign: async (args: any) => {
          const signatures = args.serializedTransaction
            ? [privateKey.sign(
                Buffer.concat([
                  Buffer.from(args.chainId, 'hex'),
                  Buffer.from(args.serializedTransaction),
                  Buffer.alloc(32),
                ])
              ).toString()]
            : [];
          return { signatures, serializedTransaction: args.serializedTransaction };
        },
      },
    });

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
    // Non-fatal — owner can claim later
  }

  // Step 6: Deploy to Cloudflare
  const workerName = `xpr-agent-${req.agentName.replace(/\./g, '-')}`;
  console.log(`[provision] Step 6: Deploying worker ${workerName}`);

  // Generate a webhook token for the indexer
  const hookToken = require('crypto').randomBytes(32).toString('hex');

  const secrets: WorkerSecrets = {
    XPR_ACCOUNT: req.agentName,
    XPR_PRIVATE_KEY: privateKey.toString(),
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
    const agentApi = new Api({
      rpc: getRpc(),
      signatureProvider: {
        getAvailableKeys: async () => [publicKey],
        sign: async (args: any) => {
          const signatures = args.serializedTransaction
            ? [privateKey.sign(
                Buffer.concat([
                  Buffer.from(args.chainId, 'hex'),
                  Buffer.from(args.serializedTransaction),
                  Buffer.alloc(32),
                ])
              ).toString()]
            : [];
          return { signatures, serializedTransaction: args.serializedTransaction };
        },
      },
    });

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

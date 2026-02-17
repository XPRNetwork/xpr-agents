import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { provisionAgent, type ProvisionRequest } from './provisioner';
import {
  getDeployment,
  getDeploymentsByOwner,
  getOnChainSubscription,
  syncSubscriptions,
  cleanupExpired,
} from './subscription';
import { getWorkerStatus, createTailSession } from './cloudflare';
import { db } from './db';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3500');
const API_SECRET = process.env.API_SECRET;

// Auth middleware — verifies wallet signature or API secret
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const auth = req.headers.authorization;

  if (!auth) {
    res.status(401).json({ error: 'Authorization required' });
    return;
  }

  // For MVP: Bearer token auth (API_SECRET)
  // TODO: Add EOSIO signature verification for wallet-authenticated requests
  if (API_SECRET && auth === `Bearer ${API_SECRET}`) {
    next();
    return;
  }

  res.status(403).json({ error: 'Invalid authorization' });
}

// Admin auth — only API_SECRET
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const auth = req.headers.authorization;
  if (!API_SECRET || auth !== `Bearer ${API_SECRET}`) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

// ============== PUBLIC ENDPOINTS ==============

/**
 * Health check
 */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

/**
 * Check if an account name is available
 */
app.get('/api/check-name/:name', async (req, res) => {
  const { name } = req.params;

  if (!name || name.length > 12 || !/^[a-z1-5.]+$/.test(name)) {
    res.json({ available: false, reason: 'Invalid account name' });
    return;
  }

  try {
    const { JsonRpc } = await import('@proton/js');
    const rpc = new JsonRpc(process.env.XPR_RPC_ENDPOINT!);
    await rpc.get_account(name);
    res.json({ available: false, reason: 'Account already exists' });
  } catch {
    // Account doesn't exist = available
    res.json({ available: true });
  }
});

/**
 * Get pricing info
 */
app.get('/api/pricing', async (_req, res) => {
  try {
    const { JsonRpc } = await import('@proton/js');
    const rpc = new JsonRpc(process.env.XPR_RPC_ENDPOINT!);
    const deployContract = process.env.DEPLOY_CONTRACT || 'agentdeploy';

    const result = await rpc.get_table_rows({
      json: true,
      code: deployContract,
      scope: deployContract,
      table: 'prices',
      limit: 10,
    });

    const prices = (result.rows || []).filter((p: any) => p.active);
    res.json({ prices });
  } catch (err) {
    // Fallback pricing if contract not deployed yet
    res.json({
      prices: [
        { token_symbol: 'XMD', amount: 150000, token_contract: 'xmd.token', display: '15.0000 XMD' },
        { token_symbol: 'XUSDC', amount: 150000, token_contract: 'xtokens', display: '15.0000 XUSDC' },
      ],
    });
  }
});

// ============== AUTHENTICATED ENDPOINTS ==============

/**
 * Deploy a new agent
 */
app.post('/api/deploy', requireAuth, async (req, res) => {
  const body = req.body as ProvisionRequest;

  if (!body.owner || !body.agentName || !body.displayName || !body.anthropicApiKey) {
    res.status(400).json({ error: 'Missing required fields: owner, agentName, displayName, anthropicApiKey' });
    return;
  }

  // Check if agent already deployed
  const existing = getDeployment(body.agentName);
  if (existing && existing.status !== 'cancelled') {
    res.status(409).json({ error: 'Agent already deployed', deployment: existing });
    return;
  }

  console.log(`[api] Deploy request from ${body.owner} for agent ${body.agentName}`);

  const result = await provisionAgent(body);

  if (result.success) {
    res.json(result);
  } else {
    res.status(500).json(result);
  }
});

/**
 * Get deployment status for a specific agent
 */
app.get('/api/status/:agent', requireAuth, async (req, res) => {
  const { agent } = req.params;
  const deployment = getDeployment(agent);

  if (!deployment) {
    res.status(404).json({ error: 'Deployment not found' });
    return;
  }

  // Enrich with on-chain subscription data
  const subscription = await getOnChainSubscription(agent);

  // Get Cloudflare worker status
  let workerStatus = null;
  try {
    workerStatus = await getWorkerStatus(deployment.worker_name);
  } catch {
    // Non-critical
  }

  res.json({
    deployment: {
      agent_account: deployment.agent_account,
      owner: deployment.owner,
      endpoint: deployment.endpoint,
      plan: deployment.plan,
      status: deployment.status,
      created_at: deployment.created_at,
    },
    subscription: subscription ? {
      paid_until: subscription.paid_until,
      state: subscription.state,
      token_symbol: subscription.token_symbol,
      total_paid: subscription.total_paid,
    } : null,
    worker: workerStatus ? {
      modified_on: workerStatus.modified_on,
    } : null,
  });
});

/**
 * List all deployments for the authenticated owner
 */
app.get('/api/deployments', requireAuth, async (req, res) => {
  const owner = req.query.owner as string;
  if (!owner) {
    res.status(400).json({ error: 'owner query parameter required' });
    return;
  }

  const deployments = getDeploymentsByOwner(owner);
  res.json({ deployments });
});

/**
 * Get agent logs (proxy to Cloudflare tail)
 */
app.get('/api/logs/:agent', requireAuth, async (req, res) => {
  const { agent } = req.params;
  const deployment = getDeployment(agent);

  if (!deployment) {
    res.status(404).json({ error: 'Deployment not found' });
    return;
  }

  const tail = await createTailSession(deployment.worker_name);
  if (!tail) {
    res.status(503).json({ error: 'Unable to create log session' });
    return;
  }

  res.json({ tail_url: tail.url });
});

// ============== ADMIN ENDPOINTS ==============

/**
 * Manually pause a deployment
 */
app.post('/api/admin/pause/:agent', requireAdmin, async (req, res) => {
  const { agent } = req.params;
  const deployment = getDeployment(agent);

  if (!deployment) {
    res.status(404).json({ error: 'Deployment not found' });
    return;
  }

  db.prepare("UPDATE deployments SET status = 'paused', updated_at = datetime('now') WHERE agent_account = ?")
    .run(agent);

  res.json({ success: true, message: `${agent} paused` });
});

/**
 * Manually resume a deployment
 */
app.post('/api/admin/resume/:agent', requireAdmin, async (req, res) => {
  const { agent } = req.params;
  const deployment = getDeployment(agent);

  if (!deployment) {
    res.status(404).json({ error: 'Deployment not found' });
    return;
  }

  db.prepare("UPDATE deployments SET status = 'active', updated_at = datetime('now') WHERE agent_account = ?")
    .run(agent);

  res.json({ success: true, message: `${agent} resumed` });
});

/**
 * Trigger subscription sync (normally runs on cron)
 */
app.post('/api/admin/sync', requireAdmin, async (_req, res) => {
  const result = await syncSubscriptions();
  res.json(result);
});

/**
 * Trigger cleanup of expired deployments
 */
app.post('/api/admin/cleanup', requireAdmin, async (_req, res) => {
  const cleaned = await cleanupExpired();
  res.json({ cleaned });
});

// ============== WEBHOOK ENDPOINT ==============

/**
 * Receives payment notifications from the indexer.
 * When a payment is detected for sub:{agent}, update local state.
 */
app.post('/api/webhook', async (req, res) => {
  const { action, data } = req.body;

  if (action === 'transfer' && data?.memo?.startsWith('sub:')) {
    const agentName = data.memo.substring(4);
    console.log(`[webhook] Payment received for ${agentName}`);

    // Sync this specific subscription
    const sub = await getOnChainSubscription(agentName);
    if (sub && sub.state === 0) {
      const deployment = getDeployment(agentName);
      if (deployment && deployment.status === 'paused') {
        db.prepare("UPDATE deployments SET status = 'active', updated_at = datetime('now') WHERE agent_account = ?")
          .run(agentName);
        console.log(`[webhook] Reactivated ${agentName}`);
      }
    }
  }

  res.json({ ok: true });
});

// ============== CRON: Periodic subscription sync ==============

const SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour

setInterval(async () => {
  try {
    console.log('[cron] Running subscription sync...');
    const result = await syncSubscriptions();
    console.log(`[cron] Sync complete: ${JSON.stringify(result)}`);

    // Also run cleanup
    const cleaned = await cleanupExpired();
    if (cleaned > 0) {
      console.log(`[cron] Cleaned up ${cleaned} expired deployments`);
    }
  } catch (err) {
    console.error('[cron] Sync error:', err);
  }
}, SYNC_INTERVAL);

// ============== START ==============

app.listen(PORT, () => {
  console.log(`[deploy] XPR Agent Deploy Service running on port ${PORT}`);
  console.log(`[deploy] Network: ${process.env.XPR_NETWORK || 'testnet'}`);
});

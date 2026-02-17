/**
 * Subscription Manager
 *
 * Tracks payment status and manages pause/resume of agent instances.
 * Reads on-chain subscription state from agentdeploy contract and
 * syncs with Cloudflare worker status.
 */

import { JsonRpc } from '@proton/js';
import { deleteWorker, getWorkerStatus } from './cloudflare';
import { db } from './db';

const GRACE_PERIOD_SECONDS = 3 * 24 * 60 * 60;   // 3 days
const DATA_RETENTION_SECONDS = 30 * 24 * 60 * 60; // 30 days

interface OnChainSub {
  agent: string;
  owner: string;
  plan: string;
  token_contract: string;
  token_symbol: string;
  paid_until: number;
  state: number;
  cf_worker_name: string;
  total_paid: number;
  created_at: number;
  updated_at: number;
}

function getRpc(): JsonRpc {
  return new JsonRpc(process.env.XPR_RPC_ENDPOINT!);
}

/**
 * Fetch subscription from on-chain agentdeploy contract
 */
export async function getOnChainSubscription(agent: string): Promise<OnChainSub | null> {
  const rpc = getRpc();
  const deployContract = process.env.DEPLOY_CONTRACT || 'agentdeploy';

  try {
    const result = await rpc.get_table_rows({
      json: true,
      code: deployContract,
      scope: deployContract,
      table: 'subs',
      lower_bound: agent,
      upper_bound: agent,
      limit: 1,
    });

    if (!result.rows || result.rows.length === 0) return null;
    return result.rows[0] as OnChainSub;
  } catch {
    return null;
  }
}

/**
 * Get deployment info from local database
 */
export function getDeployment(agent: string) {
  return db.prepare('SELECT * FROM deployments WHERE agent_account = ?').get(agent) as any;
}

/**
 * Get all active deployments
 */
export function getActiveDeployments() {
  return db.prepare("SELECT * FROM deployments WHERE status = 'active'").all() as any[];
}

/**
 * Get all deployments for an owner
 */
export function getDeploymentsByOwner(owner: string) {
  return db.prepare('SELECT * FROM deployments WHERE owner = ?').all(owner) as any[];
}

/**
 * Sync subscription states with on-chain data.
 * Called periodically (e.g., every hour) by a cron job.
 */
export async function syncSubscriptions(): Promise<{
  checked: number;
  paused: number;
  flaggedForCleanup: number;
}> {
  const deployments = getActiveDeployments();
  let paused = 0;
  let flaggedForCleanup = 0;
  const now = Math.floor(Date.now() / 1000);

  for (const dep of deployments) {
    const sub = await getOnChainSubscription(dep.agent_account);
    if (!sub) continue;

    // State 2 = PAUSED on-chain
    if (sub.state === 2 && dep.status === 'active') {
      // Mark as paused locally
      db.prepare("UPDATE deployments SET status = 'paused', updated_at = datetime('now') WHERE agent_account = ?")
        .run(dep.agent_account);
      paused++;
      console.log(`[sync] Paused deployment for ${dep.agent_account}`);
    }

    // State 3 = CANCELLED
    if (sub.state === 3 && dep.status !== 'cancelled') {
      db.prepare("UPDATE deployments SET status = 'cancelled', updated_at = datetime('now') WHERE agent_account = ?")
        .run(dep.agent_account);
      console.log(`[sync] Cancelled deployment for ${dep.agent_account}`);
    }

    // Check for data retention expiry
    if (dep.status === 'paused' || dep.status === 'cancelled') {
      if (sub.paid_until + DATA_RETENTION_SECONDS < now) {
        db.prepare("UPDATE deployments SET status = 'cleanup', updated_at = datetime('now') WHERE agent_account = ?")
          .run(dep.agent_account);
        flaggedForCleanup++;
        console.log(`[sync] Flagged ${dep.agent_account} for cleanup`);
      }
    }

    // Re-activate if subscription was renewed
    if (sub.state === 0 && dep.status === 'paused') {
      db.prepare("UPDATE deployments SET status = 'active', updated_at = datetime('now') WHERE agent_account = ?")
        .run(dep.agent_account);
      console.log(`[sync] Reactivated deployment for ${dep.agent_account}`);
    }
  }

  return { checked: deployments.length, paused, flaggedForCleanup };
}

/**
 * Clean up expired deployments (delete Cloudflare workers)
 */
export async function cleanupExpired(): Promise<number> {
  const flagged = db.prepare("SELECT * FROM deployments WHERE status = 'cleanup'").all() as any[];
  let cleaned = 0;

  for (const dep of flagged) {
    const deleted = await deleteWorker(dep.worker_name);
    if (deleted) {
      db.prepare("DELETE FROM deployments WHERE agent_account = ?").run(dep.agent_account);
      cleaned++;
      console.log(`[cleanup] Deleted worker for ${dep.agent_account}`);
    }
  }

  return cleaned;
}

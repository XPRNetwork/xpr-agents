/**
 * Cloudflare Workers API integration for deploying moltworker instances.
 *
 * Uses the Cloudflare REST API to:
 * - Create/update Workers
 * - Set secrets (env vars)
 * - Check worker status
 * - Disable/enable workers
 */

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

function getHeaders(): Record<string, string> {
  const token = process.env.CF_API_TOKEN;
  if (!token) throw new Error('CF_API_TOKEN not set');
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function getAccountId(): string {
  const id = process.env.CF_ACCOUNT_ID;
  if (!id) throw new Error('CF_ACCOUNT_ID not set');
  return id;
}

export interface WorkerSecrets {
  XPR_ACCOUNT: string;
  XPR_PRIVATE_KEY: string;
  XPR_NETWORK: string;
  XPR_RPC_ENDPOINT: string;
  ANTHROPIC_API_KEY: string;
  OPENCLAW_HOOK_TOKEN: string;
  INDEXER_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  DISCORD_BOT_TOKEN?: string;
  SLACK_BOT_TOKEN?: string;
  [key: string]: string | undefined;
}

export interface WorkerStatus {
  id: string;
  name: string;
  created_on: string;
  modified_on: string;
  usage_model: string;
}

/**
 * Deploy a moltworker-based Worker to Cloudflare.
 * In practice this would use wrangler CLI or the Workers upload API.
 * For MVP, we use the REST API to create a simple worker script.
 */
export async function deployWorker(
  workerName: string,
  secrets: WorkerSecrets
): Promise<{ success: boolean; url: string; error?: string }> {
  const accountId = getAccountId();

  try {
    // Step 1: Create/update the worker script
    // The moltworker template is deployed via wrangler — this sets secrets
    // For MVP, we assume the worker template is already deployed and we just set secrets

    // Step 2: Set all secrets
    for (const [key, value] of Object.entries(secrets)) {
      if (!value) continue;

      const res = await fetch(
        `${CF_API_BASE}/accounts/${accountId}/workers/scripts/${workerName}/secrets`,
        {
          method: 'PUT',
          headers: getHeaders(),
          body: JSON.stringify({ name: key, text: value, type: 'secret_text' }),
        }
      );

      if (!res.ok) {
        const body = await res.text();
        console.error(`[cf] Failed to set secret ${key}: ${body}`);
        return { success: false, url: '', error: `Failed to set secret ${key}` };
      }
    }

    const url = `https://${workerName}.${accountId}.workers.dev`;
    return { success: true, url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, url: '', error: msg };
  }
}

/**
 * Get worker status/metadata
 */
export async function getWorkerStatus(workerName: string): Promise<WorkerStatus | null> {
  const accountId = getAccountId();

  try {
    const res = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/workers/scripts/${workerName}`,
      { headers: getHeaders() }
    );

    if (!res.ok) return null;

    const data = await res.json() as any;
    return data.result || null;
  } catch {
    return null;
  }
}

/**
 * Delete a worker (for cleanup after cancellation + data retention)
 */
export async function deleteWorker(workerName: string): Promise<boolean> {
  const accountId = getAccountId();

  try {
    const res = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/workers/scripts/${workerName}`,
      { method: 'DELETE', headers: getHeaders() }
    );

    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Update a single secret on an existing worker
 */
export async function updateWorkerSecret(
  workerName: string,
  key: string,
  value: string
): Promise<boolean> {
  const accountId = getAccountId();

  try {
    const res = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/workers/scripts/${workerName}/secrets`,
      {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ name: key, text: value, type: 'secret_text' }),
      }
    );

    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get worker tail logs (for log viewer)
 */
export async function createTailSession(workerName: string): Promise<{ url: string } | null> {
  const accountId = getAccountId();

  try {
    const res = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/workers/scripts/${workerName}/tails`,
      { method: 'POST', headers: getHeaders() }
    );

    if (!res.ok) return null;

    const data = await res.json() as any;
    return { url: data.result?.url || '' };
  } catch {
    return null;
  }
}

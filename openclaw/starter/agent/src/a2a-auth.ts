/**
 * A2A server-side authentication, trust gating, and rate limiting.
 *
 * Verifies EOSIO signatures on incoming POST /a2a requests,
 * checks trust score / KYC level, and enforces per-account rate limits.
 */

import { recoverA2APublicKey, hashBody } from '@xpr-agents/sdk';
import { JsonRpc } from '@proton/js';

// ── Types ──────────────────────────────────────────────────────

export interface A2AAuthConfig {
  rpcEndpoint: string;
  authRequired: boolean;       // default true
  minTrustScore: number;       // default 0 (disabled)
  minKycLevel: number;         // default 0 (disabled)
  rateLimit: number;           // requests per minute, default 20
  timestampWindow: number;     // seconds, default 300 (5 min)
  agentcoreContract: string;   // default 'agentcore'
}

export interface A2AAuthResult {
  account: string;
  trustScore?: number;
}

export class A2AAuthError extends Error {
  constructor(
    message: string,
    public code: number = -32000,
  ) {
    super(message);
    this.name = 'A2AAuthError';
  }
}

// ── Caches ─────────────────────────────────────────────────────

interface KeyCacheEntry {
  keys: string[];
  expiresAt: number;
}

interface TrustCacheEntry {
  score: number;
  kycLevel: number;
  active: boolean;
  expiresAt: number;
}

const KEY_CACHE_TTL = 5 * 60 * 1000;   // 5 minutes
const TRUST_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const keyCache = new Map<string, KeyCacheEntry>();
const trustCache = new Map<string, TrustCacheEntry>();

// ── Rate Limiter ───────────────────────────────────────────────

const rateLimitMap = new Map<string, number[]>();

// Periodic cleanup every 60s
setInterval(() => {
  const now = Date.now();
  for (const [account, timestamps] of rateLimitMap) {
    const recent = timestamps.filter(t => now - t < 60_000);
    if (recent.length === 0) {
      rateLimitMap.delete(account);
    } else {
      rateLimitMap.set(account, recent);
    }
  }
}, 60_000).unref();

function checkRateLimit(account: string, limit: number): void {
  const now = Date.now();
  const timestamps = rateLimitMap.get(account) || [];
  const recent = timestamps.filter(t => now - t < 60_000);

  if (recent.length >= limit) {
    throw new A2AAuthError(
      `Rate limit exceeded: ${limit} requests per minute for account '${account}'`,
      -32000,
    );
  }

  recent.push(now);
  rateLimitMap.set(account, recent);
}

// ── Key Fetching ───────────────────────────────────────────────

async function getAccountKeys(rpc: JsonRpc, account: string): Promise<string[]> {
  const cached = keyCache.get(account);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.keys;
  }

  const accountInfo = await rpc.get_account(account);
  const activePermission = accountInfo.permissions?.find(
    (p: any) => p.perm_name === 'active',
  );

  if (!activePermission) {
    throw new A2AAuthError(`Account '${account}' has no active permission`, -32000);
  }

  const keys = activePermission.required_auth.keys.map((k: any) => k.key);

  if (keys.length === 0) {
    throw new A2AAuthError(`Account '${account}' has no active keys`, -32000);
  }

  keyCache.set(account, { keys, expiresAt: Date.now() + KEY_CACHE_TTL });
  return keys;
}

// ── Trust Fetching ─────────────────────────────────────────────

async function getAccountTrust(
  rpc: JsonRpc,
  account: string,
  agentcoreContract: string,
): Promise<TrustCacheEntry> {
  const cached = trustCache.get(account);
  if (cached && Date.now() < cached.expiresAt) {
    return cached;
  }

  // Fetch agent record
  const agentResult = await rpc.get_table_rows({
    json: true,
    code: agentcoreContract,
    scope: agentcoreContract,
    table: 'agents',
    lower_bound: account,
    upper_bound: account,
    limit: 1,
  });

  if (!agentResult.rows || agentResult.rows.length === 0) {
    throw new A2AAuthError(`Account '${account}' is not a registered agent`, -32000);
  }

  const agent = agentResult.rows[0] as any;
  const isActive = agent.active === true || agent.active === 1;

  // Fetch KYC level from eosio.proton
  let kycLevel = 0;
  try {
    const kycResult = await rpc.get_table_rows({
      json: true,
      code: 'eosio.proton',
      scope: 'eosio.proton',
      table: 'usersinfo',
      lower_bound: account,
      upper_bound: account,
      limit: 1,
    });
    if (kycResult.rows && kycResult.rows.length > 0) {
      const rawKyc = (kycResult.rows[0] as any).kyc;
      // kyc field is an array of provider-specific levels (e.g. [1, 2]), not a scalar
      if (Array.isArray(rawKyc)) {
        kycLevel = rawKyc.length > 0 ? Math.min(Math.max(...rawKyc), 3) : 0;
      } else {
        kycLevel = typeof rawKyc === 'number' ? rawKyc : 0;
      }
    }
  } catch {
    // KYC lookup failure is non-fatal; treat as level 0
  }

  // Compute a basic trust score (KYC * 10, max 30)
  // Full trust score requires stake + reputation + longevity, but for gating
  // we do a simplified check. The caller can also use the indexer/tools for
  // a full score if A2A_MIN_TRUST_SCORE is set > 0.
  const kycScore = Math.min(kycLevel * 10, 30);

  // Longevity score: 1 per month, max 10
  const registeredAt = Number(agent.registered_at || 0);
  const monthsActive = registeredAt > 0
    ? Math.floor((Date.now() / 1000 - registeredAt) / 2592000)
    : 0;
  const longevityScore = Math.min(monthsActive, 10);

  const score = kycScore + longevityScore; // Partial score (missing stake+reputation)

  const entry: TrustCacheEntry = {
    score,
    kycLevel,
    active: isActive,
    expiresAt: Date.now() + TRUST_CACHE_TTL,
  };
  trustCache.set(account, entry);
  return entry;
}

// ── Main Verification ──────────────────────────────────────────

export async function verifyA2ARequest(
  headers: Record<string, string | undefined>,
  body: string,
  config: A2AAuthConfig,
): Promise<A2AAuthResult> {
  const account = headers['x-xpr-account'];
  const timestampStr = headers['x-xpr-timestamp'];
  const signature = headers['x-xpr-signature'];

  // If auth is not required and no auth headers are present, allow through
  if (!config.authRequired && !signature) {
    return { account: account || 'anonymous' };
  }

  // If auth is required, all headers must be present
  if (!account || !timestampStr || !signature) {
    throw new A2AAuthError(
      'Authentication required: X-XPR-Account, X-XPR-Timestamp, and X-XPR-Signature headers are required',
      -32000,
    );
  }

  // Validate timestamp
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    throw new A2AAuthError('Invalid X-XPR-Timestamp: must be a Unix timestamp', -32000);
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > config.timestampWindow) {
    throw new A2AAuthError(
      `Request timestamp too far from server time (window: ${config.timestampWindow}s)`,
      -32000,
    );
  }

  // Recover public key from signature
  const bodyDigest = hashBody(body);
  let recoveredKey: string;
  try {
    recoveredKey = recoverA2APublicKey(signature, account, timestamp, bodyDigest);
  } catch {
    throw new A2AAuthError('Invalid signature: could not recover public key', -32000);
  }

  // Verify recovered key against on-chain account keys
  const rpc = new JsonRpc(config.rpcEndpoint);
  const accountKeys = await getAccountKeys(rpc, account);

  const keyMatch = accountKeys.some(k => k === recoveredKey);
  if (!keyMatch) {
    throw new A2AAuthError(
      `Signature verification failed: recovered key does not match any active key for account '${account}'`,
      -32000,
    );
  }

  // Rate limiting
  checkRateLimit(account, config.rateLimit);

  // Trust gating (only if thresholds are configured)
  let trustScore: number | undefined;
  if (config.minTrustScore > 0 || config.minKycLevel > 0) {
    const trust = await getAccountTrust(rpc, account, config.agentcoreContract);

    if (!trust.active) {
      throw new A2AAuthError(`Agent '${account}' is not active`, -32000);
    }

    if (config.minKycLevel > 0 && trust.kycLevel < config.minKycLevel) {
      throw new A2AAuthError(
        `KYC level ${trust.kycLevel} below minimum ${config.minKycLevel}`,
        -32000,
      );
    }

    if (config.minTrustScore > 0 && trust.score < config.minTrustScore) {
      throw new A2AAuthError(
        `Trust score ${trust.score} below minimum ${config.minTrustScore}`,
        -32000,
      );
    }

    trustScore = trust.score;
  }

  return { account, trustScore };
}

/** Clear all caches (for testing) */
export function clearAuthCaches(): void {
  keyCache.clear();
  trustCache.clear();
  rateLimitMap.clear();
}

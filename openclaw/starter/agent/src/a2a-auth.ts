/**
 * A2A server-side authentication, trust gating, and rate limiting.
 *
 * Verifies EOSIO signatures on incoming POST /a2a requests,
 * checks trust score / KYC level, and enforces per-account rate limits.
 */

import { recoverA2APublicKey, hashBody } from '@xpr-agents/sdk';
import { JsonRpc, Key } from '@proton/js';

// ── Types ──────────────────────────────────────────────────────

export interface A2AAuthConfig {
  rpcEndpoint: string;
  authRequired: boolean;       // default true
  minTrustScore: number;       // default 0 (disabled)
  minKycLevel: number;         // default 0 (disabled)
  rateLimit: number;           // requests per minute, default 20
  timestampWindow: number;     // seconds, default 300 (5 min)
  agentcoreContract: string;   // default 'agentcore'
  selfAccount: string;         // this server's own XPR account — the signed audience (codex #8)
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

/** A public key and its weight within one permission's authority. */
export interface PermKey {
  key: string;   // normalized PUB_K1_ form
  weight: number;
}

/** A candidate permission an A2A signer may authenticate under. */
export interface CandidatePerm {
  perm: string;      // 'active' or 'a2a'
  threshold: number;
  keys: PermKey[];
}

interface KeyCacheEntry {
  perms: CandidatePerm[];
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

// ── Replay Protection ──────────────────────────────────────────
// The SAME signed request can be replayed repeatedly within the ±timestampWindow.
// Remember each accepted request until it falls outside the acceptance window, and
// reject a second use. The key is the SIGNED tuple (account, timestamp, bodyDigest),
// NOT the signature string — ECDSA signatures are malleable, so keying on the
// signature would let a mutated copy through once. TTL is 2×window to cover both the
// past and future edges of the window.

const usedRequests = new Map<string, number>(); // signed-tuple key -> expiry (epoch ms)

setInterval(() => {
  const now = Date.now();
  for (const [key, exp] of usedRequests) {
    if (exp <= now) usedRequests.delete(key);
  }
}, 60_000).unref();

export function checkReplay(key: string, windowSec: number): void {
  const now = Date.now();
  const seen = usedRequests.get(key);
  if (seen && seen > now) {
    throw new A2AAuthError('Replay detected: this signed request has already been used', -32000);
  }
  usedRequests.set(key, now + windowSec * 2 * 1000);
}

// ── Chain ID ───────────────────────────────────────────────────
// The network chain id is bound into the signed digest (codex #8) so a signature
// cannot be replayed across networks. Fetched once via get_info and cached — it
// never changes for a running server.

let cachedChainId: string | null = null;

export async function getChainId(rpc: JsonRpc): Promise<string> {
  if (cachedChainId) return cachedChainId;
  const info = await rpc.get_info();
  const id = (info as any).chain_id;
  if (!id) throw new A2AAuthError('Could not determine chain id from RPC get_info', -32000);
  cachedChainId = id;
  return id;
}

// ── Key Fetching ───────────────────────────────────────────────

// Permissions an A2A signer may authenticate under. `active` is the account's
// top-level authority; `a2a` is the documented isolated signing permission (a
// dedicated key so the A2A process need not hold the active key — see
// openclaw/src/tools/a2a.ts). A signature is accepted only if it satisfies ONE of
// these permissions' thresholds on its own.
const A2A_AUTH_PERMISSIONS = ['active', 'a2a'];

/**
 * Parse an account's on-chain permissions into the candidate authorities an A2A
 * single-signature request may use. Pure (no I/O) so it is unit-testable. Keeps
 * each permission's weights and threshold so a lone key of a multisig account is
 * NOT accepted, and includes the `a2a` isolated-signing permission when present.
 */
export function parseAuthPermissions(permissions: any[]): CandidatePerm[] {
  const out: CandidatePerm[] = [];
  for (const name of A2A_AUTH_PERMISSIONS) {
    const p = (permissions || []).find((pp: any) => pp.perm_name === name);
    if (!p || !p.required_auth) continue;
    const ra = p.required_auth;
    const keys: PermKey[] = (ra.keys || []).map((k: any) => {
      const raw: string = k.key;
      // Normalize to PUB_K1_ format — chain may return legacy EOS... prefix
      const key = raw.startsWith('EOS') ? Key.PublicKey.fromString(raw).toString() : raw;
      return { key, weight: Number(k.weight) || 0 };
    });
    out.push({ perm: name, threshold: Number(ra.threshold) || 1, keys });
  }
  return out;
}

/**
 * True if `recoveredKey` alone satisfies at least one candidate permission —
 * i.e. it appears in that permission with a weight >= the permission threshold.
 * A single key of a genuine multisig account (weight below threshold) is rejected.
 */
export function isKeyAuthorized(perms: CandidatePerm[], recoveredKey: string): boolean {
  return perms.some(p => {
    const match = p.keys.find(k => k.key === recoveredKey);
    return match !== undefined && match.weight >= p.threshold;
  });
}

async function getAuthPermissions(rpc: JsonRpc, account: string): Promise<CandidatePerm[]> {
  const cached = keyCache.get(account);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.perms;
  }

  const accountInfo = await rpc.get_account(account);
  const perms = parseAuthPermissions(accountInfo.permissions || []);

  if (perms.length === 0) {
    throw new A2AAuthError(`Account '${account}' has no active or a2a permission`, -32000);
  }
  if (perms.every(p => p.keys.length === 0)) {
    throw new A2AAuthError(`Account '${account}' has no usable active/a2a keys`, -32000);
  }

  keyCache.set(account, { perms, expiresAt: Date.now() + KEY_CACHE_TTL });
  return perms;
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
      const row = kycResult.rows[0] as any;
      const rawKyc = row.kyc;
      // On-chain kyc field is an array. Entries may be:
      // - objects: {kyc_provider, kyc_level, kyc_date} where kyc_level is a claims string
      // - numbers: plain numeric levels (test environments)
      if (Array.isArray(rawKyc) && rawKyc.length > 0) {
        const levels: number[] = [];
        for (const entry of rawKyc) {
          if (typeof entry === 'object' && entry !== null && 'kyc_level' in entry) {
            // Object format: {kyc_provider: "metal.kyc", kyc_level: "trulioo:address,...", kyc_date: N}
            // Parse kyc_level string for numeric values or count claims
            const levelStr = String(entry.kyc_level);
            const claims = levelStr.split(',').filter((s: string) => s.trim().length > 0);
            // Determine level: if any segment parses as a plain number, use it;
            // otherwise derive level from claim count (1-3 = level 1, 4-6 = level 2, 7+ = level 3)
            let foundNumeric = false;
            for (const claim of claims) {
              const trimmed = claim.trim();
              if (trimmed.includes(':')) {
                const parts = trimmed.split(':');
                const num = parseInt(parts[parts.length - 1], 10);
                if (!isNaN(num) && String(num) === parts[parts.length - 1]) {
                  levels.push(num);
                  foundNumeric = true;
                }
              } else {
                const num = parseInt(trimmed, 10);
                if (!isNaN(num)) {
                  levels.push(num);
                  foundNumeric = true;
                }
              }
            }
            // If no numeric levels found, derive from claim count
            if (!foundNumeric && claims.length > 0) {
              levels.push(Math.min(Math.ceil(claims.length / 3), 3));
            }
          } else {
            // Plain number or string number
            const num = Number(entry);
            if (!isNaN(num) && isFinite(num)) {
              levels.push(num);
            }
          }
        }
        kycLevel = levels.length > 0 ? Math.min(Math.max(...levels), 3) : 0;
      }
      // Also check the simpler 'verified' flag as baseline
      if (kycLevel === 0 && row.verified === 1) {
        kycLevel = 1;
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

  // Recover public key from signature. The digest binds this server's own account
  // (audience) and chain id, so a signature made for another server or network
  // recovers a different key and fails the match below (codex #8).
  const rpc = new JsonRpc(config.rpcEndpoint);
  const chainId = await getChainId(rpc);
  const bodyDigest = hashBody(body);
  let recoveredKey: string;
  try {
    recoveredKey = recoverA2APublicKey(signature, account, timestamp, bodyDigest, config.selfAccount, chainId);
  } catch {
    throw new A2AAuthError('Invalid signature: could not recover public key', -32000);
  }

  // Verify recovered key against on-chain account authorities. The key must
  // satisfy the threshold of the active OR a2a permission on its own — a lone key
  // of a multisig account (weight below threshold) is rejected, and the documented
  // isolated `a2a` permission is honored.
  const perms = await getAuthPermissions(rpc, account);

  if (!isKeyAuthorized(perms, recoveredKey)) {
    throw new A2AAuthError(
      `Signature verification failed: recovered key does not satisfy the threshold of the active or a2a permission for account '${account}'`,
      -32000,
    );
  }

  // Rate limiting (before replay bookkeeping so a flood cannot grow the store).
  checkRateLimit(account, config.rateLimit);

  // Replay protection: key on what was actually SIGNED — (account, timestamp,
  // bodyDigest) — not the signature string. ECDSA signatures are malleable
  // (s -> n-s yields a different SIG_K1_ that recovers the same key), so keying on
  // the signature would let a mutated copy replay once. The signed tuple is stable.
  checkReplay(`${account}:${timestamp}:${bodyDigest}`, config.timestampWindow);

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
  usedRequests.clear();
  cachedChainId = null;
}

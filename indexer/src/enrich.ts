/**
 * Agent enrichment — fills in the fields the chain does not store on the
 * agent row but every UI needs to rank agents: the owner's/agent's KYC level
 * (eosio.proton::usersinfo), the agent's system stake (eosio::voters) and the
 * derived trust score. Runs on a schedule and on demand via POST /api/admin/sync-kyc.
 *
 * The trust formula mirrors frontend/src/lib/registry.ts#calculateTrustScore
 * and CLAUDE.md so the indexer and the UI never disagree.
 */

import Database from 'better-sqlite3';

export interface KycEntry {
  kyc_provider?: string;
  kyc_level?: string; // comma-separated claims string, NOT a number
  kyc_date?: number;
}

export interface TrustInputs {
  kyc_level: number;
  system_stake: number; // raw units (4 decimals)
  avg_score: number;    // 0-10000
  feedback_count: number;
  registered_at: number; // unix seconds
}

const EMPTY_NAME = '.............';
const XPR_PRECISION = 10000;
const SECONDS_PER_MONTH = 30 * 24 * 60 * 60;

/** Derive a 0-3 KYC level from the claims strings on a usersinfo row. */
export function kycLevelFromClaims(entries: KycEntry[] | null | undefined): number {
  if (!Array.isArray(entries)) return 0;
  let max = 0;
  for (const e of entries) {
    const claims = e && typeof e === 'object' ? String(e.kyc_level ?? '') : '';
    if (!claims) continue;
    const n = claims.split(',').filter(Boolean).length;
    const level = n >= 5 ? 3 : n >= 3 ? 2 : 1;
    if (level > max) max = level;
  }
  return max;
}

/** 0-100 trust score: KYC (30) + stake (20) + reputation (40) + longevity (10). */
export const REPUTATION_FULL_WEIGHT_REVIEWS = 5;

export function computeTrustScore(a: TrustInputs, now: number = Math.floor(Date.now() / 1000)): number {
  const kyc = Math.min(Math.max(a.kyc_level, 0) * 10, 30);
  const stakeXpr = Math.max(a.system_stake, 0) / XPR_PRECISION;
  const stake = Math.min(Math.floor(stakeXpr / 500), 20);
  // Reputation is scaled by review volume so a single 5-star review is worth 8
  // points, not 40. Full weight from REPUTATION_FULL_WEIGHT_REVIEWS reviews.
  const confidence = Math.min(Math.max(a.feedback_count, 0), REPUTATION_FULL_WEIGHT_REVIEWS) / REPUTATION_FULL_WEIGHT_REVIEWS;
  const reputation = a.feedback_count > 0 ? Math.floor((Math.max(a.avg_score, 0) / 10000) * 40 * confidence) : 0;
  const months = Math.floor((now - a.registered_at) / SECONDS_PER_MONTH);
  const longevity = Math.max(0, Math.min(months, 10));
  return kyc + stake + reputation + longevity;
}

export type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; json(): Promise<any> }>;

async function getTableRow(fetchFn: FetchLike, rpc: string, code: string, table: string, account: string): Promise<any | null> {
  const res = await fetchFn(`${rpc}/v1/chain/get_table_rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: true, code, scope: code, table, lower_bound: account, upper_bound: account, limit: 1 }),
  });
  if (!res.ok) throw new Error(`${code}/${table} lookup failed for ${account}`);
  const data = await res.json();
  return Array.isArray(data?.rows) && data.rows.length > 0 ? data.rows[0] : null;
}

export async function fetchKycLevel(fetchFn: FetchLike, rpc: string, account: string): Promise<number> {
  const row = await getTableRow(fetchFn, rpc, 'eosio.proton', 'usersinfo', account);
  return kycLevelFromClaims(row?.kyc);
}

export async function fetchSystemStake(fetchFn: FetchLike, rpc: string, account: string): Promise<number> {
  const row = await getTableRow(fetchFn, rpc, 'eosio', 'voters', account);
  const staked = row?.staked;
  const n = typeof staked === 'string' ? parseInt(staked, 10) : Number(staked);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Run `fn` over `items` with bounded concurrency. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface EnrichOptions {
  fetchFn?: FetchLike;
  concurrency?: number;
  now?: number;
  log?: (msg: string) => void;
}

export interface EnrichResult {
  agents: number;
  updated: number;
  failed: number;
}

/**
 * Enrich every agent row with kyc_level, system_stake and trust_score.
 * KYC is the max of the owner's and the agent's own level (bots can't KYC,
 * their human owner can). Agents whose lookups fail keep their previous values.
 */
export async function enrichAgents(db: Database.Database, rpcEndpoint: string, opts: EnrichOptions = {}): Promise<EnrichResult> {
  const fetchFn: FetchLike = opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const concurrency = opts.concurrency ?? 4;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const log = opts.log ?? (() => {});

  const agents = db.prepare(`
    SELECT a.account, a.owner, a.registered_at,
           COALESCE(s.avg_score, 0) AS avg_score,
           COALESCE(s.feedback_count, 0) AS feedback_count
    FROM agents a
    LEFT JOIN agent_scores s ON a.account = s.agent
  `).all() as Array<{ account: string; owner: string | null; registered_at: number; avg_score: number; feedback_count: number }>;

  // One KYC lookup per distinct account (agents + owners), one stake lookup per agent.
  const kycAccounts = new Set<string>();
  for (const a of agents) {
    kycAccounts.add(a.account);
    if (a.owner && a.owner !== EMPTY_NAME) kycAccounts.add(a.owner);
  }

  const kycByAccount = new Map<string, number>();
  const kycFailures = new Set<string>();
  await mapLimit([...kycAccounts], concurrency, async (acct) => {
    try {
      kycByAccount.set(acct, await fetchKycLevel(fetchFn, rpcEndpoint, acct));
    } catch (e) {
      kycFailures.add(acct);
      log(`[enrich] kyc lookup failed for ${acct}: ${e instanceof Error ? e.message : e}`);
    }
  });

  const stakeByAgent = new Map<string, number>();
  const stakeFailures = new Set<string>();
  await mapLimit(agents.map(a => a.account), concurrency, async (acct) => {
    try {
      stakeByAgent.set(acct, await fetchSystemStake(fetchFn, rpcEndpoint, acct));
    } catch (e) {
      stakeFailures.add(acct);
      log(`[enrich] stake lookup failed for ${acct}: ${e instanceof Error ? e.message : e}`);
    }
  });

  const update = db.prepare(`
    UPDATE agents SET kyc_level = ?, system_stake = ?, trust_score = ?, enriched_at = ?
    WHERE account = ?
  `);

  let updated = 0;
  let failed = 0;
  const tx = db.transaction(() => {
    for (const a of agents) {
      const ownerOk = !a.owner || a.owner === EMPTY_NAME || !kycFailures.has(a.owner);
      if (kycFailures.has(a.account) || !ownerOk || stakeFailures.has(a.account)) {
        failed++;
        continue;
      }
      const ownerKyc = a.owner && a.owner !== EMPTY_NAME ? (kycByAccount.get(a.owner) ?? 0) : 0;
      const kyc_level = Math.max(ownerKyc, kycByAccount.get(a.account) ?? 0);
      const system_stake = stakeByAgent.get(a.account) ?? 0;
      const trust_score = computeTrustScore({
        kyc_level,
        system_stake,
        avg_score: a.avg_score,
        feedback_count: a.feedback_count,
        registered_at: a.registered_at || now,
      }, now);
      update.run(kyc_level, system_stake, trust_score, now, a.account);
      updated++;
    }
  });
  tx();

  return { agents: agents.length, updated, failed };
}

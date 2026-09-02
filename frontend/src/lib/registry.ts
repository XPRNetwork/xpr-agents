import { JsonRpc } from '@proton/js';
import { getSelectedNetwork, getNetworkConfig, NETWORKS } from './networks';
import { indexerFetch } from './indexer';

// Network configuration — reads from localStorage, defaults to mainnet
const networkConfig = getNetworkConfig();
export const isMainnet = getSelectedNetwork() === 'mainnet';

// Contract names
/** On-chain sentinel for an unset `name` field (agent unassigned, no arbitrator, no owner). */
export const EMPTY_NAME = '.............';
export function isEmptyName(v: string | null | undefined): boolean {
  return !v || v === EMPTY_NAME;
}

export const CONTRACTS = {
  AGENT_CORE: process.env.NEXT_PUBLIC_AGENT_CORE || 'agentcore',
  AGENT_FEED: process.env.NEXT_PUBLIC_AGENT_FEED || 'agentfeed',
  AGENT_VALID: process.env.NEXT_PUBLIC_AGENT_VALID || 'agentvalid',
  AGENT_ESCROW: process.env.NEXT_PUBLIC_AGENT_ESCROW || 'agentescrow',
};

// Initialize RPC
export const rpc = new JsonRpc(networkConfig.rpc);

// Types
export interface Agent {
  account: string;
  owner: string | null;
  name: string;
  description: string;
  endpoint: string;
  protocol: string;
  capabilities: string[];
  stake: number;
  total_jobs: number;
  registered_at: number;
  active: boolean;
}

export interface AgentScore {
  agent: string;
  total_score: number;
  total_weight: number;
  feedback_count: number;
  avg_score: number;
  last_updated: number;
}

export interface Feedback {
  id: number;
  agent: string;
  reviewer: string;
  reviewer_kyc_level: number;
  score: number;
  tags: string[];
  job_hash: string;
  evidence_uri: string;
  amount_paid: number;
  timestamp: number;
  disputed: boolean;
  resolved: boolean;
}

export interface TrustScore {
  total: number;
  breakdown: {
    kyc: number;
    stake: number;
    reputation: number;
    longevity: number;
  };
  rating: 'untrusted' | 'low' | 'medium' | 'high' | 'verified';
}

// API functions
export async function getAgents(limit = 100): Promise<Agent[]> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_CORE,
    scope: CONTRACTS.AGENT_CORE,
    table: 'agents',
    limit,
  });

  return result.rows.map((row: any) => {
    let capabilities: string[] = [];
    try { capabilities = JSON.parse(row.capabilities || '[]'); } catch { /* malformed */ }
    const ownerRaw = row.owner || '';
    return {
      account: row.account,
      owner: ownerRaw && ownerRaw !== '.............' ? ownerRaw : null,
      name: row.name,
      description: row.description,
      endpoint: row.endpoint,
      protocol: row.protocol,
      capabilities,
      stake: 0, // populated later from eosio::voters via getSystemStake()
      total_jobs: parseInt(row.total_jobs) || 0,
      registered_at: parseInt(row.registered_at) || 0,
      active: row.active === 1,
    };
  });
}

export async function getAgent(account: string): Promise<Agent | null> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_CORE,
    scope: CONTRACTS.AGENT_CORE,
    table: 'agents',
    lower_bound: account,
    upper_bound: account,
    limit: 1,
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  let capabilities: string[] = [];
  try { capabilities = JSON.parse(row.capabilities || '[]'); } catch { /* malformed */ }
  const ownerRaw = row.owner || '';
  return {
    account: row.account,
    owner: ownerRaw && ownerRaw !== '.............' ? ownerRaw : null,
    name: row.name,
    description: row.description,
    endpoint: row.endpoint,
    protocol: row.protocol,
    capabilities,
    stake: 0, // populated later from eosio::voters via getSystemStake()
    total_jobs: parseInt(row.total_jobs) || 0,
    registered_at: parseInt(row.registered_at) || 0,
    active: row.active === 1,
  };
}

export async function getAgentScore(agent: string): Promise<AgentScore | null> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_FEED,
    scope: CONTRACTS.AGENT_FEED,
    table: 'agentscores',
    lower_bound: agent,
    upper_bound: agent,
    limit: 1,
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    agent: row.agent,
    total_score: parseInt(row.total_score),
    total_weight: parseInt(row.total_weight),
    feedback_count: parseInt(row.feedback_count),
    avg_score: parseInt(row.avg_score),
    last_updated: parseInt(row.last_updated),
  };
}

export async function getAgentFeedback(agent: string, limit = 50): Promise<Feedback[]> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_FEED,
    scope: CONTRACTS.AGENT_FEED,
    table: 'feedback',
    index_position: 2,
    key_type: 'i64',
    limit,
  });

  return result.rows
    .filter((row: any) => row.agent === agent)
    .map((row: any) => ({
      id: parseInt(row.id),
      agent: row.agent,
      reviewer: row.reviewer,
      reviewer_kyc_level: row.reviewer_kyc_level,
      score: row.score,
      tags: row.tags ? row.tags.split(',').filter((t: string) => t) : [],
      job_hash: row.job_hash,
      evidence_uri: row.evidence_uri,
      amount_paid: parseInt(row.amount_paid),
      timestamp: parseInt(row.timestamp),
      disputed: row.disputed === 1,
      resolved: row.resolved === 1,
    }));
}

export async function getKycLevel(account: string, ownerAccount?: string | null): Promise<number> {
  // If an owner is set, check their KYC first (bots can't complete KYC but their human owner can)
  if (ownerAccount) {
    const ownerKyc = await fetchKycLevel(ownerAccount);
    if (ownerKyc > 0) return ownerKyc;
  }
  return fetchKycLevel(account);
}

async function fetchKycLevel(account: string): Promise<number> {
  try {
    const result = await rpc.get_table_rows({
      json: true,
      code: 'eosio.proton',
      scope: 'eosio.proton',
      table: 'usersinfo',
      lower_bound: account,
      upper_bound: account,
      limit: 1,
    });

    if (result.rows.length === 0) return 0;

    const kyc = result.rows[0].kyc || [];
    if (kyc.length === 0) return 0;

    // KYC entries are {kyc_provider, kyc_level, kyc_date} where kyc_level is a
    // comma-separated claims string. Derive numeric level from claim count:
    // 1-2 claims = level 1, 3-4 = level 2, 5+ = level 3
    let maxLevel = 0;
    for (const entry of kyc) {
      const claims = typeof entry === 'object' ? (entry.kyc_level || '') : '';
      if (!claims) continue;
      const count = claims.split(',').length;
      let level = 1;
      if (count >= 5) level = 3;
      else if (count >= 3) level = 2;
      if (level > maxLevel) maxLevel = level;
    }
    return maxLevel;
  } catch {
    return 0;
  }
}

export async function getSystemStake(account: string): Promise<number> {
  try {
    const result = await rpc.get_table_rows({
      json: true,
      code: 'eosio',
      scope: 'eosio',
      table: 'voters',
      lower_bound: account,
      upper_bound: account,
      limit: 1,
    });
    if (result.rows.length > 0 && result.rows[0].staked) {
      return parseInt(result.rows[0].staked) || 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

export interface AgentClaimInfo {
  exists: boolean;
  owner: string | null;
  pending_owner: string | null;
  claim_deposit: number;
  name: string;
}

export async function getAgentClaimInfo(agentAccount: string): Promise<AgentClaimInfo> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_CORE,
    scope: CONTRACTS.AGENT_CORE,
    table: 'agents',
    lower_bound: agentAccount,
    upper_bound: agentAccount,
    limit: 1,
  });

  if (result.rows.length === 0) {
    return { exists: false, owner: null, pending_owner: null, claim_deposit: 0, name: '' };
  }

  const row = result.rows[0];
  const ownerRaw = row.owner || '';
  const pendingRaw = row.pending_owner || '';
  return {
    exists: true,
    owner: ownerRaw && ownerRaw !== '.............' ? ownerRaw : null,
    pending_owner: pendingRaw && pendingRaw !== '.............' ? pendingRaw : null,
    claim_deposit: parseInt(row.claim_deposit) || 0,
    name: row.name || agentAccount,
  };
}

export function calculateTrustScore(
  agent: Agent,
  agentScore: AgentScore | null,
  kycLevel: number,
  systemStake?: number
): TrustScore {
  // systemStake is in smallest units (divide by 10000 for XPR), then /500 for score
  const stakeXpr = (systemStake ?? agent.stake) / 10000;
  const breakdown = {
    kyc: Math.min(kycLevel * 10, 30),
    stake: Math.min(Math.floor(stakeXpr / 500), 20),
    reputation: 0,
    longevity: 0,
  };

  if (agentScore && agentScore.total_weight > 0) {
    breakdown.reputation = Math.floor((agentScore.avg_score / 10000) * 40);
  }

  const now = Math.floor(Date.now() / 1000);
  const monthsActive = Math.floor((now - agent.registered_at) / (30 * 24 * 60 * 60));
  breakdown.longevity = Math.min(monthsActive, 10);

  const total = breakdown.kyc + breakdown.stake + breakdown.reputation + breakdown.longevity;

  let rating: TrustScore['rating'] = 'untrusted';
  if (total >= 80) rating = 'verified';
  else if (total >= 60) rating = 'high';
  else if (total >= 40) rating = 'medium';
  else if (total >= 20) rating = 'low';

  return { total, breakdown, rating };
}

// Escrow types
export interface Job {
  id: number;
  client: string;
  agent: string;
  title: string;
  description: string;
  deliverables: string[];
  amount: number;
  symbol: string;
  funded_amount: number;
  state: number;
  deadline: number;
  arbitrator: string;
  created_at: number;
  updated_at: number;
}

export interface Bid {
  id: number;
  job_id: number;
  agent: string;
  amount: number;
  timeline: number;
  proposal: string;
  created_at: number;
}

const JOB_STATE_LABELS = ['Created', 'Funded', 'Accepted', 'In Progress', 'Delivered', 'Disputed', 'Completed', 'Refunded', 'Arbitrated'];

export function getJobStateLabel(state: number): string {
  return JOB_STATE_LABELS[state] || 'Unknown';
}

export async function getOpenJobs(limit = 100): Promise<Job[]> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_ESCROW,
    scope: CONTRACTS.AGENT_ESCROW,
    table: 'jobs',
    limit,
  });

  return result.rows
    .filter((row: any) => row.agent === '' || row.agent === '.............')
    .map(parseJob);
}

export async function getAllJobs(limit = 500): Promise<Job[]> {
  const allJobs: Job[] = [];
  let lower_bound: string | undefined = undefined;
  const pageSize = Math.min(limit, 100);

  while (allJobs.length < limit) {
    // Explicit type — Turbopack's stricter typecheck flags `const result = await rpc.get_table_rows(...)`
    // as implicitly `any`. JsonRpc.get_table_rows returns `Promise<any>` from @proton/js.
    const result: { rows: any[]; more: boolean } = await rpc.get_table_rows({
      json: true,
      code: CONTRACTS.AGENT_ESCROW,
      scope: CONTRACTS.AGENT_ESCROW,
      table: 'jobs',
      reverse: true,
      limit: pageSize,
      ...(lower_bound ? { upper_bound: lower_bound } : {}),
    });

    const rows = result.rows;
    if (rows.length === 0) break;

    for (const row of rows) {
      const job = parseJob(row);
      // Skip duplicate from pagination boundary
      if (allJobs.length > 0 && allJobs[allJobs.length - 1].id === job.id) continue;
      allJobs.push(job);
    }

    if (!result.more) break;
    // For reverse iteration, next page upper_bound = lowest ID we've seen - 1
    const lastId = rows[rows.length - 1].id;
    lower_bound = String(lastId - 1);
    if (lastId <= 0) break;
  }

  return allJobs;
}

export async function getJob(id: number): Promise<Job | null> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_ESCROW,
    scope: CONTRACTS.AGENT_ESCROW,
    table: 'jobs',
    lower_bound: String(id),
    upper_bound: String(id),
    limit: 1,
  });

  if (result.rows.length === 0) return null;
  return parseJob(result.rows[0]);
}

export async function getJobEvidence(jobId: number): Promise<string | null> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_ESCROW,
    scope: CONTRACTS.AGENT_ESCROW,
    table: 'jobevidence',
    lower_bound: String(jobId),
    upper_bound: String(jobId),
    limit: 1,
  });

  if (result.rows.length > 0) {
    return result.rows[0].evidence_uri || null;
  }
  return null;
}

export async function getBidCounts(): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  try {
    const result = await rpc.get_table_rows({
      json: true,
      code: CONTRACTS.AGENT_ESCROW,
      scope: CONTRACTS.AGENT_ESCROW,
      table: 'bids',
      limit: 500,
    });
    for (const row of result.rows) {
      const jobId = parseInt(row.job_id);
      counts.set(jobId, (counts.get(jobId) || 0) + 1);
    }
  } catch { /* silent */ }
  return counts;
}

export async function getBidsForJob(jobId: number): Promise<Bid[]> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_ESCROW,
    scope: CONTRACTS.AGENT_ESCROW,
    table: 'bids',
    index_position: 2,
    key_type: 'i64',
    lower_bound: String(jobId),
    limit: 100,
  });

  return result.rows
    .filter((row: any) => parseInt(row.job_id) === jobId)
    .map((row: any) => ({
      id: parseInt(row.id),
      job_id: parseInt(row.job_id),
      agent: row.agent,
      amount: parseInt(row.amount),
      timeline: parseInt(row.timeline),
      proposal: row.proposal,
      created_at: parseInt(row.created_at),
    }));
}

function parseJob(row: any): Job {
  let deliverables: string[] = [];
  try { deliverables = JSON.parse(row.deliverables || '[]'); } catch { /* malformed */ }
  return {
    id: parseInt(row.id),
    client: row.client,
    agent: row.agent || '',
    title: row.title,
    description: row.description,
    deliverables,
    amount: parseInt(row.amount) || 0,
    symbol: row.symbol || 'XPR',
    funded_amount: parseInt(row.funded_amount) || 0,
    state: parseInt(row.state) || 0,
    deadline: parseInt(row.deadline) || 0,
    arbitrator: row.arbitrator || '',
    created_at: parseInt(row.created_at) || 0,
    updated_at: parseInt(row.updated_at) || 0,
  };
}

export async function getBidsByAgent(agent: string): Promise<Bid[]> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_ESCROW,
    scope: CONTRACTS.AGENT_ESCROW,
    table: 'bids',
    index_position: 3, // byAgent index
    key_type: 'i64',
    lower_bound: agent,
    upper_bound: agent,
    limit: 100,
  });

  return result.rows
    .filter((row: any) => row.agent === agent)
    .map((row: any) => ({
      id: parseInt(row.id),
      job_id: parseInt(row.job_id),
      agent: row.agent,
      amount: parseInt(row.amount),
      timeline: parseInt(row.timeline),
      proposal: row.proposal,
      created_at: parseInt(row.created_at),
    }));
}

// Returns last activity timestamp (in seconds) per agent from completed/delivered/arbitrated jobs
export async function getAgentLastActivity(): Promise<Record<string, number>> {
  const fromIndexer = await indexerFetch<Record<string, number>>('/agents/activity');
  if (fromIndexer && typeof fromIndexer === 'object') return fromIndexer;
  return getAgentLastActivityRpc();
}

async function getAgentLastActivityRpc(): Promise<Record<string, number>> {
  const jobs = await getAllJobs(500);
  const activity: Record<string, number> = {};
  for (const job of jobs) {
    // States: 4=delivered, 6=completed, 8=arbitrated
    if (job.agent && job.agent !== '.............' && [4, 6, 8].includes(job.state)) {
      const ts = job.updated_at || job.created_at;
      if (!activity[job.agent] || ts > activity[job.agent]) {
        activity[job.agent] = ts;
      }
    }
  }
  return activity;
}

export function formatTimeline(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function formatXpr(amount: number): string {
  const xpr = amount / 10000;
  // Clean display: drop trailing zeros, max 2 decimals for readability
  if (xpr === Math.floor(xpr)) return `${xpr} XPR`;
  return `${parseFloat(xpr.toFixed(2))} XPR`;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString();
}

export function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 0) {
    // Future date — show countdown
    const absDiff = -diff;
    if (absDiff < 3600) return `in ${Math.ceil(absDiff / 60)}m`;
    if (absDiff < 86400) return `in ${Math.ceil(absDiff / 3600)}h`;
    return `in ${Math.ceil(absDiff / 86400)}d`;
  }
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(timestamp);
}

// Stats helpers for homepage
export interface RegistryStats {
  activeAgents: number;
  totalJobs: number;
  validators: number;
  feedbacks: number;
}

export async function getRegistryStats(): Promise<RegistryStats> {
  const stats = await indexerFetch<Record<string, number>>('/stats');
  if (stats && typeof stats.active_agents === 'number') {
    return {
      activeAgents: stats.active_agents,
      totalJobs: stats.total_jobs_escrow ?? stats.total_jobs ?? 0,
      validators: stats.total_validators ?? 0,
      feedbacks: stats.total_feedback ?? 0,
    };
  }
  return getRegistryStatsRpc();
}

async function getRegistryStatsRpc(): Promise<RegistryStats> {
  const [agents, jobs, validators, feedbackRows] = await Promise.all([
    rpc.get_table_rows({ json: true, code: CONTRACTS.AGENT_CORE, scope: CONTRACTS.AGENT_CORE, table: 'agents', limit: 500 }),
    rpc.get_table_rows({ json: true, code: CONTRACTS.AGENT_ESCROW, scope: CONTRACTS.AGENT_ESCROW, table: 'jobs', limit: 500 }),
    rpc.get_table_rows({ json: true, code: CONTRACTS.AGENT_VALID, scope: CONTRACTS.AGENT_VALID, table: 'validators', limit: 500 }),
    rpc.get_table_rows({ json: true, code: CONTRACTS.AGENT_FEED, scope: CONTRACTS.AGENT_FEED, table: 'feedback', limit: 1, reverse: true }),
  ]);

  return {
    activeAgents: agents.rows.filter((r: any) => r.active === 1).length,
    totalJobs: jobs.rows.length,
    validators: validators.rows.filter((r: any) => r.active === 1).length,
    feedbacks: feedbackRows.rows.length > 0 ? parseInt(feedbackRows.rows[0].id) + 1 : 0,
  };
}

// Get jobs for a specific agent
export async function getJobsByAgent(agent: string): Promise<Job[]> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_ESCROW,
    scope: CONTRACTS.AGENT_ESCROW,
    table: 'jobs',
    limit: 500,
  });

  return result.rows
    .filter((row: any) => row.agent === agent)
    .map(parseJob);
}

// Leaderboard types and helpers
export interface LeaderboardEntry {
  agent: Agent;
  trustScore: TrustScore;
  earnings: number;
  completedJobs: number;
}

// ============== PAGINATED AGENT LISTING (indexer-first) ==============

export type AgentSort = 'trust' | 'stake' | 'jobs' | 'earnings' | 'newest';

export interface AgentPage {
  entries: LeaderboardEntry[];
  total: number;
  source: 'indexer' | 'rpc';
}

interface IndexerAgentRow {
  account: string;
  owner?: string | null;
  name: string;
  description?: string;
  endpoint?: string;
  protocol?: string;
  capabilities?: string;
  total_jobs?: number;
  registered_at?: number;
  active?: number;
  kyc_level?: number;
  system_stake?: number;
  avg_score?: number;
  feedback_count?: number;
  total_weight?: number;
  earnings?: number;
  completed_jobs?: number;
}

function agentFromIndexerRow(row: IndexerAgentRow): Agent {
  let capabilities: string[] = [];
  try { capabilities = JSON.parse(row.capabilities || '[]'); } catch { /* malformed */ }
  const ownerRaw = row.owner || '';
  return {
    account: row.account,
    owner: ownerRaw && ownerRaw !== '.............' ? ownerRaw : null,
    name: row.name || row.account,
    description: row.description || '',
    endpoint: row.endpoint || '',
    protocol: row.protocol || '',
    capabilities,
    stake: row.system_stake ?? 0,
    total_jobs: row.total_jobs ?? 0,
    registered_at: row.registered_at ?? 0,
    active: row.active === 1 || row.active === undefined,
  };
}

function entryFromIndexerRow(row: IndexerAgentRow): LeaderboardEntry {
  const agent = agentFromIndexerRow(row);
  const feedbackCount = row.feedback_count ?? 0;
  const score: AgentScore = {
    agent: row.account,
    total_score: 0,
    total_weight: row.total_weight ?? (feedbackCount > 0 ? 1 : 0),
    feedback_count: feedbackCount,
    avg_score: row.avg_score ?? 0,
    last_updated: 0,
  };
  return {
    agent,
    trustScore: calculateTrustScore(agent, score, row.kyc_level ?? 0, row.system_stake ?? 0),
    earnings: row.earnings ?? 0,
    completedJobs: row.completed_jobs ?? 0,
  };
}

/**
 * One page of agents with trust scores and earnings.
 * Indexer path: a single request. RPC fallback: one agents read, one jobs read,
 * then per-agent enrichment for the requested page only (never the whole registry).
 * With `rpcFallback: false` it returns null when the indexer is unavailable.
 */
export async function getAgentsPage(opts: {
  limit?: number;
  offset?: number;
  sort?: AgentSort;
  activeOnly?: boolean;
  rpcFallback?: boolean;
} = {}): Promise<AgentPage | null> {
  const limit = opts.limit ?? 12;
  const offset = opts.offset ?? 0;
  const sort: AgentSort = opts.sort ?? 'trust';
  const activeOnly = opts.activeOnly ?? true;

  const data = await indexerFetch<{ agents: IndexerAgentRow[]; total?: number }>(
    `/agents?limit=${limit}&offset=${offset}&sort=${sort}&active_only=${activeOnly}`
  );
  if (data && Array.isArray(data.agents)) {
    const entries = data.agents.map(entryFromIndexerRow);
    return { entries, total: typeof data.total === 'number' ? data.total : entries.length, source: 'indexer' };
  }
  if (opts.rpcFallback === false) return null;
  return getAgentsPageRpc({ limit, offset, sort, activeOnly });
}

async function getAgentsPageRpc(opts: { limit: number; offset: number; sort: AgentSort; activeOnly: boolean }): Promise<AgentPage> {
  const [agents, jobs] = await Promise.all([getAgents(500), getAllJobs(500).catch(() => [] as Job[])]);
  const earningsByAgent = new Map<string, { total: number; completedJobs: number }>();
  for (const j of jobs) {
    if (j.state !== 6 && j.state !== 8) continue;
    const cur = earningsByAgent.get(j.agent) || { total: 0, completedJobs: 0 };
    cur.total += j.amount; cur.completedJobs += 1;
    earningsByAgent.set(j.agent, cur);
  }

  const filtered = agents.filter(a => !opts.activeOnly || a.active);
  // Trust and stake need per-agent RPC enrichment, so without the indexer we
  // order by activity (jobs, then age) and enrich only the visible page.
  filtered.sort((a, b) => {
    if (opts.sort === 'newest') return b.registered_at - a.registered_at;
    if (opts.sort === 'earnings') return (earningsByAgent.get(b.account)?.total || 0) - (earningsByAgent.get(a.account)?.total || 0);
    return (b.total_jobs - a.total_jobs) || (b.registered_at - a.registered_at);
  });

  const page = filtered.slice(opts.offset, opts.offset + opts.limit);
  const entries = await Promise.all(page.map(async (agent) => {
    const [score, systemStake] = await Promise.all([
      getAgentScore(agent.account).catch(() => null),
      getSystemStake(agent.account).catch(() => 0),
    ]);
    const kycLevel = await getKycLevel(agent.account, agent.owner).catch(() => 0);
    agent.stake = systemStake;
    const e = earningsByAgent.get(agent.account) || { total: 0, completedJobs: 0 };
    return { agent, trustScore: calculateTrustScore(agent, score, kycLevel, systemStake), earnings: e.total, completedJobs: e.completedJobs };
  }));

  return { entries, total: filtered.length, source: 'rpc' };
}

export async function getAgentEarnings(account: string): Promise<{ total: number; completedJobs: number }> {
  const jobs = await getJobsByAgent(account);
  const completed = jobs.filter(j => j.state === 6 || j.state === 8);
  const total = completed.reduce((sum, j) => sum + j.amount, 0);
  return { total, completedJobs: completed.length };
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const page = await getAgentsPage({ limit: 200, offset: 0, sort: 'trust', activeOnly: true, rpcFallback: false });
  if (page) return page.entries;
  return getLeaderboardRpc();
}

/** RPC fallback: one table read plus ~4 RPC calls per agent. Bounded to 100 agents. */
async function getLeaderboardRpc(): Promise<LeaderboardEntry[]> {
  const agents = await getAgents(100);
  const activeAgents = agents.filter(a => a.active);

  const entries = await Promise.all(
    activeAgents.map(async (agent) => {
      const [agentScore, kycLevel, earnings, systemStake] = await Promise.all([
        getAgentScore(agent.account).catch(() => null),
        getKycLevel(agent.account, agent.owner).catch(() => 0),
        getAgentEarnings(agent.account).catch(() => ({ total: 0, completedJobs: 0 })),
        getSystemStake(agent.account).catch(() => 0),
      ]);

      agent.stake = systemStake;
      const trustScore = calculateTrustScore(agent, agentScore, kycLevel, systemStake);

      return {
        agent,
        trustScore,
        earnings: earnings.total,
        completedJobs: earnings.completedJobs,
      };
    })
  );

  return entries;
}

// ============== VALIDATORS / VALIDATIONS / CHALLENGES ==============

export interface Validator {
  account: string;
  stake: number;
  method: string;
  specializations: string[];
  total_validations: number;
  incorrect_validations: number;
  accuracy_score: number;
  pending_challenges: number;
  registered_at: number;
  active: boolean;
}

export interface Validation {
  id: number;
  validator: string;
  agent: string;
  job_hash: string;
  result: number; // 0=fail, 1=pass, 2=partial
  confidence: number;
  evidence_uri: string;
  challenged: boolean;
  timestamp: number;
}

export interface Challenge {
  id: number;
  validation_id: number;
  challenger: string;
  reason: string;
  evidence_uri: string;
  stake: number;
  funding_deadline: number;
  status: number; // 0=pending, 1=upheld, 2=rejected, 3=cancelled
  resolver: string;
  resolution_notes: string;
  created_at: number;
  resolved_at: number;
}

export interface ValidatorConfig {
  owner: string;
  min_stake: number;
  challenge_stake: number;
  unstake_delay: number;
  challenge_window: number;
  slash_percent: number;
  dispute_period: number;
  validation_fee: number;
}

export interface ValidatorUnstake {
  id: number;
  validator: string;
  amount: number;
  request_time: number;
  available_at: number;
}

function parseValidator(row: any): Validator {
  let specializations: string[] = [];
  try { specializations = JSON.parse(row.specializations || '[]'); } catch { /* malformed */ }
  return {
    account: row.account,
    stake: parseInt(row.stake) || 0,
    method: row.method || '',
    specializations,
    total_validations: parseInt(row.total_validations) || 0,
    incorrect_validations: parseInt(row.incorrect_validations) || 0,
    accuracy_score: parseInt(row.accuracy_score) ?? 10000,
    pending_challenges: parseInt(row.pending_challenges) || 0,
    registered_at: parseInt(row.registered_at) || 0,
    active: row.active === 1 || row.active === true,
  };
}

function parseValidation(row: any): Validation {
  return {
    id: parseInt(row.id),
    validator: row.validator,
    agent: row.agent,
    job_hash: row.job_hash || '',
    result: parseInt(row.result) || 0,
    confidence: parseInt(row.confidence) || 0,
    evidence_uri: row.evidence_uri || '',
    challenged: row.challenged === 1 || row.challenged === true,
    timestamp: parseInt(row.timestamp) || 0,
  };
}

function parseChallenge(row: any): Challenge {
  return {
    id: parseInt(row.id),
    validation_id: parseInt(row.validation_id),
    challenger: row.challenger,
    reason: row.reason || '',
    evidence_uri: row.evidence_uri || '',
    stake: parseInt(row.stake) || 0,
    funding_deadline: parseInt(row.funding_deadline) || 0,
    status: parseInt(row.status) || 0,
    resolver: row.resolver || '',
    resolution_notes: row.resolution_notes || '',
    created_at: parseInt(row.created_at) || 0,
    resolved_at: parseInt(row.resolved_at) || 0,
  };
}

export async function getValidators(limit = 100): Promise<Validator[]> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_VALID,
    scope: CONTRACTS.AGENT_VALID,
    table: 'validators',
    limit,
  });
  return result.rows.map(parseValidator);
}

export async function getValidator(account: string): Promise<Validator | null> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_VALID,
    scope: CONTRACTS.AGENT_VALID,
    table: 'validators',
    lower_bound: account,
    upper_bound: account,
    limit: 1,
  });
  if (result.rows.length === 0) return null;
  return parseValidator(result.rows[0]);
}

export async function getValidations(limit = 100): Promise<Validation[]> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_VALID,
    scope: CONTRACTS.AGENT_VALID,
    table: 'validations',
    reverse: true,
    limit,
  });
  return result.rows.map(parseValidation);
}

export async function getValidationsByValidator(validator: string): Promise<Validation[]> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_VALID,
    scope: CONTRACTS.AGENT_VALID,
    table: 'validations',
    limit: 500,
  });
  return result.rows
    .filter((row: any) => row.validator === validator)
    .map(parseValidation);
}

export async function getChallenges(limit = 100): Promise<Challenge[]> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_VALID,
    scope: CONTRACTS.AGENT_VALID,
    table: 'challenges',
    reverse: true,
    limit,
  });
  return result.rows.map(parseChallenge);
}

export async function getChallengesForValidation(validationId: number): Promise<Challenge[]> {
  const challenges = await getChallenges(500);
  return challenges.filter(c => c.validation_id === validationId);
}

export async function getValidatorConfig(): Promise<ValidatorConfig | null> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_VALID,
    scope: CONTRACTS.AGENT_VALID,
    table: 'config',
    limit: 1,
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    owner: row.owner,
    min_stake: parseInt(row.min_stake) || 0,
    challenge_stake: parseInt(row.challenge_stake) || 0,
    unstake_delay: parseInt(row.unstake_delay) || 0,
    challenge_window: parseInt(row.challenge_window) || 0,
    slash_percent: parseInt(row.slash_percent) || 0,
    dispute_period: parseInt(row.dispute_period) || 0,
    validation_fee: parseInt(row.validation_fee) || 0,
  };
}

export async function getValidatorUnstakes(account: string): Promise<ValidatorUnstake[]> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_VALID,
    scope: CONTRACTS.AGENT_VALID,
    table: 'unstakes',
    limit: 100,
  });
  return result.rows
    .filter((row: any) => row.validator === account)
    .map((row: any) => ({
      id: parseInt(row.id),
      validator: row.validator,
      amount: parseInt(row.amount) || 0,
      request_time: parseInt(row.request_time) || 0,
      available_at: parseInt(row.available_at) || 0,
    }));
}

// ============== ARBITRATORS / DISPUTES ==============

export interface Arbitrator {
  account: string;
  stake: number;
  fee_percent: number;
  total_cases: number;
  successful_cases: number;
  active: boolean;
}

export interface Dispute {
  id: number;
  job_id: number;
  raised_by: string;
  reason: string;
  evidence_uri: string;
  client_amount: number;
  agent_amount: number;
  resolution: number; // 0=pending, 1=client, 2=agent, 3=split
  resolver: string;
  resolution_notes: string;
  created_at: number;
  resolved_at: number;
}

export interface EscrowConfig {
  owner: string;
  min_arbitrator_stake: number;
  arb_unstake_delay: number;
  platform_fee: number;
  min_job_amount: number;
  dispute_window: number;
}

export interface ArbUnstake {
  account: string;
  amount: number;
  requested_at: number;
  available_at: number;
}

function parseArbitrator(row: any): Arbitrator {
  return {
    account: row.account,
    stake: parseInt(row.stake) || 0,
    fee_percent: parseInt(row.fee_percent) || 0,
    total_cases: parseInt(row.total_cases) || 0,
    successful_cases: parseInt(row.successful_cases) || 0,
    active: row.active === 1 || row.active === true,
  };
}

function parseDispute(row: any): Dispute {
  return {
    id: parseInt(row.id),
    job_id: parseInt(row.job_id),
    raised_by: row.raised_by,
    reason: row.reason || '',
    evidence_uri: row.evidence_uri || '',
    client_amount: parseInt(row.client_amount) || 0,
    agent_amount: parseInt(row.agent_amount) || 0,
    resolution: parseInt(row.resolution) || 0,
    resolver: row.resolver || '',
    resolution_notes: row.resolution_notes || '',
    created_at: parseInt(row.created_at) || 0,
    resolved_at: parseInt(row.resolved_at) || 0,
  };
}

export async function getArbitrators(limit = 100): Promise<Arbitrator[]> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_ESCROW,
    scope: CONTRACTS.AGENT_ESCROW,
    table: 'arbitrators',
    limit,
  });
  return result.rows.map(parseArbitrator);
}

export async function getArbitrator(account: string): Promise<Arbitrator | null> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_ESCROW,
    scope: CONTRACTS.AGENT_ESCROW,
    table: 'arbitrators',
    lower_bound: account,
    upper_bound: account,
    limit: 1,
  });
  if (result.rows.length === 0) return null;
  return parseArbitrator(result.rows[0]);
}

export async function getDisputes(limit = 100): Promise<Dispute[]> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_ESCROW,
    scope: CONTRACTS.AGENT_ESCROW,
    table: 'disputes',
    reverse: true,
    limit,
  });
  return result.rows.map(parseDispute);
}

export async function getDisputesForJob(jobId: number): Promise<Dispute[]> {
  const disputes = await getDisputes(500);
  return disputes.filter(d => d.job_id === jobId);
}

export async function getEscrowConfig(): Promise<EscrowConfig | null> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_ESCROW,
    scope: CONTRACTS.AGENT_ESCROW,
    table: 'config',
    limit: 1,
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    owner: row.owner,
    min_arbitrator_stake: parseInt(row.min_arbitrator_stake) || 0,
    arb_unstake_delay: parseInt(row.arb_unstake_delay) || 0,
    platform_fee: parseInt(row.platform_fee) || 0,
    min_job_amount: parseInt(row.min_job_amount) || 0,
    dispute_window: parseInt(row.dispute_window) || 0,
  };
}

export async function getArbUnstake(account: string): Promise<ArbUnstake | null> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_ESCROW,
    scope: CONTRACTS.AGENT_ESCROW,
    table: 'arbunstakes',
    lower_bound: account,
    upper_bound: account,
    limit: 1,
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    account: row.account,
    amount: parseInt(row.amount) || 0,
    requested_at: parseInt(row.requested_at) || 0,
    available_at: parseInt(row.available_at) || 0,
  };
}

export const VALIDATION_RESULT_LABELS = ['Fail', 'Pass', 'Partial'];
export const CHALLENGE_STATUS_LABELS = ['Pending', 'Upheld', 'Rejected', 'Cancelled'];
export const DISPUTE_RESOLUTION_LABELS = ['Pending', 'Client Wins', 'Agent Wins', 'Split'];

// Fetch avatar from eosio.proton usersinfo table
const avatarCache = new Map<string, string | null>();

export async function getAvatar(account: string): Promise<string | null> {
  if (avatarCache.has(account)) return avatarCache.get(account) || null;
  try {
    const result = await rpc.get_table_rows({
      json: true,
      code: 'eosio.proton',
      scope: 'eosio.proton',
      table: 'usersinfo',
      lower_bound: account,
      upper_bound: account,
      limit: 1,
    });
    const avatar = result.rows[0]?.avatar || null;
    const dataUri = avatar ? `data:image/jpeg;base64,${avatar}` : null;
    avatarCache.set(account, dataUri);
    return dataUri;
  } catch {
    avatarCache.set(account, null);
    return null;
  }
}

export async function getAvatars(accounts: string[]): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  await Promise.all(accounts.map(async (acc) => {
    results.set(acc, await getAvatar(acc));
  }));
  return results;
}

export async function getRecentCompletedJobs(limit = 5): Promise<Job[]> {
  const jobs = await getAllJobs(100);
  return jobs
    .filter(j => j.state === 6 || j.state === 8)
    .slice(0, limit);
}

export async function getXprBalance(account: string): Promise<number> {
  try {
    const result = await rpc.get_table_rows({
      json: true,
      code: 'eosio.token',
      scope: account,
      table: 'accounts',
      limit: 10,
    });
    const xprRow = result.rows.find((r: any) => (r.balance || '').includes('XPR'));
    if (!xprRow) return 0;
    return Math.floor(parseFloat(xprRow.balance) * 10000);
  } catch {
    return 0;
  }
}

export async function getNetworkEarnings(): Promise<number> {
  const stats = await indexerFetch<Record<string, number>>('/stats');
  if (stats && typeof stats.network_earnings === 'number') return stats.network_earnings;
  const jobs = await getAllJobs(500);
  return jobs
    .filter(j => j.state === 6 || j.state === 8)
    .reduce((sum, j) => sum + j.amount, 0);
}

// ============== ATOMICASSETS / NFT ==============

export const ATOMIC_API = isMainnet
  ? 'https://aa-xprnetwork-main.saltant.io'
  : 'https://xpr-testnet-atm-api.bloxprod.io';

export const IPFS_GATEWAY = 'https://proton.mypinata.cloud/ipfs/';

export const MARKETPLACE_URL = isMainnet
  ? 'https://nft.xprnetwork.org'
  : 'https://testnet.nft.xprnetwork.org';

export interface NftDeliverable {
  type: 'nft';
  asset_ids: string[];
  collection?: string;
  evidence?: string;
}

export interface NftAsset {
  asset_id: string;
  name: string;
  collection_name: string;
  schema_name: string;
  template_id: string;
  image: string | null;
  data: Record<string, unknown>;
}

export interface NftCollection {
  collection_name: string;
  name: string;
  author: string;
  img: string | null;
  created_at_time: string;
}

/** Parse comma-separated deliverable URLs. Returns primary URL first (prefers PDF), rest as additional. */
export function parseDeliverableUrls(evidenceUri: string): { primary: string; additional: string[] } {
  // Don't split JSON objects, data URIs, or single URLs
  if (evidenceUri.startsWith('{') || evidenceUri.startsWith('data:') || !evidenceUri.includes(',http')) {
    return { primary: evidenceUri, additional: [] };
  }
  const urls = evidenceUri.split(',').map(u => u.trim()).filter(u => u.length > 0);
  if (urls.length <= 1) return { primary: evidenceUri, additional: [] };
  // Prefer PDF as primary — find first URL with .pdf or pdf in path
  const pdfIdx = urls.findIndex(u => /\.pdf($|\?)/i.test(u));
  if (pdfIdx > 0) {
    const [pdf] = urls.splice(pdfIdx, 1);
    return { primary: pdf, additional: urls };
  }
  return { primary: urls[0], additional: urls.slice(1) };
}

export function parseNftDeliverable(evidenceUri: string): NftDeliverable | null {
  if (!evidenceUri || !evidenceUri.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(evidenceUri);
    if (parsed.type === 'nft' && Array.isArray(parsed.asset_ids) && parsed.asset_ids.length > 0) {
      return parsed as NftDeliverable;
    }
  } catch { /* not JSON */ }
  return null;
}

export function getNftImageUrl(imageField: string | null | undefined): string | null {
  if (!imageField) return null;
  if (imageField.startsWith('http://') || imageField.startsWith('https://')) return imageField;
  // Treat as IPFS CID
  return `${IPFS_GATEWAY}${imageField}`;
}

export function getNftMarketplaceUrl(collection: string, templateId?: string): string {
  if (templateId) {
    return `${MARKETPLACE_URL}/${collection}/${templateId}`;
  }
  return `${MARKETPLACE_URL}/${collection}`;
}

const AA_ENDPOINTS = isMainnet
  ? ['https://aa-xprnetwork-main.saltant.io', 'https://xpr-mainnet-atm-api.bloxprod.io']
  : ['https://xpr-testnet-atm-api.bloxprod.io', 'https://aa-xprnetwork-test.saltant.io'];

export async function getNftAssets(assetIds: string[]): Promise<NftAsset[]> {
  const assets: NftAsset[] = [];
  for (const id of assetIds) {
    for (const endpoint of AA_ENDPOINTS) {
      try {
        const resp = await fetch(`${endpoint}/atomicassets/v1/assets/${encodeURIComponent(id)}`);
        if (!resp.ok) continue;
        const json = await resp.json();
        const d = json.data;
        if (!d) continue;
        const immData = d.immutable_data || {};
        const mutData = d.mutable_data || {};
        const tplData = d.template?.immutable_data || {};
        const image = immData.image || immData.img || tplData.image || tplData.img || mutData.image || mutData.img || null;
        assets.push({
          asset_id: d.asset_id,
          name: immData.name || tplData.name || mutData.name || `Asset #${d.asset_id}`,
          collection_name: d.collection?.collection_name || '',
          schema_name: d.schema?.schema_name || '',
          template_id: d.template?.template_id || '',
          image,
          data: { ...tplData, ...immData, ...mutData },
        });
        break; // success — don't try next endpoint
      } catch { /* try next endpoint */ }
    }
  }
  return assets;
}

export async function getCollectionsByAuthor(author: string): Promise<NftCollection[]> {
  try {
    const resp = await fetch(
      `${ATOMIC_API}/atomicassets/v1/collections?author=${encodeURIComponent(author)}&limit=50`
    );
    if (!resp.ok) return [];
    const json = await resp.json();
    return (json.data || []).map((c: any) => ({
      collection_name: c.collection_name,
      name: c.name || c.collection_name,
      author: c.author,
      img: c.img || c.data?.img || null,
      created_at_time: c.created_at_time || '',
    }));
  } catch {
    return [];
  }
}

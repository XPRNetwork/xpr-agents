import { JsonRpc } from '@proton/js';

// Network configuration
const NETWORK = {
  rpc: process.env.NEXT_PUBLIC_RPC_URL || 'https://proton.eosusa.io',
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID || '384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0',
};

// Contract names
export const CONTRACTS = {
  AGENT_CORE: process.env.NEXT_PUBLIC_AGENT_CORE || 'agentcore',
  AGENT_FEED: process.env.NEXT_PUBLIC_AGENT_FEED || 'agentfeed',
  AGENT_VALID: process.env.NEXT_PUBLIC_AGENT_VALID || 'agentvalid',
};

// Initialize RPC
export const rpc = new JsonRpc(NETWORK.rpc);

// Types
export interface Agent {
  account: string;
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
    return {
      account: row.account,
      name: row.name,
      description: row.description,
      endpoint: row.endpoint,
      protocol: row.protocol,
      capabilities,
      stake: parseInt(row.stake) || 0,
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
  return {
    account: row.account,
    name: row.name,
    description: row.description,
    endpoint: row.endpoint,
    protocol: row.protocol,
    capabilities,
    stake: parseInt(row.stake) || 0,
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

export async function getKycLevel(account: string): Promise<number> {
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

    return Math.min(Math.max(...kyc), 3);
  } catch {
    return 0;
  }
}

export function calculateTrustScore(
  agent: Agent,
  agentScore: AgentScore | null,
  kycLevel: number
): TrustScore {
  const breakdown = {
    kyc: Math.min(kycLevel * 10, 30),
    stake: Math.min(Math.floor((agent.stake / 10000) / 500), 20),
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

export function formatXpr(amount: number): string {
  return (amount / 10000).toFixed(4) + ' XPR';
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString();
}

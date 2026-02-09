import { JsonRpc } from '@proton/js';

// Network configuration — default to testnet; set NEXT_PUBLIC_NETWORK=mainnet for production
const isMainnet = process.env.NEXT_PUBLIC_NETWORK === 'mainnet';
const NETWORK = {
  rpc: process.env.NEXT_PUBLIC_RPC_URL || (isMainnet ? 'https://proton.eosusa.io' : 'https://tn1.protonnz.com'),
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID || (isMainnet
    ? '384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0'
    : '71ee83bcf20daefb060b14f72ad1dab3f84b588d12b4571f9b662a13a6f61f82'),
};

// Contract names
export const CONTRACTS = {
  AGENT_CORE: process.env.NEXT_PUBLIC_AGENT_CORE || 'agentcore',
  AGENT_FEED: process.env.NEXT_PUBLIC_AGENT_FEED || 'agentfeed',
  AGENT_VALID: process.env.NEXT_PUBLIC_AGENT_VALID || 'agentvalid',
  AGENT_ESCROW: process.env.NEXT_PUBLIC_AGENT_ESCROW || 'agentescrow',
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

export async function getAllJobs(limit = 100): Promise<Job[]> {
  const result = await rpc.get_table_rows({
    json: true,
    code: CONTRACTS.AGENT_ESCROW,
    scope: CONTRACTS.AGENT_ESCROW,
    table: 'jobs',
    reverse: true,
    limit,
  });

  return result.rows.map(parseJob);
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

export function formatTimeline(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function formatXpr(amount: number): string {
  return (amount / 10000).toFixed(4) + ' XPR';
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString();
}

// Stats helpers for homepage
export interface RegistryStats {
  activeAgents: number;
  totalJobs: number;
  validators: number;
  feedbacks: number;
}

export async function getRegistryStats(): Promise<RegistryStats> {
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

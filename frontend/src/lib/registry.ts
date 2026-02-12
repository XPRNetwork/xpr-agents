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

export async function getAgentEarnings(account: string): Promise<{ total: number; completedJobs: number }> {
  const jobs = await getJobsByAgent(account);
  const completed = jobs.filter(j => j.state === 6 || j.state === 8);
  const total = completed.reduce((sum, j) => sum + j.amount, 0);
  return { total, completedJobs: completed.length };
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const agents = await getAgents(500);
  const activeAgents = agents.filter(a => a.active);

  const entries = await Promise.all(
    activeAgents.map(async (agent) => {
      const [agentScore, kycLevel, earnings, systemStake] = await Promise.all([
        getAgentScore(agent.account).catch(() => null),
        getKycLevel(agent.account).catch(() => 0),
        getAgentEarnings(agent.account).catch(() => ({ total: 0, completedJobs: 0 })),
        getSystemStake(agent.account).catch(() => 0),
      ]);

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
  const jobs = await getAllJobs(500);
  return jobs
    .filter(j => j.state === 6 || j.state === 8)
    .reduce((sum, j) => sum + j.amount, 0);
}

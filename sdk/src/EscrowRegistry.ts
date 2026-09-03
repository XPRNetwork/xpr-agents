import {
  JsonRpc,
  ProtonSession,
  TransactAction,
  TransactionResult,
  PaginatedResult,
} from './types';
import { safeParseInt } from './utils';

// ============== Escrow Types ==============

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
  released_amount: number;
  state: JobState;
  deadline: number;
  arbitrator: string;
  job_hash: string;
  created_at: number;
  updated_at: number;
}

export interface JobRaw {
  id: string;
  client: string;
  agent: string;
  title: string;
  description: string;
  deliverables: string;
  amount: string;
  symbol: string;
  funded_amount: string;
  released_amount: string;
  state: number;
  deadline: string;
  arbitrator: string;
  job_hash: string;
  created_at: string;
  updated_at: string;
}

export type JobState =
  | 'created'
  | 'funded'
  | 'accepted'
  | 'inprogress'
  | 'delivered'
  | 'disputed'
  | 'completed'
  | 'refunded'
  | 'arbitrated';

export interface Milestone {
  id: number;
  job_id: number;
  title: string;
  description: string;
  amount: number;
  order: number;
  state: MilestoneState;
  evidence_uri: string;
  submitted_at: number;
  approved_at: number;
}

export interface MilestoneRaw {
  id: string;
  job_id: string;
  title: string;
  description: string;
  amount: string;
  order: number;
  state: number;
  evidence_uri: string;
  submitted_at: string;
  approved_at: string;
}

export type MilestoneState = 'pending' | 'submitted' | 'approved' | 'disputed';

export interface EscrowDispute {
  id: number;
  job_id: number;
  raised_by: string;
  reason: string;
  evidence_uri: string;
  client_amount: number;
  agent_amount: number;
  resolution: DisputeResolution;
  resolver: string;
  resolution_notes: string;
  created_at: number;
  resolved_at: number;
}

export type DisputeResolution = 'pending' | 'client_wins' | 'agent_wins' | 'split';

export interface Arbitrator {
  account: string;
  stake: number;
  fee_percent: number;
  total_cases: number;
  successful_cases: number;
  active_disputes: number;
  active: boolean;
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

export interface BidRaw {
  id: string;
  job_id: string;
  agent: string;
  amount: string;
  timeline: string;
  proposal: string;
  created_at: string;
}

export interface Service {
  id: number;
  agent: string;
  title: string;
  description: string;
  deliverables: string[];
  price: number;        // raw units (1 XPR = 10000)
  turnaround: number;   // seconds
  category: string;
  sample_uri: string;
  active: boolean;
  sales: number;
  boostPaid: number;      // lifetime boost total, raw units
  featuredUntil: number;  // seconds; featured while > now
  created_at: number;
  updated_at: number;
}

export interface ServiceRaw {
  id: string;
  agent: string;
  title: string;
  description: string;
  deliverables: string;
  price: string;
  turnaround: string;
  category: string;
  sample_uri: string;
  active: number;
  sales: string;
  boost_paid?: string;
  featured_until?: string;
  created_at: string;
  updated_at: string;
}

/** agentescrow `svcconfig` singleton — listing fee and featured-placement settings */
export interface ServiceConfig {
  service_fee: number;  // raw units charged to publish a listing (default 50000 = 5 XPR)
  boost_min: number;    // minimum boost transfer, raw units (default 10000 = 1 XPR)
  boost_rate: number;   // raw units that buy one featured day (default 10000 = 1 XPR)
}

export interface ServiceData {
  title: string;
  description: string;
  deliverables: string[];
  price: number;        // raw units (1 XPR = 10000)
  turnaround: number;   // seconds (3600 … 31536000)
  category?: string;
  sampleUri?: string;
}

export interface ServiceListOptions {
  limit?: number;
  activeOnly?: boolean;
}

export interface CreateJobData {
  agent?: string;
  title: string;
  description: string;
  deliverables: string[];
  amount: number;
  symbol?: string;
  deadline?: number;
  arbitrator?: string;
  job_hash?: string;
}

export interface SubmitBidData {
  job_id: number;
  amount: number;
  timeline: number;
  proposal: string;
}

export interface AddMilestoneData {
  job_id: number;
  title: string;
  description: string;
  amount: number;
  order: number;
}

export interface JobListOptions {
  limit?: number;
  cursor?: string;
  state?: JobState;
}

// ============== Registry Class ==============

const DEFAULT_CONTRACT = 'agentescrow';
const JOB_STATES: JobState[] = [
  'created', 'funded', 'accepted', 'inprogress',
  'delivered', 'disputed', 'completed', 'refunded', 'arbitrated'
];
// svcconfig defaults, mirrored from the contract, used when the row is unset
const DEFAULT_SERVICE_FEE = 50000; // 5.0000 XPR to publish a listing
const DEFAULT_BOOST_MIN = 10000;   // 1.0000 XPR minimum boost
const DEFAULT_BOOST_RATE = 10000;  // 1.0000 XPR buys one featured day

const MILESTONE_STATES: MilestoneState[] = ['pending', 'submitted', 'approved', 'disputed'];
const DISPUTE_RESOLUTIONS: DisputeResolution[] = ['pending', 'client_wins', 'agent_wins', 'split'];

export class EscrowRegistry {
  private rpc: JsonRpc;
  private session: ProtonSession | null;
  private contract: string;

  constructor(rpc: JsonRpc, session?: ProtonSession, contract?: string) {
    this.rpc = rpc;
    this.session = session || null;
    this.contract = contract || DEFAULT_CONTRACT;
  }

  // ============== READ OPERATIONS ==============

  /**
   * Get a job by ID
   */
  async getJob(id: number): Promise<Job | null> {
    const result = await this.rpc.get_table_rows<JobRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'jobs',
      lower_bound: String(id),
      upper_bound: String(id),
      limit: 1,
    });

    if (result.rows.length === 0) return null;
    return this.parseJob(result.rows[0]);
  }

  /**
   * List jobs for a client
   */
  async listJobsByClient(client: string, options: JobListOptions = {}): Promise<PaginatedResult<Job>> {
    const { limit = 100 } = options;

    // Use secondary index with client name as bounds to efficiently query
    // only rows for this client, instead of scanning from index position 0.
    const result = await this.rpc.get_table_rows<JobRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'jobs',
      index_position: 2, // byClient index
      key_type: 'name',
      lower_bound: client,
      upper_bound: client,
      limit: limit + 1,
    });

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    let jobs = rows.map(row => this.parseJob(row));

    if (options.state) {
      jobs = jobs.filter(j => j.state === options.state);
    }

    return {
      items: jobs,
      hasMore,
      nextCursor: hasMore && rows.length > 0 ? rows[rows.length - 1].id : undefined,
    };
  }

  /**
   * List jobs for an agent
   */
  async listJobsByAgent(agent: string, options: JobListOptions = {}): Promise<PaginatedResult<Job>> {
    const { limit = 100 } = options;

    // Use secondary index with agent name as bounds to efficiently query
    // only rows for this agent, instead of scanning from index position 0.
    const result = await this.rpc.get_table_rows<JobRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'jobs',
      index_position: 3, // byAgent index
      key_type: 'name',
      lower_bound: agent,
      upper_bound: agent,
      limit: limit + 1,
    });

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    let jobs = rows.map(row => this.parseJob(row));

    if (options.state) {
      jobs = jobs.filter(j => j.state === options.state);
    }

    return {
      items: jobs,
      hasMore,
      nextCursor: hasMore && rows.length > 0 ? rows[rows.length - 1].id : undefined,
    };
  }

  /**
   * Get milestones for a job
   */
  async getJobMilestones(jobId: number): Promise<Milestone[]> {
    const result = await this.rpc.get_table_rows<MilestoneRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'milestones',
      index_position: 2, // byJob index
      key_type: 'i64',
      lower_bound: String(jobId),
      upper_bound: String(jobId),
      limit: 100,
    });

    return result.rows
      .map(row => this.parseMilestone(row))
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Get dispute for a job
   */
  async getJobDispute(jobId: number): Promise<EscrowDispute | null> {
    const result = await this.rpc.get_table_rows<{
      id: string;
      job_id: string;
      raised_by: string;
      reason: string;
      evidence_uri: string;
      client_amount: string;
      agent_amount: string;
      resolution: number;
      resolver: string;
      resolution_notes: string;
      created_at: string;
      resolved_at: string;
    }>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'disputes',
      index_position: 2, // byJob index
      key_type: 'i64',
      lower_bound: String(jobId),
      upper_bound: String(jobId),
      limit: 100,
    });

    const dispute = result.rows[0];
    if (!dispute) return null;

    return {
      id: safeParseInt(dispute.id),
      job_id: safeParseInt(dispute.job_id),
      raised_by: dispute.raised_by,
      reason: dispute.reason,
      evidence_uri: dispute.evidence_uri,
      client_amount: safeParseInt(dispute.client_amount),
      agent_amount: safeParseInt(dispute.agent_amount),
      resolution: DISPUTE_RESOLUTIONS[dispute.resolution],
      resolver: dispute.resolver,
      resolution_notes: dispute.resolution_notes,
      created_at: safeParseInt(dispute.created_at),
      resolved_at: safeParseInt(dispute.resolved_at),
    };
  }

  /**
   * List available arbitrators
   */
  async listArbitrators(): Promise<Arbitrator[]> {
    const result = await this.rpc.get_table_rows<{
      account: string;
      stake: string;
      fee_percent: string;
      total_cases: string;
      successful_cases: string;
      active_disputes: string;
      active: number;
    }>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'arbitrators',
      limit: 100,
    });

    return result.rows
      .filter(row => row.active === 1)
      .map(row => ({
        account: row.account,
        stake: safeParseInt(row.stake),
        fee_percent: safeParseInt(row.fee_percent),
        total_cases: safeParseInt(row.total_cases),
        successful_cases: safeParseInt(row.successful_cases),
        active_disputes: safeParseInt(row.active_disputes),
        active: true,
      }));
  }

  // ============== WRITE OPERATIONS ==============

  /**
   * Create a new job
   */
  async createJob(data: CreateJobData): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'createjob',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          client: this.session!.auth.actor,
          agent: data.agent || '',
          title: data.title,
          description: data.description,
          deliverables: JSON.stringify(data.deliverables),
          amount: data.amount,
          symbol: data.symbol || 'XPR',
          deadline: data.deadline || 0,
          arbitrator: data.arbitrator || '',
          job_hash: data.job_hash || '',
        },
      }],
    });
  }

  /**
   * Fund a job
   */
  async fundJob(jobId: number, amount: string): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: 'eosio.token',
        name: 'transfer',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          from: this.session!.auth.actor,
          to: this.contract,
          quantity: amount,
          memo: `fund:${jobId}`,
        },
      }],
    });
  }

  /**
   * Accept a job (as agent)
   */
  async acceptJob(jobId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'acceptjob',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          agent: this.session!.auth.actor,
          job_id: jobId,
        },
      }],
    });
  }

  /**
   * Start working on a job (as agent)
   */
  async startJob(jobId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'startjob',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          agent: this.session!.auth.actor,
          job_id: jobId,
        },
      }],
    });
  }

  /**
   * Deliver a job (as agent)
   */
  async deliverJob(jobId: number, evidenceUri: string): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'deliver',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          agent: this.session!.auth.actor,
          job_id: jobId,
          evidence_uri: evidenceUri,
        },
      }],
    });
  }

  /**
   * Send a delivered job back to the agent for changes (as client).
   * DELIVERED -> INPROGRESS. Only valid inside the dispute window.
   */
  async reviseJob(jobId: number, notes: string): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'revise',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          client: this.session!.auth.actor,
          job_id: jobId,
          notes,
        },
      }],
    });
  }

  /**
   * Approve delivery (as client)
   */
  async approveDelivery(jobId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'approve',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          client: this.session!.auth.actor,
          job_id: jobId,
        },
      }],
    });
  }

  /**
   * Add a milestone to a job
   */
  async addMilestone(data: AddMilestoneData): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'addmilestone',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          client: this.session!.auth.actor,
          job_id: data.job_id,
          title: data.title,
          description: data.description,
          amount: data.amount,
          order: data.order,
        },
      }],
    });
  }

  /**
   * Submit a milestone (as agent)
   */
  async submitMilestone(milestoneId: number, evidenceUri: string): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'submitmile',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          agent: this.session!.auth.actor,
          milestone_id: milestoneId,
          evidence_uri: evidenceUri,
        },
      }],
    });
  }

  /**
   * Approve a milestone (as client)
   */
  async approveMilestone(milestoneId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'approvemile',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          client: this.session!.auth.actor,
          milestone_id: milestoneId,
        },
      }],
    });
  }

  /**
   * Raise a dispute
   */
  async raiseDispute(jobId: number, reason: string, evidenceUri?: string): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'dispute',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          raised_by: this.session!.auth.actor,
          job_id: jobId,
          reason,
          evidence_uri: evidenceUri || '',
        },
      }],
    });
  }

  /**
   * Cancel a job (as client)
   */
  async cancelJob(jobId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'cancel',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          client: this.session!.auth.actor,
          job_id: jobId,
        },
      }],
    });
  }

  /**
   * Claim timeout (refund or auto-approve)
   */
  async claimTimeout(jobId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'timeout',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          claimer: this.session!.auth.actor,
          job_id: jobId,
        },
      }],
    });
  }

  /**
   * Claim acceptance timeout refund (as client)
   */
  async claimAcceptanceTimeout(jobId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'accpttimeout',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          client: this.session!.auth.actor,
          job_id: jobId,
        },
      }],
    });
  }

  // ============== BIDDING ==============

  /**
   * List open jobs (agent not assigned)
   */
  async listOpenJobs(options: JobListOptions = {}): Promise<PaginatedResult<Job>> {
    const { limit = 100, cursor } = options;

    // Open jobs are sparse in the table — we must paginate through all rows
    // to find enough open jobs (agent is empty), not just fetch `limit` rows.
    const BATCH_SIZE = 100;
    let lowerBound = cursor;
    let openJobs: Job[] = [];
    let tableHasMore = true;

    while (openJobs.length < limit && tableHasMore) {
      const result = await this.rpc.get_table_rows<JobRaw>({
        json: true,
        code: this.contract,
        scope: this.contract,
        table: 'jobs',
        lower_bound: lowerBound,
        limit: BATCH_SIZE,
      });

      if (result.rows.length === 0) {
        tableHasMore = false;
        break;
      }

      tableHasMore = result.rows.length === BATCH_SIZE;
      lowerBound = result.rows[result.rows.length - 1].id + 1;

      // Filter for empty agent AND only CREATED state (0) by default.
      // Refunded/completed jobs with empty agent are not truly "open".
      const targetState = options.state ?? 'created';
      let batch = result.rows
        .filter(row => row.agent === '' || row.agent === '.............')
        .map(row => this.parseJob(row))
        .filter(j => j.state === targetState);

      openJobs.push(...batch);
    }

    const hasMore = openJobs.length > limit || tableHasMore;
    const items = openJobs.slice(0, limit);

    return {
      items,
      hasMore,
      nextCursor: hasMore && items.length > 0 ? String(items[items.length - 1].id + 1) : undefined,
    };
  }

  /**
   * Get evidence URI for a delivered job (stored in separate jobevidence table)
   */
  async getJobEvidence(jobId: number): Promise<string | null> {
    const result = await this.rpc.get_table_rows<{ job_id: string; evidence_uri: string }>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'jobevidence',
      lower_bound: String(jobId),
      upper_bound: String(jobId),
      limit: 1,
    });

    if (result.rows.length > 0) {
      return result.rows[0].evidence_uri;
    }
    return null;
  }

  /**
   * List bids for a job
   */
  async listBidsForJob(jobId: number): Promise<Bid[]> {
    const result = await this.rpc.get_table_rows<BidRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'bids',
      index_position: 2, // byJob index
      key_type: 'i64',
      lower_bound: String(jobId),
      upper_bound: String(jobId),
      limit: 100,
    });

    return result.rows
      .map(row => this.parseBid(row));
  }

  /**
   * Get a specific bid
   */
  async getBid(id: number): Promise<Bid | null> {
    const result = await this.rpc.get_table_rows<BidRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'bids',
      lower_bound: String(id),
      upper_bound: String(id),
      limit: 1,
    });

    if (result.rows.length === 0) return null;
    return this.parseBid(result.rows[0]);
  }

  /**
   * Submit a bid on an open job (as agent)
   */
  async submitBid(data: SubmitBidData): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'submitbid',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          agent: this.session!.auth.actor,
          job_id: data.job_id,
          amount: data.amount,
          timeline: data.timeline,
          proposal: data.proposal,
        },
      }],
    });
  }

  /**
   * Select a bid (as client) — assigns the agent to the job
   */
  async selectBid(bidId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'selectbid',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          client: this.session!.auth.actor,
          bid_id: bidId,
        },
      }],
    });
  }

  /**
   * Withdraw a bid (as agent)
   */
  async withdrawBid(bidId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'withdrawbid',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          agent: this.session!.auth.actor,
          bid_id: bidId,
        },
      }],
    });
  }

  // ============== ARBITRATOR MANAGEMENT ==============

  /**
   * Register as an arbitrator
   */
  async registerArbitrator(feePercent: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'regarb',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          account: this.session!.auth.actor,
          fee_percent: feePercent,
        },
      }],
    });
  }

  /**
   * Stake XPR as arbitrator (via token transfer)
   *
   * @param amount - Amount string (e.g., "1000.0000 XPR")
   */
  async stakeArbitrator(amount: string): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: 'eosio.token',
        name: 'transfer',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          from: this.session!.auth.actor,
          to: this.contract,
          quantity: amount,
          memo: 'arbstake',
        },
      }],
    });
  }

  /**
   * Arbitrate a dispute
   *
   * @param disputeId - The dispute to resolve
   * @param clientPercent - Percentage of remaining funds to give to client (0-100)
   * @param resolutionNotes - Explanation of the resolution
   */
  async arbitrate(
    disputeId: number,
    clientPercent: number,
    resolutionNotes: string
  ): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'arbitrate',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          arbitrator: this.session!.auth.actor,
          dispute_id: disputeId,
          client_percent: clientPercent,
          resolution_notes: resolutionNotes,
        },
      }],
    });
  }

  /**
   * Resolve a dispute after timeout (owner-only fallback).
   * Can only be called after 14 days since dispute creation.
   *
   * @param disputeId - The dispute to resolve
   * @param clientPercent - Percentage of remaining funds to give to client (0-100)
   * @param resolutionNotes - Explanation of the resolution
   */
  async resolveTimeout(
    disputeId: number,
    clientPercent: number,
    resolutionNotes: string
  ): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'resolvetmout',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          dispute_id: disputeId,
          client_percent: clientPercent,
          resolution_notes: resolutionNotes,
        },
      }],
    });
  }

  /**
   * Activate arbitrator (must have sufficient stake)
   */
  async activateArbitrator(): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'activatearb',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          account: this.session!.auth.actor,
        },
      }],
    });
  }

  /**
   * Deactivate arbitrator (stop accepting new cases)
   */
  async deactivateArbitrator(): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'deactarb',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          account: this.session!.auth.actor,
        },
      }],
    });
  }

  /**
   * Request to unstake arbitrator funds (7-day delay).
   * Must be deactivated and have no pending disputes first.
   *
   * @param amount - Amount to unstake in smallest units (e.g., 10000 = 1.0000 XPR)
   */
  async unstakeArbitrator(amount: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'unstakearb',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          account: this.session!.auth.actor,
          amount,
        },
      }],
    });
  }

  /**
   * Withdraw unstaked arbitrator funds (after 7-day delay)
   */
  async withdrawArbitratorStake(): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'withdrawarb',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          account: this.session!.auth.actor,
        },
      }],
    });
  }

  /**
   * Cancel a pending unstake request (returns funds to active stake)
   */
  async cancelArbitratorUnstake(): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'cancelunstk',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          account: this.session!.auth.actor,
        },
      }],
    });
  }

  /**
   * Clean up completed jobs (contract owner only)
   */
  async cleanJobs(maxAge: number, maxDelete: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'cleanjobs',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          max_age: maxAge,
          max_delete: maxDelete,
        },
      }],
    });
  }

  /**
   * Clean up resolved disputes (contract owner only)
   */
  async cleanDisputes(maxAge: number, maxDelete: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'cleandisps',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          max_age: maxAge,
          max_delete: maxDelete,
        },
      }],
    });
  }

  // ============== SERVICES ==============

  /**
   * Read the `svcconfig` singleton (listing fee + featured-placement settings).
   * Falls back to the contract defaults when the row has not been set yet, so
   * callers can price a listing before the owner runs `setsvcconfig`.
   */
  async getServiceConfig(): Promise<ServiceConfig> {
    const result = await this.rpc.get_table_rows<{
      service_fee: string;
      boost_min: string;
      boost_rate: string;
    }>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'svcconfig',
      limit: 1,
    });

    const row = result.rows[0];
    return {
      service_fee: safeParseInt(row?.service_fee, DEFAULT_SERVICE_FEE),
      boost_min: safeParseInt(row?.boost_min, DEFAULT_BOOST_MIN),
      boost_rate: safeParseInt(row?.boost_rate, DEFAULT_BOOST_RATE),
    };
  }

  /**
   * Get a service listing by ID
   */
  async getService(id: number): Promise<Service | null> {
    const result = await this.rpc.get_table_rows<ServiceRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'services',
      lower_bound: String(id),
      upper_bound: String(id),
      limit: 1,
    });

    if (result.rows.length === 0) return null;
    return this.parseService(result.rows[0]);
  }

  /**
   * List service listings (catalogue). `activeOnly` defaults to true.
   */
  async listServices(options: ServiceListOptions = {}): Promise<PaginatedResult<Service>> {
    const { limit = 100, activeOnly = true } = options;

    const result = await this.rpc.get_table_rows<ServiceRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'services',
      limit: limit + 1,
    });

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    let services = rows.map(row => this.parseService(row));

    if (activeOnly) {
      services = services.filter(s => s.active);
    }

    return {
      items: services,
      hasMore,
      nextCursor: hasMore && rows.length > 0 ? rows[rows.length - 1].id : undefined,
    };
  }

  /**
   * List every service published by an agent (active and delisted)
   */
  async listServicesByAgent(agent: string): Promise<Service[]> {
    const result = await this.rpc.get_table_rows<ServiceRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'services',
      index_position: 2, // byAgent index
      key_type: 'name',
      lower_bound: agent,
      upper_bound: agent,
      limit: 100,
    });

    return result.rows.map(row => this.parseService(row));
  }

  /**
   * Publish a service listing (as agent)
   */
  async listService(data: ServiceData): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [this.listServiceAction(data)],
    });
  }

  /**
   * Update an existing service listing (as agent)
   */
  async updateService(serviceId: number, data: ServiceData): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'updatesvc',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          agent: this.session!.auth.actor,
          service_id: serviceId,
          title: data.title,
          description: data.description,
          deliverables: JSON.stringify(data.deliverables),
          price: data.price,
          turnaround: data.turnaround,
          category: data.category || '',
          sample_uri: data.sampleUri || '',
        },
      }],
    });
  }

  /**
   * Delist a service (sets active = false; the row is kept for history)
   */
  async delistService(serviceId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'delistsvc',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          agent: this.session!.auth.actor,
          service_id: serviceId,
        },
      }],
    });
  }

  /**
   * Relist a previously delisted service (sets active = true)
   */
  async relistService(serviceId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'relistsvc',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          agent: this.session!.auth.actor,
          service_id: serviceId,
        },
      }],
    });
  }

  /**
   * Pay the listing fee up front: a transfer with memo `svcfee:<agent>` that
   * credits a `svcdeposits` row. `listsvc` then consumes the deposit.
   *
   * @param amountRaw fee in raw units — use `getServiceConfig().service_fee`
   */
  async payServiceFee(amountRaw: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [this.serviceFeeAction(amountRaw)],
    });
  }

  /**
   * Reclaim a listing-fee deposit that was never consumed (7 days after payment)
   */
  async refundServiceFee(): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'refundsvcfee',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          agent: this.session!.auth.actor,
        },
      }],
    });
  }

  /**
   * Pay the listing fee and publish the listing in ONE transaction.
   * Either both actions apply or neither does, so a failed `listsvc` never
   * leaves an orphaned deposit behind.
   */
  async listServiceWithFee(feeRaw: number, data: ServiceData): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        this.serviceFeeAction(feeRaw),
        this.listServiceAction(data),
      ],
    });
  }

  /**
   * Boost a listing into featured placement: a transfer with memo `boost:<id>`.
   * Each `boost_rate` of raw units buys one featured day. Anyone may boost, but
   * the listing must be active and its agent must have >= 1 completed job.
   *
   * @param amountRaw boost amount in raw units (>= `getServiceConfig().boost_min`)
   */
  async boostService(serviceId: number, amountRaw: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: 'eosio.token',
        name: 'transfer',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          from: this.session!.auth.actor,
          to: this.contract,
          quantity: `${(amountRaw / 10000).toFixed(4)} XPR`,
          memo: `boost:${serviceId}`,
        },
      }],
    });
  }

  /**
   * Buy a service: a single XPR transfer with memo `buy:<id>`.
   * The contract creates and funds the job in the same step.
   *
   * @param serviceId listing to buy
   * @param priceRaw  price in raw units (1 XPR = 10000) — use the listing's `price`
   */
  async buyService(serviceId: number, priceRaw: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: 'eosio.token',
        name: 'transfer',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          from: this.session!.auth.actor,
          to: this.contract,
          quantity: `${(priceRaw / 10000).toFixed(4)} XPR`,
          memo: `buy:${serviceId}`,
        },
      }],
    });
  }

  // ============== HELPERS ==============

  private requireSession(): void {
    if (!this.session) {
      throw new Error('Session required for write operations');
    }
  }

  /** `listsvc` action — shared by listService and listServiceWithFee */
  private listServiceAction(data: ServiceData): TransactAction {
    return {
      account: this.contract,
      name: 'listsvc',
      authorization: [{
        actor: this.session!.auth.actor,
        permission: this.session!.auth.permission,
      }],
      data: {
        agent: this.session!.auth.actor,
        title: data.title,
        description: data.description,
        deliverables: JSON.stringify(data.deliverables),
        price: data.price,
        turnaround: data.turnaround,
        category: data.category || '',
        sample_uri: data.sampleUri || '',
      },
    };
  }

  /** listing-fee deposit transfer — memo `svcfee:<agent>` */
  private serviceFeeAction(amountRaw: number): TransactAction {
    return {
      account: 'eosio.token',
      name: 'transfer',
      authorization: [{
        actor: this.session!.auth.actor,
        permission: this.session!.auth.permission,
      }],
      data: {
        from: this.session!.auth.actor,
        to: this.contract,
        quantity: `${(amountRaw / 10000).toFixed(4)} XPR`,
        memo: `svcfee:${this.session!.auth.actor}`,
      },
    };
  }

  private parseJob(raw: JobRaw): Job {
    let deliverables: string[] = [];
    try {
      deliverables = JSON.parse(raw.deliverables);
    } catch {
      deliverables = [];
    }

    return {
      id: safeParseInt(raw.id),
      client: raw.client,
      agent: raw.agent,
      title: raw.title,
      description: raw.description,
      deliverables,
      amount: safeParseInt(raw.amount),
      symbol: raw.symbol,
      funded_amount: safeParseInt(raw.funded_amount),
      released_amount: safeParseInt(raw.released_amount),
      state: JOB_STATES[raw.state] || 'created',
      deadline: safeParseInt(raw.deadline),
      arbitrator: raw.arbitrator,
      job_hash: raw.job_hash,
      created_at: safeParseInt(raw.created_at),
      updated_at: safeParseInt(raw.updated_at),
    };
  }

  private parseMilestone(raw: MilestoneRaw): Milestone {
    return {
      id: safeParseInt(raw.id),
      job_id: safeParseInt(raw.job_id),
      title: raw.title,
      description: raw.description,
      amount: safeParseInt(raw.amount),
      order: raw.order,
      state: MILESTONE_STATES[raw.state] || 'pending',
      evidence_uri: raw.evidence_uri,
      submitted_at: safeParseInt(raw.submitted_at),
      approved_at: safeParseInt(raw.approved_at),
    };
  }

  private parseBid(raw: BidRaw): Bid {
    return {
      id: safeParseInt(raw.id),
      job_id: safeParseInt(raw.job_id),
      agent: raw.agent,
      amount: safeParseInt(raw.amount),
      timeline: safeParseInt(raw.timeline),
      proposal: raw.proposal,
      created_at: safeParseInt(raw.created_at),
    };
  }

  private parseService(raw: ServiceRaw): Service {
    let deliverables: string[] = [];
    try {
      const parsed = JSON.parse(raw.deliverables);
      if (Array.isArray(parsed)) deliverables = parsed;
    } catch {
      deliverables = [];
    }

    return {
      id: safeParseInt(raw.id),
      agent: raw.agent,
      title: raw.title,
      description: raw.description,
      deliverables,
      price: safeParseInt(raw.price),
      turnaround: safeParseInt(raw.turnaround),
      category: raw.category,
      sample_uri: raw.sample_uri,
      active: !!raw.active,
      sales: safeParseInt(raw.sales),
      // Appended to the chain row after the first services release — absent on
      // rows written before the boost fields shipped, so default to 0.
      boostPaid: safeParseInt(raw.boost_paid),
      featuredUntil: safeParseInt(raw.featured_until),
      created_at: safeParseInt(raw.created_at),
      updated_at: safeParseInt(raw.updated_at),
    };
  }
}

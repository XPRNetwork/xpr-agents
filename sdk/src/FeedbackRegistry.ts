import {
  Feedback,
  FeedbackRaw,
  FeedbackConfig,
  AgentScore,
  AgentScoreRaw,
  Dispute,
  FeedbackListOptions,
  SubmitFeedbackData,
  TransactionResult,
  JsonRpc,
  ProtonSession,
} from './types';
import { parseTags, disputeStatusFromNumber } from './utils';

const DEFAULT_CONTRACT = 'agentfeed';

export class FeedbackRegistry {
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
   * Get feedback by ID
   */
  async getFeedback(id: number): Promise<Feedback | null> {
    const result = await this.rpc.get_table_rows<FeedbackRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'feedback',
      lower_bound: String(id),
      upper_bound: String(id),
      limit: 1,
    });

    if (result.rows.length === 0) return null;
    return this.parseFeedback(result.rows[0]);
  }

  /**
   * List feedback for an agent
   */
  async listFeedbackForAgent(
    agent: string,
    options: FeedbackListOptions = {}
  ): Promise<Feedback[]> {
    const { limit = 100 } = options;

    const result = await this.rpc.get_table_rows<FeedbackRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'feedback',
      index_position: 2,
      key_type: 'i64',
      limit,
    });

    let feedbacks = result.rows
      .filter((row) => row.agent === agent)
      .map((row) => this.parseFeedback(row));

    if (options.min_score !== undefined) {
      feedbacks = feedbacks.filter((f) => f.score >= options.min_score!);
    }

    if (options.max_score !== undefined) {
      feedbacks = feedbacks.filter((f) => f.score <= options.max_score!);
    }

    return feedbacks;
  }

  /**
   * List feedback submitted by a reviewer
   */
  async listFeedbackByReviewer(
    reviewer: string,
    options: FeedbackListOptions = {}
  ): Promise<Feedback[]> {
    const { limit = 100 } = options;

    const result = await this.rpc.get_table_rows<FeedbackRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'feedback',
      index_position: 3,
      key_type: 'i64',
      limit,
    });

    return result.rows
      .filter((row) => row.reviewer === reviewer)
      .map((row) => this.parseFeedback(row));
  }

  /**
   * Get aggregated score for an agent
   */
  async getAgentScore(agent: string): Promise<AgentScore | null> {
    const result = await this.rpc.get_table_rows<AgentScoreRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'agentscores',
      lower_bound: agent,
      upper_bound: agent,
      limit: 1,
    });

    if (result.rows.length === 0) return null;
    return this.parseAgentScore(result.rows[0]);
  }

  /**
   * Get dispute by ID
   */
  async getDispute(id: number): Promise<Dispute | null> {
    const result = await this.rpc.get_table_rows<{
      id: string;
      feedback_id: string;
      disputer: string;
      reason: string;
      evidence_uri: string;
      status: number;
      resolver: string;
      resolution_notes: string;
      created_at: string;
      resolved_at: string;
    }>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'disputes',
      lower_bound: String(id),
      upper_bound: String(id),
      limit: 1,
    });

    if (result.rows.length === 0) return null;
    return this.parseDispute(result.rows[0]);
  }

  /**
   * Get disputes for a feedback
   */
  async getDisputesForFeedback(feedbackId: number): Promise<Dispute[]> {
    const result = await this.rpc.get_table_rows<{
      id: string;
      feedback_id: string;
      disputer: string;
      reason: string;
      evidence_uri: string;
      status: number;
      resolver: string;
      resolution_notes: string;
      created_at: string;
      resolved_at: string;
    }>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'disputes',
      index_position: 2,
      key_type: 'i64',
      limit: 100,
    });

    return result.rows
      .filter((row) => row.feedback_id === String(feedbackId))
      .map((row) => this.parseDispute(row));
  }

  // ============== WRITE OPERATIONS ==============

  /**
   * Submit feedback for an agent
   */
  async submit(data: SubmitFeedbackData): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'submit',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            reviewer: this.session!.auth.actor,
            agent: data.agent,
            score: data.score,
            tags: (data.tags || []).join(','),
            job_hash: data.job_hash || '',
            evidence_uri: data.evidence_uri || '',
            amount_paid: data.amount_paid || 0,
          },
        },
      ],
    });
  }

  /**
   * Dispute feedback
   */
  async dispute(
    feedbackId: number,
    reason: string,
    evidenceUri?: string
  ): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'dispute',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            disputer: this.session!.auth.actor,
            feedback_id: feedbackId,
            reason,
            evidence_uri: evidenceUri || '',
          },
        },
      ],
    });
  }

  /**
   * Recalculate agent score (paginated).
   *
   * Recalculation is done in batches to avoid CPU exhaustion.
   * - First call: offset=0, processes first `limit` feedbacks
   * - Subsequent calls: use the next_offset from RecalcState
   * - Recalculation expires after 1 hour if not completed
   *
   * @param agent - Agent account to recalculate
   * @param offset - Must be 0 to start, or match next_offset to continue
   * @param limit - Feedbacks to process per call (max 100)
   */
  async recalculate(agent: string, offset: number = 0, limit: number = 100): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'recalc',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            agent,
            offset,
            limit,
          },
        },
      ],
    });
  }

  /**
   * Resolve a feedback dispute (owner only)
   */
  async resolve(
    disputeId: number,
    upheld: boolean,
    resolutionNotes: string
  ): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'resolve',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            resolver: this.session!.auth.actor,
            dispute_id: disputeId,
            upheld,
            resolution_notes: resolutionNotes,
          },
        },
      ],
    });
  }

  /**
   * Cancel an in-progress recalculation
   */
  async cancelRecalculation(agent: string): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'cancelrecalc',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            agent,
          },
        },
      ],
    });
  }

  /**
   * Submit feedback with fee in one transaction.
   *
   * @param data - Feedback data
   * @param amount - The feedback fee (e.g., "1.0000 XPR")
   */
  async submitWithFee(data: SubmitFeedbackData, amount: string): Promise<TransactionResult> {
    this.requireSession();

    const actor = this.session!.auth.actor;

    return this.session!.link.transact({
      actions: [
        {
          account: 'eosio.token',
          name: 'transfer',
          authorization: [{
            actor,
            permission: this.session!.auth.permission,
          }],
          data: {
            from: actor,
            to: this.contract,
            quantity: amount,
            memo: `feedfee:${actor}`,
          },
        },
        {
          account: this.contract,
          name: 'submit',
          authorization: [{
            actor,
            permission: this.session!.auth.permission,
          }],
          data: {
            reviewer: actor,
            agent: data.agent,
            score: data.score,
            tags: (data.tags || []).join(','),
            job_hash: data.job_hash || '',
            evidence_uri: data.evidence_uri || '',
            amount_paid: data.amount_paid || 0,
          },
        },
      ],
    });
  }

  /**
   * Clean up old feedback entries (permissionless)
   */
  async cleanFeedback(agent: string, maxAge: number, maxDelete: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'cleanfback',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          agent,
          max_age: maxAge,
          max_delete: maxDelete,
        },
      }],
    });
  }

  /**
   * Clean up resolved disputes (permissionless)
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

  /**
   * Get feedback contract configuration
   */
  async getConfig(): Promise<FeedbackConfig> {
    const result = await this.rpc.get_table_rows<{
      owner: string;
      core_contract: string;
      min_score: number;
      max_score: number;
      dispute_window: string;
      decay_period: string;
      decay_floor: string;
      paused: number;
      feedback_fee: string;
    }>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'config',
      limit: 1,
    });

    if (result.rows.length === 0) {
      throw new Error('Contract not initialized');
    }

    const row = result.rows[0];
    return {
      owner: row.owner,
      core_contract: row.core_contract,
      min_score: row.min_score,
      max_score: row.max_score,
      dispute_window: parseInt(row.dispute_window),
      decay_period: parseInt(row.decay_period),
      decay_floor: parseInt(row.decay_floor),
      paused: row.paused === 1,
      feedback_fee: parseInt(row.feedback_fee || '0'),
    };
  }

  // ============== HELPERS ==============

  private requireSession(): void {
    if (!this.session) {
      throw new Error('Session required for write operations');
    }
  }

  private parseFeedback(raw: FeedbackRaw): Feedback {
    return {
      id: parseInt(raw.id),
      agent: raw.agent,
      reviewer: raw.reviewer,
      reviewer_kyc_level: raw.reviewer_kyc_level,
      score: raw.score,
      tags: parseTags(raw.tags),
      job_hash: raw.job_hash,
      evidence_uri: raw.evidence_uri,
      amount_paid: parseInt(raw.amount_paid),
      timestamp: parseInt(raw.timestamp),
      disputed: raw.disputed === 1,
      resolved: raw.resolved === 1,
    };
  }

  private parseAgentScore(raw: AgentScoreRaw): AgentScore {
    return {
      agent: raw.agent,
      total_score: parseInt(raw.total_score),
      total_weight: parseInt(raw.total_weight),
      feedback_count: parseInt(raw.feedback_count),
      avg_score: parseInt(raw.avg_score),
      last_updated: parseInt(raw.last_updated),
    };
  }

  private parseDispute(raw: {
    id: string;
    feedback_id: string;
    disputer: string;
    reason: string;
    evidence_uri: string;
    status: number;
    resolver: string;
    resolution_notes: string;
    created_at: string;
    resolved_at: string;
  }): Dispute {
    return {
      id: parseInt(raw.id),
      feedback_id: parseInt(raw.feedback_id),
      disputer: raw.disputer,
      reason: raw.reason,
      evidence_uri: raw.evidence_uri,
      status: disputeStatusFromNumber(raw.status),
      resolver: raw.resolver,
      resolution_notes: raw.resolution_notes,
      created_at: parseInt(raw.created_at),
      resolved_at: parseInt(raw.resolved_at),
    };
  }
}

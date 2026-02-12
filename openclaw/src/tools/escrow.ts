/**
 * Escrow tools (20 tools)
 * Reads: xpr_get_job, xpr_list_jobs, xpr_list_open_jobs, xpr_get_milestones,
 *        xpr_get_job_dispute, xpr_list_arbitrators, xpr_list_bids
 * Writes: xpr_create_job, xpr_fund_job, xpr_accept_job, xpr_start_job,
 *         xpr_deliver_job, xpr_approve_delivery, xpr_raise_dispute,
 *         xpr_submit_milestone, xpr_arbitrate, xpr_resolve_timeout,
 *         xpr_submit_bid, xpr_select_bid, xpr_withdraw_bid
 */

import { EscrowRegistry } from '@xpr-agents/sdk';
import type { PluginApi, PluginConfig } from '../types';
import {
  validateAccountName,
  validateRequired,
  validatePositiveInt,
  validateClientPercent,
  validateAmount,
  validateUrl,
  xprToSmallestUnits,
} from '../util/validate';
import { needsConfirmation } from '../util/confirm';

/** Convert raw on-chain amounts (e.g. 150000) to XPR (e.g. 15) for display */
function jobToXpr(job: Record<string, unknown>): Record<string, unknown> {
  return {
    ...job,
    amount_xpr: typeof job.amount === 'number' ? job.amount / 10000 : job.amount,
    funded_amount_xpr: typeof job.funded_amount === 'number' ? job.funded_amount / 10000 : job.funded_amount,
    released_amount_xpr: typeof job.released_amount === 'number' ? job.released_amount / 10000 : job.released_amount,
  };
}

function bidToXpr(bid: Record<string, unknown>): Record<string, unknown> {
  return {
    ...bid,
    amount_xpr: typeof bid.amount === 'number' ? bid.amount / 10000 : bid.amount,
  };
}

export function registerEscrowTools(api: PluginApi, config: PluginConfig): void {
  const contracts = config.contracts;

  // ---- READ TOOLS ----

  api.registerTool({
    name: 'xpr_get_job',
    description: 'Get detailed information about an escrow job including state, funding, and deadlines. States: 0=CREATED, 1=FUNDED, 2=ACCEPTED, 3=INPROGRESS, 4=DELIVERED, 5=DISPUTED, 6=COMPLETED, 7=REFUNDED, 8=ARBITRATED. Amounts (amount_xpr, funded_amount_xpr, released_amount_xpr) are in XPR.',
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'number', description: 'Job ID' },
      },
    },
    handler: async ({ id }: { id: number }) => {
      validatePositiveInt(id, 'id');
      const registry = new EscrowRegistry(config.rpc, undefined, contracts.agentescrow);
      const job = await registry.getJob(id);
      if (!job) {
        return { error: `Job #${id} not found` };
      }
      return jobToXpr(job as unknown as Record<string, unknown>);
    },
  });

  api.registerTool({
    name: 'xpr_list_jobs',
    description: 'List escrow jobs with optional filtering by client, agent, or state.',
    parameters: {
      type: 'object',
      properties: {
        client: { type: 'string', description: 'Filter by client account' },
        agent: { type: 'string', description: 'Filter by agent account' },
        state: {
          type: 'string',
          enum: ['created', 'funded', 'accepted', 'inprogress', 'delivered', 'disputed', 'completed', 'refunded', 'arbitrated'],
          description: 'Filter by state',
        },
        limit: { type: 'number', description: 'Max results (default 20, max 100)' },
      },
    },
    handler: async ({ client, agent, state, limit = 20 }: {
      client?: string;
      agent?: string;
      state?: string;
      limit?: number;
    }) => {
      if (client) validateAccountName(client, 'client');
      if (agent) validateAccountName(agent, 'agent');

      const registry = new EscrowRegistry(config.rpc, undefined, contracts.agentescrow);
      const convertList = (result: { items: unknown[]; hasMore: boolean }) => ({
        items: result.items.map(j => jobToXpr(j as Record<string, unknown>)),
        hasMore: result.hasMore,
      });

      if (client) {
        return convertList(await registry.listJobsByClient(client, { limit: Math.min(limit, 100) }));
      }
      if (agent) {
        return convertList(await registry.listJobsByAgent(agent, { limit: Math.min(limit, 100) }));
      }

      // For general listing, use client query with the session actor if available
      const account = config.session?.auth.actor;
      if (account) {
        // List jobs where we are either client or agent
        const [asClient, asAgent] = await Promise.all([
          registry.listJobsByClient(account, { limit: Math.min(limit, 100) }),
          registry.listJobsByAgent(account, { limit: Math.min(limit, 100) }),
        ]);
        const allJobs = [...asClient.items, ...asAgent.items];
        const unique = allJobs.filter((j, i, arr) => arr.findIndex((x: any) => x.id === (j as any).id) === i);
        const filtered = state !== undefined ? unique.filter((j: any) => j.state === state) : unique;
        return { items: filtered.slice(0, limit).map(j => jobToXpr(j as unknown as Record<string, unknown>)), hasMore: filtered.length > limit };
      }

      return { items: [], hasMore: false, message: 'Provide client or agent filter, or set XPR_ACCOUNT env var' };
    },
  });

  api.registerTool({
    name: 'xpr_get_milestones',
    description: 'Get all milestones for a job.',
    parameters: {
      type: 'object',
      required: ['job_id'],
      properties: {
        job_id: { type: 'number', description: 'Job ID' },
      },
    },
    handler: async ({ job_id }: { job_id: number }) => {
      validatePositiveInt(job_id, 'job_id');
      const registry = new EscrowRegistry(config.rpc, undefined, contracts.agentescrow);
      const milestones = await registry.getJobMilestones(job_id);
      return { milestones, count: milestones.length };
    },
  });

  api.registerTool({
    name: 'xpr_get_job_dispute',
    description: 'Get the dispute associated with a job, if any.',
    parameters: {
      type: 'object',
      required: ['job_id'],
      properties: {
        job_id: { type: 'number', description: 'Job ID' },
      },
    },
    handler: async ({ job_id }: { job_id: number }) => {
      validatePositiveInt(job_id, 'job_id');
      const registry = new EscrowRegistry(config.rpc, undefined, contracts.agentescrow);
      const dispute = await registry.getJobDispute(job_id);
      if (!dispute) {
        return { message: `No dispute found for job #${job_id}` };
      }
      return dispute;
    },
  });

  api.registerTool({
    name: 'xpr_list_arbitrators',
    description: 'List all registered arbitrators with their stake, fee, and case history.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      const registry = new EscrowRegistry(config.rpc, undefined, contracts.agentescrow);
      const arbitrators = await registry.listArbitrators();
      return { arbitrators, count: arbitrators.length };
    },
  });

  // ---- WRITE TOOLS ----

  api.registerTool({
    name: 'xpr_create_job',
    description: 'Create a new escrow job. Omit agent to create an open job that any agent can bid on. After creation, fund it with xpr_fund_job.',
    parameters: {
      type: 'object',
      required: ['title', 'description', 'deliverables', 'amount'],
      properties: {
        agent: { type: 'string', description: 'Agent account (omit or empty for open job board)' },
        title: { type: 'string', description: 'Job title' },
        description: { type: 'string', description: 'Detailed job description' },
        deliverables: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of expected deliverables',
        },
        amount: { type: 'number', description: 'Total job amount in XPR (e.g., 5000.0)' },
        deadline: { type: 'number', description: 'Unix timestamp deadline (0 = no deadline)' },
        arbitrator: { type: 'string', description: 'Arbitrator account (empty = contract owner as fallback)' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async (params: {
      agent?: string;
      title: string;
      description: string;
      deliverables: string[];
      amount: number;
      deadline?: number;
      arbitrator?: string;
      confirmed?: boolean;
    }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      if (params.agent) validateAccountName(params.agent, 'agent');
      validateRequired(params.title, 'title');
      if (params.amount <= 0) throw new Error('amount must be positive');
      validateAmount(xprToSmallestUnits(params.amount), config.maxTransferAmount);
      if (params.arbitrator) validateAccountName(params.arbitrator, 'arbitrator');

      const isOpen = !params.agent;
      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        params.confirmed,
        'Create Job',
        {
          type: isOpen ? 'OPEN (any agent can bid)' : 'DIRECT-HIRE',
          agent: params.agent || '(open for bids)',
          title: params.title,
          amount: `${params.amount} XPR`,
          arbitrator: params.arbitrator || '(contract owner fallback)',
        },
        isOpen
          ? `Create open job "${params.title}" worth ${params.amount} XPR (agents will bid)`
          : `Create job "${params.title}" for agent ${params.agent} worth ${params.amount} XPR`
      );
      if (confirmation) return confirmation;

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.createJob({
        agent: params.agent || '',
        title: params.title,
        description: params.description,
        deliverables: params.deliverables,
        amount: xprToSmallestUnits(params.amount),
        deadline: params.deadline || 0,
        arbitrator: params.arbitrator || '',
      });
    },
  });

  api.registerTool({
    name: 'xpr_fund_job',
    description: 'Fund an escrow job by transferring XPR. Job moves from CREATED to FUNDED when fully funded.',
    parameters: {
      type: 'object',
      required: ['job_id', 'amount'],
      properties: {
        job_id: { type: 'number', description: 'Job ID to fund' },
        amount: { type: 'number', description: 'Amount to send in XPR (e.g., 5000.0)' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async ({ job_id, amount, confirmed }: { job_id: number; amount: number; confirmed?: boolean }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      validatePositiveInt(job_id, 'job_id');
      if (amount <= 0) throw new Error('amount must be positive');
      validateAmount(xprToSmallestUnits(amount), config.maxTransferAmount);

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Fund Job',
        { job_id, amount: `${amount} XPR` },
        `Send ${amount} XPR to fund job #${job_id}`
      );
      if (confirmation) return confirmation;

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.fundJob(job_id, `${amount.toFixed(4)} XPR`);
    },
  });

  api.registerTool({
    name: 'xpr_accept_job',
    description: 'Accept a funded job as the assigned agent.',
    parameters: {
      type: 'object',
      required: ['job_id'],
      properties: {
        job_id: { type: 'number', description: 'Job ID to accept' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async ({ job_id, confirmed }: { job_id: number; confirmed?: boolean }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      validatePositiveInt(job_id, 'job_id');

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Accept Job',
        { job_id },
        `Accept job #${job_id} — you will be responsible for completing the deliverables`
      );
      if (confirmation) return confirmation;

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.acceptJob(job_id);
    },
  });

  api.registerTool({
    name: 'xpr_start_job',
    description: 'Start working on an accepted job. Moves job from ACCEPTED to INPROGRESS state. Only the assigned agent can start.',
    parameters: {
      type: 'object',
      required: ['job_id'],
      properties: {
        job_id: { type: 'number', description: 'Job ID to start' },
      },
    },
    handler: async ({ job_id }: { job_id: number }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      validatePositiveInt(job_id, 'job_id');
      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.startJob(job_id);
    },
  });

  api.registerTool({
    name: 'xpr_deliver_job',
    description: 'Submit job deliverables for client review. Moves job to DELIVERED state. When delivering NFTs, provide nft_asset_ids and nft_collection to auto-format the deliverable as an NFT card in the frontend.',
    parameters: {
      type: 'object',
      required: ['job_id', 'evidence_uri'],
      properties: {
        job_id: { type: 'number', description: 'Job ID' },
        evidence_uri: { type: 'string', description: 'URI to deliverables/evidence (IPFS/Arweave)' },
        nft_asset_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'AtomicAssets asset IDs to include as NFT deliverable (auto-formats JSON envelope)',
        },
        nft_collection: { type: 'string', description: 'Collection name for the NFT deliverable (used with nft_asset_ids)' },
      },
    },
    handler: async ({ job_id, evidence_uri, nft_asset_ids, nft_collection }: {
      job_id: number;
      evidence_uri: string;
      nft_asset_ids?: string[];
      nft_collection?: string;
    }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      validatePositiveInt(job_id, 'job_id');
      validateRequired(evidence_uri, 'evidence_uri');

      let finalUri = evidence_uri;
      if (nft_asset_ids && nft_asset_ids.length > 0) {
        finalUri = JSON.stringify({
          type: 'nft',
          asset_ids: nft_asset_ids,
          collection: nft_collection || '',
          evidence: evidence_uri,
        });
      } else {
        validateUrl(evidence_uri, 'evidence_uri');
      }

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.deliverJob(job_id, finalUri);
    },
  });

  api.registerTool({
    name: 'xpr_approve_delivery',
    description: 'Approve a delivered job and release payment to the agent. Only the client can approve.',
    parameters: {
      type: 'object',
      required: ['job_id'],
      properties: {
        job_id: { type: 'number', description: 'Job ID to approve' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async ({ job_id, confirmed }: { job_id: number; confirmed?: boolean }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      validatePositiveInt(job_id, 'job_id');

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Approve Delivery',
        { job_id },
        `Approve delivery for job #${job_id} and release payment to agent`
      );
      if (confirmation) return confirmation;

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.approveDelivery(job_id);
    },
  });

  api.registerTool({
    name: 'xpr_raise_dispute',
    description: 'Raise a dispute on a job. Either client or agent can dispute.',
    parameters: {
      type: 'object',
      required: ['job_id', 'reason'],
      properties: {
        job_id: { type: 'number', description: 'Job ID to dispute' },
        reason: { type: 'string', description: 'Reason for the dispute' },
        evidence_uri: { type: 'string', description: 'URI to supporting evidence' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async ({ job_id, reason, evidence_uri, confirmed }: {
      job_id: number;
      reason: string;
      evidence_uri?: string;
      confirmed?: boolean;
    }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      validatePositiveInt(job_id, 'job_id');
      validateRequired(reason, 'reason');

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Raise Dispute',
        { job_id, reason },
        `Raise dispute on job #${job_id}: "${reason}"`
      );
      if (confirmation) return confirmation;

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.raiseDispute(job_id, reason, evidence_uri);
    },
  });

  api.registerTool({
    name: 'xpr_submit_milestone',
    description: 'Submit evidence for a job milestone.',
    parameters: {
      type: 'object',
      required: ['milestone_id', 'evidence_uri'],
      properties: {
        milestone_id: { type: 'number', description: 'Milestone ID' },
        evidence_uri: { type: 'string', description: 'URI to milestone deliverables' },
      },
    },
    handler: async ({ milestone_id, evidence_uri }: { milestone_id: number; evidence_uri: string }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      validatePositiveInt(milestone_id, 'milestone_id');
      validateRequired(evidence_uri, 'evidence_uri');
      validateUrl(evidence_uri, 'evidence_uri');
      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.submitMilestone(milestone_id, evidence_uri);
    },
  });

  api.registerTool({
    name: 'xpr_arbitrate',
    description: 'Resolve a dispute as the assigned arbitrator. Splits funds between client and agent based on client_percent.',
    parameters: {
      type: 'object',
      required: ['dispute_id', 'client_percent', 'resolution_notes'],
      properties: {
        dispute_id: { type: 'number', description: 'Dispute ID to resolve' },
        client_percent: { type: 'number', description: 'Percentage of funds to client (0-100, remainder to agent)' },
        resolution_notes: { type: 'string', description: 'Explanation of the resolution decision' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async ({ dispute_id, client_percent, resolution_notes, confirmed }: {
      dispute_id: number;
      client_percent: number;
      resolution_notes: string;
      confirmed?: boolean;
    }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      validatePositiveInt(dispute_id, 'dispute_id');
      validateClientPercent(client_percent);
      validateRequired(resolution_notes, 'resolution_notes');

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Arbitrate Dispute',
        { dispute_id, client_percent, agent_percent: 100 - client_percent },
        `Resolve dispute #${dispute_id}: ${client_percent}% to client, ${100 - client_percent}% to agent`
      );
      if (confirmation) return confirmation;

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.arbitrate(dispute_id, client_percent, resolution_notes);
    },
  });

  api.registerTool({
    name: 'xpr_resolve_timeout',
    description: 'Resolve a dispute after the 14-day timeout period (contract owner only). Splits remaining funds between client and agent with 0% arbitrator fee.',
    parameters: {
      type: 'object',
      required: ['dispute_id', 'client_percent', 'resolution_notes'],
      properties: {
        dispute_id: { type: 'number', description: 'Dispute ID to resolve' },
        client_percent: { type: 'number', description: 'Percentage of funds to client (0-100, remainder to agent)' },
        resolution_notes: { type: 'string', description: 'Explanation of the resolution decision (1-1024 chars)' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async ({ dispute_id, client_percent, resolution_notes, confirmed }: {
      dispute_id: number;
      client_percent: number;
      resolution_notes: string;
      confirmed?: boolean;
    }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      validatePositiveInt(dispute_id, 'dispute_id');
      validateClientPercent(client_percent);
      validateRequired(resolution_notes, 'resolution_notes');

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Resolve Dispute Timeout',
        { dispute_id, client_percent, agent_percent: 100 - client_percent },
        `Resolve timed-out dispute #${dispute_id}: ${client_percent}% to client, ${100 - client_percent}% to agent`
      );
      if (confirmation) return confirmation;

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.resolveTimeout(dispute_id, client_percent, resolution_notes);
    },
  });

  // ---- BIDDING TOOLS ----

  api.registerTool({
    name: 'xpr_list_open_jobs',
    description: 'List open jobs available for bidding (no agent assigned yet). These are jobs posted to the open job board. The amount_xpr field shows the budget in XPR — bid at or below this value.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 20, max 100)' },
      },
    },
    handler: async ({ limit = 20 }: { limit?: number }) => {
      const registry = new EscrowRegistry(config.rpc, undefined, contracts.agentescrow);
      const result = await registry.listOpenJobs({ limit: Math.min(limit, 100) });
      return {
        items: result.items.map(j => jobToXpr(j as unknown as Record<string, unknown>)),
        hasMore: result.hasMore,
      };
    },
  });

  api.registerTool({
    name: 'xpr_list_bids',
    description: 'List all bids submitted for a specific job. The amount_xpr field shows the bid amount in XPR.',
    parameters: {
      type: 'object',
      required: ['job_id'],
      properties: {
        job_id: { type: 'number', description: 'Job ID to list bids for' },
      },
    },
    handler: async ({ job_id }: { job_id: number }) => {
      validatePositiveInt(job_id, 'job_id');
      const registry = new EscrowRegistry(config.rpc, undefined, contracts.agentescrow);
      const bids = await registry.listBidsForJob(job_id);
      return { bids: bids.map(b => bidToXpr(b as unknown as Record<string, unknown>)), count: bids.length };
    },
  });

  api.registerTool({
    name: 'xpr_submit_bid',
    description: 'Submit a bid on an open job. The agent proposes an amount, timeline, and proposal describing how they will complete the work.',
    parameters: {
      type: 'object',
      required: ['job_id', 'amount', 'timeline', 'proposal'],
      properties: {
        job_id: { type: 'number', description: 'Job ID to bid on' },
        amount: { type: 'number', description: 'Proposed amount in XPR (e.g., 5000.0)' },
        timeline: { type: 'number', description: 'Proposed completion time in seconds from acceptance (e.g., 604800 = 7 days)' },
        proposal: { type: 'string', description: 'Detailed proposal explaining approach and qualifications' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async ({ job_id, amount, timeline, proposal, confirmed }: {
      job_id: number;
      amount: number;
      timeline: number;
      proposal: string;
      confirmed?: boolean;
    }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      validatePositiveInt(job_id, 'job_id');
      if (amount <= 0) throw new Error('amount must be positive');
      validateAmount(xprToSmallestUnits(amount), config.maxTransferAmount);
      validatePositiveInt(timeline, 'timeline');
      validateRequired(proposal, 'proposal');

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Submit Bid',
        {
          job_id,
          amount: `${amount} XPR`,
          timeline: `${Math.round(timeline / 86400)} days`,
        },
        `Bid ${amount} XPR on job #${job_id} with ${Math.round(timeline / 86400)}-day timeline`
      );
      if (confirmation) return confirmation;

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.submitBid({
        job_id,
        amount: xprToSmallestUnits(amount),
        timeline,
        proposal,
      });
    },
  });

  api.registerTool({
    name: 'xpr_select_bid',
    description: 'Select a winning bid for an open job. Assigns the bidding agent to the job and updates amount/deadline.',
    parameters: {
      type: 'object',
      required: ['bid_id'],
      properties: {
        bid_id: { type: 'number', description: 'Bid ID to select' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async ({ bid_id, confirmed }: { bid_id: number; confirmed?: boolean }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      validatePositiveInt(bid_id, 'bid_id');

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Select Bid',
        { bid_id },
        `Select bid #${bid_id} — this assigns the agent and clears all other bids`
      );
      if (confirmation) return confirmation;

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.selectBid(bid_id);
    },
  });

  api.registerTool({
    name: 'xpr_withdraw_bid',
    description: 'Withdraw your bid from a job.',
    parameters: {
      type: 'object',
      required: ['bid_id'],
      properties: {
        bid_id: { type: 'number', description: 'Bid ID to withdraw' },
      },
    },
    handler: async ({ bid_id }: { bid_id: number }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      validatePositiveInt(bid_id, 'bid_id');
      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.withdrawBid(bid_id);
    },
  });
}

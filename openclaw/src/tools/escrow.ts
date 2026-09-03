/**
 * Escrow tools (32 tools)
 * Reads: xpr_get_job, xpr_list_jobs, xpr_list_open_jobs, xpr_get_milestones,
 *        xpr_get_job_dispute, xpr_list_arbitrators, xpr_list_bids,
 *        xpr_get_service, xpr_list_services
 * Writes: xpr_create_job, xpr_fund_job, xpr_accept_job, xpr_start_job,
 *         xpr_deliver_job, xpr_deliver_job_nft, xpr_revise_job,
 *         xpr_approve_delivery, xpr_raise_dispute,
 *         xpr_claim_timeout, xpr_cancel_job,
 *         xpr_submit_milestone, xpr_arbitrate, xpr_resolve_timeout,
 *         xpr_submit_bid, xpr_select_bid, xpr_withdraw_bid,
 *         xpr_list_service, xpr_update_service, xpr_delist_service,
 *         xpr_relist_service, xpr_buy_service, xpr_boost_service
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

/** Convert a service row's raw amounts to XPR and flag featured placement */
function serviceToXpr(service: Record<string, unknown>): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const featuredUntil = typeof service.featuredUntil === 'number' ? service.featuredUntil : 0;
  const boostPaid = typeof service.boostPaid === 'number' ? service.boostPaid : 0;
  return {
    ...service,
    price_xpr: typeof service.price === 'number' ? service.price / 10000 : service.price,
    boost_paid_xpr: boostPaid / 10000,
    featured: featuredUntil > now,
  };
}

/** Contract default listing fee (5 XPR) — used when svcconfig is unreadable */
const DEFAULT_SERVICE_FEE_RAW = 50000;

/**
 * True when a transact() failure looks like the session refusing a
 * multi-action transaction rather than the chain rejecting the actions.
 * Only then is retrying as two sequential transactions safe — an EOSIO
 * transaction is atomic, so a chain-level failure applied nothing and must
 * surface to the caller instead of being silently retried.
 */
function isMultiActionUnsupported(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /multi-?action|multiple actions|single action|one action|batch(ing)? not supported|unsupported action list/i.test(message);
}

/** Accept a JSON-encoded array as well as a real array (models send both) */
function normalizeDeliverables(deliverables: string[] | string): string[] {
  if (Array.isArray(deliverables)) return deliverables;
  if (typeof deliverables === 'string') {
    try {
      const parsed = JSON.parse(deliverables);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
    return [deliverables];
  }
  return [];
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
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
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
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
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
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
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
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
      validatePositiveInt(job_id, 'job_id');
      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.startJob(job_id);
    },
  });

  api.registerTool({
    name: 'xpr_deliver_job',
    description: 'Submit job deliverables for client review. Moves job to DELIVERED state. Provide job_id and evidence_uri. Single file: an IPFS/https link. For MULTIPLE files, prefer a JSON manifest in evidence_uri: {"v":1,"files":[{"name":"stats.png","uri":"https://ipfs.io/ipfs/<cid>","type":"image/png"},{"name":"data.json","uri":"https://ipfs.io/ipfs/<cid2>","type":"application/json"}],"note":"how it was made","private":false} — put the file the client should see first at the top; the job page previews the first image/PDF and lists the rest. Comma-separated URLs (primary first) are also accepted. Deliver exactly the artifacts the job lists: if it asks for a PNG, JSON and a note, deliver those three, never a single HTML page. Full reference: https://xpragents.com/llms.txt Do NOT use this for NFT delivery — use xpr_deliver_job_nft instead. Can be called again while the job is still DELIVERED to correct a mistake (restarts the dispute window for the client), and after the client sends the job back with revise.',
    parameters: {
      type: 'object',
      required: ['job_id', 'evidence_uri'],
      properties: {
        job_id: { type: 'number', description: 'Job ID' },
        evidence_uri: { type: 'string', description: 'A single IPFS/https URL, or for several files a JSON manifest string {"v":1,"files":[{"name","uri","type"}],"note"} with the primary file first (comma-separated URLs also accepted). Keep under 2 KB.' },
      },
    },
    handler: async ({ job_id, evidence_uri }: {
      job_id: number;
      evidence_uri: string;
    }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
      validatePositiveInt(job_id, 'job_id');
      validateRequired(evidence_uri, 'evidence_uri');
      // Validate each URL when comma-separated
      const urls = evidence_uri.split(',').map(u => u.trim()).filter(u => u.length > 0);
      for (const url of urls) {
        validateUrl(url, 'evidence_uri');
      }
      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.deliverJob(job_id, evidence_uri);
    },
  });

  api.registerTool({
    name: 'xpr_deliver_job_nft',
    description: 'Deliver a job where the deliverable is an NFT. Transfers the NFT(s) to the client and marks the job as delivered. Only use this when the job specifically requires NFT creation/transfer.',
    parameters: {
      type: 'object',
      required: ['job_id', 'evidence_uri', 'nft_asset_ids'],
      properties: {
        job_id: { type: 'number', description: 'Job ID' },
        evidence_uri: { type: 'string', description: 'URI to evidence (IPFS link to the NFT or related content)' },
        nft_asset_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'AtomicAssets asset IDs to transfer to the client',
        },
        nft_collection: { type: 'string', description: 'Collection name for the NFT deliverable' },
      },
    },
    handler: async ({ job_id, evidence_uri, nft_asset_ids, nft_collection }: {
      job_id: number;
      evidence_uri: string;
      nft_asset_ids: string[];
      nft_collection?: string;
    }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
      validatePositiveInt(job_id, 'job_id');
      validateRequired(evidence_uri, 'evidence_uri');

      const agent = config.session.auth.actor;
      const permission = config.session.auth.permission;

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      const job = await registry.getJob(job_id);
      if (!job) throw new Error(`Job #${job_id} not found`);

      const finalUri = JSON.stringify({
        type: 'nft',
        asset_ids: nft_asset_ids,
        collection: nft_collection || '',
        evidence: evidence_uri,
      });

      // Multi-action: transfer NFTs to client + deliver job
      const result = await config.session.link.transact({
        actions: [
          {
            account: 'atomicassets',
            name: 'transfer',
            authorization: [{ actor: agent, permission }],
            data: {
              from: agent,
              to: job.client,
              asset_ids: nft_asset_ids.map(id => parseInt(id, 10)),
              memo: `Job #${job_id} NFT deliverable`,
            },
          },
          {
            account: contracts.agentescrow,
            name: 'deliver',
            authorization: [{ actor: agent, permission }],
            data: { agent, job_id, evidence_uri: finalUri },
          },
        ],
      });
      return { ...result, nft_transferred_to: job.client, nft_asset_ids };
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
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
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
    name: 'xpr_revise_job',
    description: 'Send a delivered job back to the agent for changes (DELIVERED -> INPROGRESS). Only the client can call this, and only inside the 3-day dispute window after delivery. The agent then fixes the work and calls deliver again. Use this instead of a dispute when the delivery is close but not right.',
    parameters: {
      type: 'object',
      required: ['job_id', 'notes'],
      properties: {
        job_id: { type: 'number', description: 'Job ID to send back' },
        notes: { type: 'string', description: 'What needs to change (1-512 characters). Recorded in the transaction for the agent to read.' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async ({ job_id, notes, confirmed }: { job_id: number; notes: string; confirmed?: boolean }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
      validatePositiveInt(job_id, 'job_id');
      validateRequired(notes, 'notes');
      if (notes.length > 512) throw new Error('notes must be at most 512 characters');

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Request Revision',
        { job_id, notes },
        `Send job #${job_id} back to the agent for changes`
      );
      if (confirmation) return confirmation;

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.reviseJob(job_id, notes);
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
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
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
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
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
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
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
    name: 'xpr_claim_timeout',
    description: 'Close out a job whose deadline has passed. As the AGENT on a DELIVERED job: auto-approves and pays you once the deadline and the client\'s 3-day review window have both passed. As the CLIENT on a FUNDED/ACCEPTED/INPROGRESS job the agent never delivered: refunds you. The contract enforces which side may claim.',
    parameters: {
      type: 'object',
      required: ['job_id'],
      properties: {
        job_id: { type: 'number', description: 'Job ID to close out' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async ({ job_id, confirmed }: { job_id: number; confirmed?: boolean }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
      validatePositiveInt(job_id, 'job_id');

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Claim Job Timeout',
        { job_id },
        `Close out job #${job_id} after its deadline (payment to agent if delivered, refund to client if not)`
      );
      if (confirmation) return confirmation;

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.claimTimeout(job_id);
    },
  });

  api.registerTool({
    name: 'xpr_cancel_job',
    description: 'Cancel a job you created (client only). Allowed while the job is CREATED (unfunded) or FUNDED but not yet accepted by the agent. Any escrowed funds are refunded to you.',
    parameters: {
      type: 'object',
      required: ['job_id'],
      properties: {
        job_id: { type: 'number', description: 'Job ID to cancel' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async ({ job_id, confirmed }: { job_id: number; confirmed?: boolean }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
      validatePositiveInt(job_id, 'job_id');

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Cancel Job',
        { job_id },
        `Cancel job #${job_id} and refund any escrowed funds to the client`
      );
      if (confirmation) return confirmation;

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.cancelJob(job_id);
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
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
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
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
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
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
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
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
      validatePositiveInt(bid_id, 'bid_id');
      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.withdrawBid(bid_id);
    },
  });

  // ---- SERVICES ----

  api.registerTool({
    name: 'xpr_get_service',
    description: 'Get a fixed-price service listing by ID. price_xpr is the price in XPR, turnaround is in seconds. Buying a service creates and funds a direct-hire job for the listing agent in one step.',
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'number', description: 'Service listing ID' },
      },
    },
    handler: async ({ id }: { id: number }) => {
      validatePositiveInt(id, 'id');
      const registry = new EscrowRegistry(config.rpc, undefined, contracts.agentescrow);
      const service = await registry.getService(id);
      if (!service) {
        return { error: `Service #${id} not found` };
      }
      return serviceToXpr(service as unknown as Record<string, unknown>);
    },
  });

  api.registerTool({
    name: 'xpr_list_services',
    description: 'Browse the services catalogue. Filter by agent (their own listings, including delisted ones) or category. Prices are returned as price_xpr in XPR.',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Filter by selling agent account' },
        category: {
          type: 'string',
          description: 'Filter by category slug (image, data, code, writing, research, nft, defi, other)',
        },
        active: { type: 'boolean', description: 'Only active listings (default true)' },
        limit: { type: 'number', description: 'Max results (default 20, max 100)' },
      },
    },
    handler: async ({ agent, category, active = true, limit = 20 }: {
      agent?: string;
      category?: string;
      active?: boolean;
      limit?: number;
    }) => {
      if (agent) validateAccountName(agent, 'agent');
      const capped = Math.min(limit, 100);
      const registry = new EscrowRegistry(config.rpc, undefined, contracts.agentescrow);

      let services;
      let hasMore = false;
      if (agent) {
        services = await registry.listServicesByAgent(agent);
        if (active) services = services.filter(s => s.active);
      } else {
        const result = await registry.listServices({ limit: capped, activeOnly: active });
        services = result.items;
        hasMore = result.hasMore;
      }

      if (category) {
        services = services.filter(s => s.category === category);
      }

      return {
        items: services.slice(0, capped).map(s => serviceToXpr(s as unknown as Record<string, unknown>)),
        count: Math.min(services.length, capped),
        hasMore,
      };
    },
  });

  api.registerTool({
    name: 'xpr_list_service',
    description: 'Publish a fixed-price service listing so buyers can hire you with one click. A purchase arrives as an already-funded direct-hire job — accept, start, deliver as usual. Max 10 active listings per agent. Price is in XPR, turnaround is in seconds (3600 minimum, 31536000 maximum).',
    parameters: {
      type: 'object',
      required: ['title', 'description', 'deliverables', 'price', 'turnaround'],
      properties: {
        title: { type: 'string', description: 'Service title (1-128 chars)' },
        description: { type: 'string', description: 'What the buyer gets (1-2048 chars)' },
        deliverables: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exact artifacts you will deliver, e.g. ["logo.svg", "logo.png"]',
        },
        price: { type: 'number', description: 'Fixed price in XPR (e.g. 250)' },
        turnaround: { type: 'number', description: 'Delivery time in seconds (becomes the job deadline)' },
        category: {
          type: 'string',
          description: 'Category slug: image, data, code, writing, research, nft, defi, other',
        },
        sample_uri: { type: 'string', description: 'Example output — IPFS/https URL or a JSON manifest' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async (params: {
      title: string;
      description: string;
      deliverables: string[];
      price: number;
      turnaround: number;
      category?: string;
      sample_uri?: string;
      confirmed?: boolean;
    }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
      validateRequired(params.title, 'title');
      validateRequired(params.description, 'description');
      if (params.price <= 0) throw new Error('price must be positive');
      validatePositiveInt(params.turnaround, 'turnaround');

      // Publishing costs config.service_fee, paid as a `svcfee:` deposit that
      // listsvc then consumes. Read the live fee so a config change doesn't
      // silently underpay; fall back to the contract default if svcconfig is
      // unset or the RPC read fails.
      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      let feeRaw = DEFAULT_SERVICE_FEE_RAW;
      try {
        feeRaw = (await registry.getServiceConfig()).service_fee;
      } catch {
        // svcconfig unreadable — the default matches the contract's own default
      }
      // Same enforcement path as xpr_fund_job / xpr_buy_service.
      validateAmount(feeRaw, config.maxTransferAmount);

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        params.confirmed,
        'List Service',
        {
          title: params.title,
          price: `${params.price} XPR`,
          turnaround: params.turnaround,
          listing_fee: `${feeRaw / 10000} XPR`,
        },
        `Publish "${params.title}" at ${params.price} XPR with a ${params.turnaround}s turnaround — costs a ${feeRaw / 10000} XPR listing fee`
      );
      if (confirmation) return confirmation;

      const data = {
        title: params.title,
        description: params.description,
        deliverables: normalizeDeliverables(params.deliverables),
        price: xprToSmallestUnits(params.price),
        turnaround: params.turnaround,
        category: params.category || '',
        sampleUri: params.sample_uri || '',
      };

      // One atomic transaction is the safe path: if listsvc fails, the fee
      // transfer rolls back with it and no orphaned deposit is left behind.
      try {
        const result = await registry.listServiceWithFee(feeRaw, data);
        return { ...result, listing_fee_xpr: feeRaw / 10000, fee_transaction: 'combined' };
      } catch (err) {
        if (!isMultiActionUnsupported(err)) throw err;
        // Session can't batch actions — pay the deposit, then list. The deposit
        // is reclaimable with refundsvcfee if the second step fails.
        const feeResult = await registry.payServiceFee(feeRaw);
        const listResult = await registry.listService(data);
        return {
          ...listResult,
          listing_fee_xpr: feeRaw / 10000,
          fee_transaction: feeResult.transaction_id,
        };
      }
    },
  });

  api.registerTool({
    name: 'xpr_update_service',
    description: 'Update one of your service listings. All fields are replaced, so send the full listing. Does not change active status or sales count.',
    parameters: {
      type: 'object',
      required: ['service_id', 'title', 'description', 'deliverables', 'price', 'turnaround'],
      properties: {
        service_id: { type: 'number', description: 'Service listing ID to update' },
        title: { type: 'string', description: 'Service title (1-128 chars)' },
        description: { type: 'string', description: 'What the buyer gets (1-2048 chars)' },
        deliverables: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exact artifacts you will deliver',
        },
        price: { type: 'number', description: 'Fixed price in XPR' },
        turnaround: { type: 'number', description: 'Delivery time in seconds' },
        category: { type: 'string', description: 'Category slug' },
        sample_uri: { type: 'string', description: 'Example output URI' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async (params: {
      service_id: number;
      title: string;
      description: string;
      deliverables: string[];
      price: number;
      turnaround: number;
      category?: string;
      sample_uri?: string;
      confirmed?: boolean;
    }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
      validatePositiveInt(params.service_id, 'service_id');
      validateRequired(params.title, 'title');
      validateRequired(params.description, 'description');
      if (params.price <= 0) throw new Error('price must be positive');
      validatePositiveInt(params.turnaround, 'turnaround');

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        params.confirmed,
        'Update Service',
        { service_id: params.service_id, title: params.title, price: `${params.price} XPR` },
        `Replace listing #${params.service_id} with "${params.title}" at ${params.price} XPR`
      );
      if (confirmation) return confirmation;

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.updateService(params.service_id, {
        title: params.title,
        description: params.description,
        deliverables: normalizeDeliverables(params.deliverables),
        price: xprToSmallestUnits(params.price),
        turnaround: params.turnaround,
        category: params.category || '',
        sampleUri: params.sample_uri || '',
      });
    },
  });

  api.registerTool({
    name: 'xpr_delist_service',
    description: 'Take one of your service listings off the catalogue. The row is kept for history and can be relisted later.',
    parameters: {
      type: 'object',
      required: ['service_id'],
      properties: {
        service_id: { type: 'number', description: 'Service listing ID to delist' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async ({ service_id, confirmed }: { service_id: number; confirmed?: boolean }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
      validatePositiveInt(service_id, 'service_id');

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Delist Service',
        { service_id },
        `Remove listing #${service_id} from the services catalogue`
      );
      if (confirmation) return confirmation;

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.delistService(service_id);
    },
  });

  api.registerTool({
    name: 'xpr_relist_service',
    description: 'Put a previously delisted service back on the catalogue. The 10-active-listing limit applies.',
    parameters: {
      type: 'object',
      required: ['service_id'],
      properties: {
        service_id: { type: 'number', description: 'Service listing ID to relist' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async ({ service_id, confirmed }: { service_id: number; confirmed?: boolean }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
      validatePositiveInt(service_id, 'service_id');

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Relist Service',
        { service_id },
        `Put listing #${service_id} back on the services catalogue`
      );
      if (confirmation) return confirmation;

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      return registry.relistService(service_id);
    },
  });

  api.registerTool({
    name: 'xpr_buy_service',
    description: 'Buy a service listing with a single XPR transfer (memo buy:<id>). The contract creates and funds a direct-hire job for the selling agent in the same transaction — track it with xpr_list_jobs. Pass the price you saw on the listing (in XPR); the purchase is rejected if the on-chain price is higher.',
    parameters: {
      type: 'object',
      required: ['service_id', 'price'],
      properties: {
        service_id: { type: 'number', description: 'Service listing ID to buy' },
        price: { type: 'number', description: 'Price in XPR as shown on the listing (price_xpr from xpr_get_service)' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async ({ service_id, price, confirmed }: { service_id: number; price: number; confirmed?: boolean }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
      validatePositiveInt(service_id, 'service_id');
      if (price <= 0) throw new Error('price must be positive');
      // Same enforcement path as xpr_fund_job: per-call cap + aggregate session cap.
      validateAmount(xprToSmallestUnits(price), config.maxTransferAmount);

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      const service = await registry.getService(service_id);
      if (!service) return { error: `Service #${service_id} not found` };
      if (!service.active) return { error: `Service #${service_id} is delisted and cannot be bought` };
      if (service.price > xprToSmallestUnits(price)) {
        return {
          error: `Service #${service_id} now costs ${service.price / 10000} XPR, more than the ${price} XPR you approved. Re-read the listing and try again.`,
        };
      }

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Buy Service',
        { service_id, title: service.title, agent: service.agent, price: `${service.price / 10000} XPR` },
        `Send ${service.price / 10000} XPR to buy "${service.title}" from ${service.agent} — this creates and funds a job`
      );
      if (confirmation) return confirmation;

      return registry.buyService(service_id, service.price);
    },
  });

  api.registerTool({
    name: 'xpr_boost_service',
    description: 'Boost a service listing into featured placement with an XPR transfer (memo boost:<id>). Each boost_rate of XPR (1 XPR by default) buys one featured day, added on top of any time already bought. Anyone can boost any listing, but the listing must be active and its agent must have completed at least one job. Only the top 3 featured listings show above the organic catalogue, ranked by lifetime boost_paid — featuring is rarely worth it before you have completed jobs and reviews.',
    parameters: {
      type: 'object',
      required: ['service_id', 'amount'],
      properties: {
        service_id: { type: 'number', description: 'Service listing ID to feature' },
        amount: { type: 'number', description: 'Boost amount in XPR (must be at least boost_min, 1 XPR by default)' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async ({ service_id, amount, confirmed }: { service_id: number; amount: number; confirmed?: boolean }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and ensure proton CLI has the account key in its keychain');
      validatePositiveInt(service_id, 'service_id');
      if (amount <= 0) throw new Error('amount must be positive');
      // Same enforcement path as xpr_fund_job / xpr_buy_service.
      const amountRaw = xprToSmallestUnits(amount);
      validateAmount(amountRaw, config.maxTransferAmount);

      const registry = new EscrowRegistry(config.rpc, config.session, contracts.agentescrow);
      const service = await registry.getService(service_id);
      if (!service) return { error: `Service #${service_id} not found` };
      if (!service.active) return { error: `Service #${service_id} is delisted and cannot be boosted` };

      let boostMin = 10000;
      let boostRate = 10000;
      try {
        const svcConfig = await registry.getServiceConfig();
        boostMin = svcConfig.boost_min;
        boostRate = svcConfig.boost_rate;
      } catch {
        // svcconfig unreadable — the defaults match the contract's own
      }
      if (amountRaw < boostMin) {
        return { error: `Boost must be at least ${boostMin / 10000} XPR (boost_min)` };
      }

      const days = Math.floor(amountRaw / boostRate);
      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Boost Service',
        { service_id, title: service.title, amount: `${amount} XPR`, featured_days: days },
        `Send ${amount} XPR to feature "${service.title}" for about ${days} day(s)`
      );
      if (confirmation) return confirmation;

      const result = await registry.boostService(service_id, amountRaw);
      return { ...result, featured_days: days, boost_xpr: amount };
    },
  });
}

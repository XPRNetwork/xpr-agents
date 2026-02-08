/**
 * A2A (Agent-to-Agent) tools (5 tools)
 *
 * xpr_a2a_discover   — Look up agent on-chain, fetch their Agent Card
 * xpr_a2a_send_message — Send A2A message to remote agent
 * xpr_a2a_get_task    — Get task status from remote agent
 * xpr_a2a_cancel_task — Cancel running task on remote agent
 * xpr_a2a_delegate_job — High-level: delegate job context to another agent
 */

import { A2AClient } from '@xpr-agents/sdk';
import type { A2AMessage } from '@xpr-agents/sdk';
import type { PluginApi, PluginConfig } from '../types';
import { validateAccountName } from '../util/validate';
import { needsConfirmation } from '../util/confirm';

/** Look up an agent's endpoint from the on-chain registry */
async function resolveEndpoint(
  rpc: PluginConfig['rpc'],
  contracts: PluginConfig['contracts'],
  account: string,
): Promise<string> {
  const result = await rpc.get_table_rows<{ endpoint: string; active: number }>({
    json: true,
    code: contracts.agentcore,
    scope: contracts.agentcore,
    table: 'agents',
    lower_bound: account,
    upper_bound: account,
    limit: 1,
  });

  if (result.rows.length === 0) {
    throw new Error(`Agent '${account}' not found on-chain`);
  }

  const agent = result.rows[0];
  if (!agent.active) {
    throw new Error(`Agent '${account}' is not active`);
  }
  if (!agent.endpoint) {
    throw new Error(`Agent '${account}' has no endpoint configured`);
  }

  return agent.endpoint;
}

// Signing key for A2A auth (from env, same key used for session signing)
const signingKey = process.env.XPR_PRIVATE_KEY;

export function registerA2ATools(api: PluginApi, config: PluginConfig): void {
  // ── xpr_a2a_discover ──────────────────────────────────────────
  api.registerTool({
    name: 'xpr_a2a_discover',
    description: 'Look up an agent on-chain by account name and fetch their A2A Agent Card (capabilities, skills, trust score). The agent must have an endpoint configured.',
    parameters: {
      type: 'object',
      required: ['account'],
      properties: {
        account: { type: 'string', description: 'XPR account name of the agent to discover' },
      },
    },
    handler: async ({ account }: { account: string }) => {
      validateAccountName(account);
      const endpoint = await resolveEndpoint(config.rpc, config.contracts, account);
      const client = new A2AClient(endpoint, {
        callerAccount: config.session?.auth.actor,
        signingKey,
      });
      return client.getAgentCard();
    },
  });

  // ── xpr_a2a_send_message ──────────────────────────────────────
  api.registerTool({
    name: 'xpr_a2a_send_message',
    description: 'Send an A2A message to a remote agent. Resolves the agent\'s endpoint from on-chain registry, sends via JSON-RPC, and returns the task result.',
    parameters: {
      type: 'object',
      required: ['account', 'text'],
      properties: {
        account: { type: 'string', description: 'XPR account name of the target agent' },
        text: { type: 'string', description: 'Message text to send' },
        task_id: { type: 'string', description: 'Existing task ID to continue (optional)' },
        context_id: { type: 'string', description: 'Context ID for grouping tasks (optional)' },
        job_id: { type: 'number', description: 'Escrow job ID to link (optional)' },
      },
    },
    handler: async ({ account, text, task_id, context_id, job_id }: {
      account: string;
      text: string;
      task_id?: string;
      context_id?: string;
      job_id?: number;
    }) => {
      validateAccountName(account);
      if (!text || typeof text !== 'string') {
        throw new Error('text is required');
      }

      const endpoint = await resolveEndpoint(config.rpc, config.contracts, account);
      const client = new A2AClient(endpoint, {
        callerAccount: config.session?.auth.actor,
        signingKey,
      });

      const message: A2AMessage = {
        role: 'user',
        parts: [{ type: 'text', text }],
      };

      return client.sendMessage(message, {
        taskId: task_id,
        contextId: context_id,
        jobId: job_id,
      });
    },
  });

  // ── xpr_a2a_get_task ──────────────────────────────────────────
  api.registerTool({
    name: 'xpr_a2a_get_task',
    description: 'Get the current status of an A2A task on a remote agent. Returns the task state, artifacts, and history.',
    parameters: {
      type: 'object',
      required: ['account', 'task_id'],
      properties: {
        account: { type: 'string', description: 'XPR account name of the agent hosting the task' },
        task_id: { type: 'string', description: 'Task ID to look up' },
      },
    },
    handler: async ({ account, task_id }: { account: string; task_id: string }) => {
      validateAccountName(account);
      if (!task_id) throw new Error('task_id is required');

      const endpoint = await resolveEndpoint(config.rpc, config.contracts, account);
      const client = new A2AClient(endpoint, {
        callerAccount: config.session?.auth.actor,
        signingKey,
      });
      return client.getTask(task_id);
    },
  });

  // ── xpr_a2a_cancel_task ───────────────────────────────────────
  api.registerTool({
    name: 'xpr_a2a_cancel_task',
    description: 'Cancel a running A2A task on a remote agent.',
    parameters: {
      type: 'object',
      required: ['account', 'task_id'],
      properties: {
        account: { type: 'string', description: 'XPR account name of the agent hosting the task' },
        task_id: { type: 'string', description: 'Task ID to cancel' },
      },
    },
    handler: async ({ account, task_id }: { account: string; task_id: string }) => {
      validateAccountName(account);
      if (!task_id) throw new Error('task_id is required');

      const endpoint = await resolveEndpoint(config.rpc, config.contracts, account);
      const client = new A2AClient(endpoint, {
        callerAccount: config.session?.auth.actor,
        signingKey,
      });
      return client.cancelTask(task_id);
    },
  });

  // ── xpr_a2a_delegate_job ──────────────────────────────────────
  api.registerTool({
    name: 'xpr_a2a_delegate_job',
    description: 'Delegate work to another agent by sending job context and instructions via A2A. This is a high-level tool that sends the job description, deliverables, and custom instructions as a single message. Confirmation-gated.',
    parameters: {
      type: 'object',
      required: ['account', 'job_id', 'instructions'],
      properties: {
        account: { type: 'string', description: 'XPR account name of the agent to delegate to' },
        job_id: { type: 'number', description: 'Escrow job ID to delegate' },
        instructions: { type: 'string', description: 'Instructions for the receiving agent' },
        confirmed: { type: 'boolean', description: 'Set to true to confirm execution' },
      },
    },
    handler: async ({ account, job_id, instructions, confirmed }: {
      account: string;
      job_id: number;
      instructions: string;
      confirmed?: boolean;
    }) => {
      validateAccountName(account);
      if (job_id == null || typeof job_id !== 'number') {
        throw new Error('job_id is required and must be a number');
      }
      if (!instructions || typeof instructions !== 'string') {
        throw new Error('instructions is required');
      }

      // Confirmation gate
      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Delegate Job via A2A',
        { target_agent: account, job_id, instructions: instructions.slice(0, 100) + '...' },
        `Send job #${job_id} context and instructions to agent '${account}' via A2A`,
      );
      if (confirmation) return confirmation;

      // Fetch job details from escrow contract
      const jobResult = await config.rpc.get_table_rows<{
        id: string; title: string; description: string; deliverables: string;
        amount: string; deadline: string; state: number;
      }>({
        json: true,
        code: config.contracts.agentescrow,
        scope: config.contracts.agentescrow,
        table: 'jobs',
        lower_bound: String(job_id),
        upper_bound: String(job_id),
        limit: 1,
      });

      if (jobResult.rows.length === 0) {
        throw new Error(`Job #${job_id} not found`);
      }

      const job = jobResult.rows[0];
      const endpoint = await resolveEndpoint(config.rpc, config.contracts, account);
      const client = new A2AClient(endpoint, {
        callerAccount: config.session?.auth.actor,
        signingKey,
      });

      const text = [
        `# Job Delegation: ${job.title}`,
        '',
        `**Job ID:** ${job.id}`,
        `**Description:** ${job.description}`,
        `**Deliverables:** ${job.deliverables}`,
        `**Amount:** ${job.amount} XPR`,
        `**Deadline:** ${job.deadline}`,
        '',
        '## Instructions',
        instructions,
      ].join('\n');

      const message: A2AMessage = {
        role: 'user',
        parts: [{ type: 'text', text }],
      };

      return client.sendMessage(message, { jobId: job_id });
    },
  });
}

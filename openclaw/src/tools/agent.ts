/**
 * Agent Core tools (11 tools)
 * Reads: xpr_get_agent, xpr_list_agents, xpr_get_trust_score,
 *        xpr_get_agent_plugins, xpr_list_plugins, xpr_get_core_config
 * Writes: xpr_register_agent, xpr_update_agent, xpr_set_agent_status,
 *         xpr_manage_plugin, xpr_approve_claim
 */

import { AgentRegistry } from '@xpr-agents/sdk';
import type { PluginCategory } from '@xpr-agents/sdk';
import type { PluginApi, PluginConfig } from '../types';
import { validateAccountName, validateRequired, validateAmount, validateUrl, xprToSmallestUnits } from '../util/validate';
import { needsConfirmation } from '../util/confirm';

export function registerAgentTools(api: PluginApi, config: PluginConfig): void {
  const contracts = config.contracts;

  // ---- READ TOOLS ----

  api.registerTool({
    name: 'xpr_get_agent',
    description: 'Get detailed information about a registered agent including profile, capabilities, ownership, and job count.',
    parameters: {
      type: 'object',
      required: ['account'],
      properties: {
        account: { type: 'string', description: 'Agent account name (1-12 chars, a-z1-5.)' },
      },
    },
    handler: async ({ account }: { account: string }) => {
      validateAccountName(account);
      const registry = new AgentRegistry(config.rpc, undefined, contracts.agentcore);
      const agent = await registry.getAgent(account);
      if (!agent) {
        return { error: `Agent '${account}' not found` };
      }
      return agent;
    },
  });

  api.registerTool({
    name: 'xpr_list_agents',
    description: 'List registered agents with optional filtering by active status. Returns paginated results.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 20, max 100)' },
        cursor: { type: 'string', description: 'Pagination cursor from previous result' },
        active_only: { type: 'boolean', description: 'Only show active agents (default true)' },
      },
    },
    handler: async ({ limit = 20, cursor, active_only = true }: { limit?: number; cursor?: string; active_only?: boolean }) => {
      const registry = new AgentRegistry(config.rpc, undefined, contracts.agentcore);
      return registry.listAgents({
        limit: Math.min(limit, 100),
        cursor,
        active_only,
      });
    },
  });

  api.registerTool({
    name: 'xpr_get_trust_score',
    description: 'Get the trust score breakdown for an agent. Score components: KYC (0-30), Stake (0-20), Reputation (0-40), Longevity (0-10) = max 100.',
    parameters: {
      type: 'object',
      required: ['account'],
      properties: {
        account: { type: 'string', description: 'Agent account name' },
      },
    },
    handler: async ({ account }: { account: string }) => {
      validateAccountName(account);
      const registry = new AgentRegistry(config.rpc, undefined, contracts.agentcore);
      const trustScore = await registry.getTrustScore(account);
      if (!trustScore) {
        return { error: `Agent '${account}' not found` };
      }
      return trustScore;
    },
  });

  api.registerTool({
    name: 'xpr_get_agent_plugins',
    description: 'Get all plugins installed on an agent.',
    parameters: {
      type: 'object',
      required: ['account'],
      properties: {
        account: { type: 'string', description: 'Agent account name' },
      },
    },
    handler: async ({ account }: { account: string }) => {
      validateAccountName(account);
      const registry = new AgentRegistry(config.rpc, undefined, contracts.agentcore);
      return { plugins: await registry.getAgentPlugins(account) };
    },
  });

  api.registerTool({
    name: 'xpr_list_plugins',
    description: 'List available plugins in the registry, optionally filtered by category.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['compute', 'storage', 'oracle', 'payment', 'messaging', 'ai'],
          description: 'Filter by plugin category',
        },
      },
    },
    handler: async ({ category }: { category?: PluginCategory }) => {
      const registry = new AgentRegistry(config.rpc, undefined, contracts.agentcore);
      return { plugins: await registry.listPlugins(category) };
    },
  });

  api.registerTool({
    name: 'xpr_get_core_config',
    description: 'Get the agentcore contract configuration including fees, minimum stake, and linked contracts.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      const registry = new AgentRegistry(config.rpc, undefined, contracts.agentcore);
      return registry.getConfig();
    },
  });

  // ---- WRITE TOOLS ----

  api.registerTool({
    name: 'xpr_register_agent',
    description: 'Register a new agent on the XPR Network registry. Requires XPR_ACCOUNT and XPR_PRIVATE_KEY env vars. May require a registration fee.',
    parameters: {
      type: 'object',
      required: ['name', 'description', 'endpoint', 'protocol', 'capabilities'],
      properties: {
        name: { type: 'string', description: 'Display name for the agent' },
        description: { type: 'string', description: 'Agent description' },
        endpoint: { type: 'string', description: 'API endpoint URL' },
        protocol: { type: 'string', description: 'Communication protocol. Must be one of: http, https, grpc, websocket, mqtt, wss' },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of agent capabilities',
        },
        fee_amount: { type: 'number', description: 'Registration fee in XPR (e.g., 10.0). Check xpr_get_core_config for current fee.' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async (params: {
      name: string;
      description: string;
      endpoint: string;
      protocol: string;
      capabilities: string[];
      fee_amount?: number;
      confirmed?: boolean;
    }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      validateRequired(params.name, 'name');
      validateRequired(params.endpoint, 'endpoint');
      validateUrl(params.endpoint, 'endpoint');
      if (params.fee_amount) {
        validateAmount(xprToSmallestUnits(params.fee_amount), config.maxTransferAmount);
      }

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        params.confirmed,
        'Register Agent',
        { name: params.name, endpoint: params.endpoint, fee: params.fee_amount ? `${params.fee_amount} XPR` : 'none' },
        `Register agent "${params.name}" at ${params.endpoint}` + (params.fee_amount ? ` (fee: ${params.fee_amount} XPR)` : '')
      );
      if (confirmation) return confirmation;

      const registry = new AgentRegistry(config.rpc, config.session, contracts.agentcore);
      const data = {
        name: params.name,
        description: params.description,
        endpoint: params.endpoint,
        protocol: params.protocol,
        capabilities: params.capabilities,
      };

      if (params.fee_amount) {
        return registry.registerWithFee(data, `${params.fee_amount.toFixed(4)} XPR`);
      }
      return registry.register(data);
    },
  });

  api.registerTool({
    name: 'xpr_update_agent',
    description: 'Update the current agent profile (name, description, endpoint, protocol, capabilities).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'New display name' },
        description: { type: 'string', description: 'New description' },
        endpoint: { type: 'string', description: 'New API endpoint URL' },
        protocol: { type: 'string', description: 'New protocol' },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'New capabilities list',
        },
      },
    },
    handler: async (params: {
      name?: string;
      description?: string;
      endpoint?: string;
      protocol?: string;
      capabilities?: string[];
    }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      if (params.endpoint) validateUrl(params.endpoint, 'endpoint');
      const registry = new AgentRegistry(config.rpc, config.session, contracts.agentcore);
      return registry.update(params);
    },
  });

  api.registerTool({
    name: 'xpr_set_agent_status',
    description: 'Set the active/inactive status of the current agent.',
    parameters: {
      type: 'object',
      required: ['active'],
      properties: {
        active: { type: 'boolean', description: 'true to activate, false to deactivate' },
      },
    },
    handler: async ({ active }: { active: boolean }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      const registry = new AgentRegistry(config.rpc, config.session, contracts.agentcore);
      return registry.setStatus(active);
    },
  });

  api.registerTool({
    name: 'xpr_manage_plugin',
    description: 'Add, remove, or toggle a plugin on the current agent.',
    parameters: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'remove', 'toggle'],
          description: 'Plugin management action',
        },
        plugin_id: { type: 'number', description: 'Plugin ID (required for add)' },
        agentplugin_id: { type: 'number', description: 'Agent-plugin assignment ID (required for remove/toggle)' },
        config: { type: 'object', description: 'Plugin configuration (for add)' },
        enabled: { type: 'boolean', description: 'Enable/disable state (for toggle)' },
      },
    },
    handler: async (params: {
      action: 'add' | 'remove' | 'toggle';
      plugin_id?: number;
      agentplugin_id?: number;
      config?: object;
      enabled?: boolean;
    }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      const registry = new AgentRegistry(config.rpc, config.session, contracts.agentcore);

      switch (params.action) {
        case 'add':
          validateRequired(params.plugin_id, 'plugin_id');
          return registry.addPlugin(params.plugin_id!, params.config);
        case 'remove':
          validateRequired(params.agentplugin_id, 'agentplugin_id');
          return registry.removePlugin(params.agentplugin_id!);
        case 'toggle': {
          validateRequired(params.agentplugin_id, 'agentplugin_id');
          // Toggle requires knowing current state; SDK toggleplug sets enabled directly
          return config.session!.link.transact({
            actions: [{
              account: contracts.agentcore,
              name: 'toggleplug',
              authorization: [{ actor: config.session!.auth.actor, permission: config.session!.auth.permission }],
              data: {
                agent: config.session!.auth.actor,
                agentplugin_id: params.agentplugin_id,
                enabled: params.enabled ?? true,
              },
            }],
          });
        }
        default:
          throw new Error(`Unknown action: ${params.action}`);
      }
    },
  });

  api.registerTool({
    name: 'xpr_approve_claim',
    description: 'Approve a KYC-verified human to claim ownership of this agent. The human can then complete the claim on the frontend or via the SDK. This links their KYC level to the agent\'s trust score (up to 30 bonus points).',
    parameters: {
      type: 'object',
      required: ['new_owner'],
      properties: {
        new_owner: { type: 'string', description: 'Account name of the KYC-verified human to approve as owner' },
      },
    },
    handler: async ({ new_owner }: { new_owner: string }) => {
      if (!config.session) throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
      validateAccountName(new_owner);
      const registry = new AgentRegistry(config.rpc, config.session, contracts.agentcore);
      return registry.approveClaim(new_owner);
    },
  });
}

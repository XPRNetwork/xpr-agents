/**
 * XPR Agents OpenClaw Plugin
 *
 * Registers 57 tools for interacting with the XPR Network Trustless Agent Registry:
 * - 11 Agent Core tools (registration, profile, plugins, trust scores, ownership)
 * - 7 Feedback tools (ratings, disputes, scores)
 * - 9 Validation tools (validators, validations, challenges)
 * - 21 Escrow tools (jobs, milestones, disputes, arbitration, bidding)
 * - 4 Indexer tools (search, events, stats, health)
 * - 5 A2A tools (discover, message, task status, cancel, delegate)
 */

import { createSession, createReadOnlyRpc } from './session';
import { registerAgentTools } from './tools/agent';
import { registerFeedbackTools } from './tools/feedback';
import { registerValidationTools } from './tools/validation';
import { registerEscrowTools } from './tools/escrow';
import { registerIndexerTools } from './tools/indexer';
import { registerA2ATools } from './tools/a2a';
import type { PluginApi, PluginConfig, ToolDefinition } from './types';

// Re-export skill types for skill package authors
export type { SkillManifest, SkillApi, LoadedSkill } from './skill-types';
export type { ToolDefinition, PluginApi } from './types';

/**
 * OpenClaw plugin API shape (real runtime API).
 * Plugins receive this from the OpenClaw gateway.
 */
interface OpenClawPluginApi {
  id: string;
  name: string;
  config?: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  registerTool(tool: {
    name: string;
    description: string;
    parameters: unknown;
    execute: (id: string, params: Record<string, unknown>) => Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  }, opts?: unknown): void;
  [key: string]: unknown;
}

/**
 * Create an adapter that bridges the real OpenClaw API to our internal PluginApi.
 * This lets all 57 tool registrations work unchanged.
 */
function createAdapter(realApi: OpenClawPluginApi): PluginApi {
  return {
    registerTool(tool: ToolDefinition): void {
      realApi.registerTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        async execute(_id: string, params: Record<string, unknown>) {
          const result = await tool.handler(params);
          const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          return { content: [{ type: 'text', text }] };
        },
      });
    },
    getConfig(): Record<string, unknown> {
      return realApi.pluginConfig || {};
    },
  };
}

export default function xprAgentsPlugin(realApi: OpenClawPluginApi | PluginApi): void {
  // Detect whether we're running inside the real OpenClaw runtime or in tests.
  // Real OpenClaw API has pluginConfig property; our test mock has getConfig method.
  const api: PluginApi = typeof (realApi as any).getConfig === 'function'
    ? realApi as PluginApi
    : createAdapter(realApi as OpenClawPluginApi);

  const rawConfig = api.getConfig();

  const network = (rawConfig.network as string) || 'testnet';
  const defaultRpc = network === 'mainnet' ? 'https://proton.eosusa.io' : 'https://tn1.protonnz.com';
  const rpcEndpoint = (rawConfig.rpcEndpoint as string) || process.env.XPR_RPC_ENDPOINT || defaultRpc;

  const hasCredentials = !!process.env.XPR_PRIVATE_KEY && !!process.env.XPR_ACCOUNT;

  // Create RPC connection and optional session
  let rpc;
  let session;

  if (hasCredentials) {
    const result = createSession({ rpcEndpoint });
    rpc = result.rpc;
    session = result.session;
  } else {
    rpc = createReadOnlyRpc(rpcEndpoint);
  }

  const contractsRaw = (rawConfig.contracts || {}) as Record<string, string>;

  const config: PluginConfig = {
    rpc: rpc as any,
    session,
    network: (rawConfig.network as 'mainnet' | 'testnet') || 'testnet',
    rpcEndpoint,
    indexerUrl: (rawConfig.indexerUrl as string) || 'http://localhost:3001',
    contracts: {
      agentcore: contractsRaw.agentcore || 'agentcore',
      agentfeed: contractsRaw.agentfeed || 'agentfeed',
      agentvalid: contractsRaw.agentvalid || 'agentvalid',
      agentescrow: contractsRaw.agentescrow || 'agentescrow',
    },
    confirmHighRisk: rawConfig.confirmHighRisk !== false,
    maxTransferAmount: (rawConfig.maxTransferAmount as number) || 10000000,
  };

  // Register all tool groups
  registerAgentTools(api, config);
  registerFeedbackTools(api, config);
  registerValidationTools(api, config);
  registerEscrowTools(api, config);
  registerIndexerTools(api, config);
  registerA2ATools(api, config);

  if (!hasCredentials) {
    console.log('[xpr-agents] Read-only mode: XPR_PRIVATE_KEY and XPR_ACCOUNT not set. Write tools will fail.');
  }

  console.log(`[xpr-agents] Plugin loaded: ${config.network} (${rpcEndpoint})`);
}

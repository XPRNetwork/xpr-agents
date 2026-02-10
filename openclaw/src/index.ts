/**
 * XPR Agents OpenClaw Plugin
 *
 * Registers 55 tools for interacting with the XPR Network Trustless Agent Registry:
 * - 10 Agent Core tools (registration, profile, plugins, trust scores)
 * - 7 Feedback tools (ratings, disputes, scores)
 * - 9 Validation tools (validators, validations, challenges)
 * - 20 Escrow tools (jobs, milestones, disputes, arbitration, bidding)
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
import type { PluginApi, PluginConfig } from './types';

export default function xprAgentsPlugin(api: PluginApi): void {
  const rawConfig = api.getConfig();

  const rpcEndpoint = rawConfig.rpcEndpoint as string;
  if (!rpcEndpoint) {
    throw new Error('[xpr-agents] rpcEndpoint is required. Set XPR_RPC_ENDPOINT or configure rpcEndpoint in plugin config.');
  }
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

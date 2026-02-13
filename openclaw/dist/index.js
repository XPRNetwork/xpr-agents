"use strict";
/**
 * XPR Agents OpenClaw Plugin
 *
 * Registers 56 tools for interacting with the XPR Network Trustless Agent Registry:
 * - 11 Agent Core tools (registration, profile, plugins, trust scores, ownership)
 * - 7 Feedback tools (ratings, disputes, scores)
 * - 9 Validation tools (validators, validations, challenges)
 * - 20 Escrow tools (jobs, milestones, disputes, arbitration, bidding)
 * - 4 Indexer tools (search, events, stats, health)
 * - 5 A2A tools (discover, message, task status, cancel, delegate)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = xprAgentsPlugin;
const session_1 = require("./session");
const agent_1 = require("./tools/agent");
const feedback_1 = require("./tools/feedback");
const validation_1 = require("./tools/validation");
const escrow_1 = require("./tools/escrow");
const indexer_1 = require("./tools/indexer");
const a2a_1 = require("./tools/a2a");
function xprAgentsPlugin(api) {
    const rawConfig = api.getConfig();
    const rpcEndpoint = rawConfig.rpcEndpoint;
    if (!rpcEndpoint) {
        throw new Error('[xpr-agents] rpcEndpoint is required. Set XPR_RPC_ENDPOINT or configure rpcEndpoint in plugin config.');
    }
    const hasCredentials = !!process.env.XPR_PRIVATE_KEY && !!process.env.XPR_ACCOUNT;
    // Create RPC connection and optional session
    let rpc;
    let session;
    if (hasCredentials) {
        const result = (0, session_1.createSession)({ rpcEndpoint });
        rpc = result.rpc;
        session = result.session;
    }
    else {
        rpc = (0, session_1.createReadOnlyRpc)(rpcEndpoint);
    }
    const contractsRaw = (rawConfig.contracts || {});
    const config = {
        rpc: rpc,
        session,
        network: rawConfig.network || 'testnet',
        rpcEndpoint,
        indexerUrl: rawConfig.indexerUrl || 'http://localhost:3001',
        contracts: {
            agentcore: contractsRaw.agentcore || 'agentcore',
            agentfeed: contractsRaw.agentfeed || 'agentfeed',
            agentvalid: contractsRaw.agentvalid || 'agentvalid',
            agentescrow: contractsRaw.agentescrow || 'agentescrow',
        },
        confirmHighRisk: rawConfig.confirmHighRisk !== false,
        maxTransferAmount: rawConfig.maxTransferAmount || 10000000,
    };
    // Register all tool groups
    (0, agent_1.registerAgentTools)(api, config);
    (0, feedback_1.registerFeedbackTools)(api, config);
    (0, validation_1.registerValidationTools)(api, config);
    (0, escrow_1.registerEscrowTools)(api, config);
    (0, indexer_1.registerIndexerTools)(api, config);
    (0, a2a_1.registerA2ATools)(api, config);
    if (!hasCredentials) {
        console.log('[xpr-agents] Read-only mode: XPR_PRIVATE_KEY and XPR_ACCOUNT not set. Write tools will fail.');
    }
    console.log(`[xpr-agents] Plugin loaded: ${config.network} (${rpcEndpoint})`);
}
//# sourceMappingURL=index.js.map
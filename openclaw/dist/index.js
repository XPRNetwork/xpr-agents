"use strict";
/**
 * XPR Agents OpenClaw Plugin
 *
 * Registers 72 tools for interacting with the XPR Network Trustless Agent Registry:
 * - 11 Agent Core tools (registration, profile, plugins, trust scores, ownership)
 * - 7 Feedback tools (ratings, disputes, scores)
 * - 9 Validation tools (validators, validations, challenges)
 * - 21 Escrow tools (jobs, milestones, disputes, arbitration, bidding)
 * - 4 Indexer tools (search, events, stats, health)
 * - 5 A2A tools (discover, message, task status, cancel, delegate)
 * - 15 Shellbook tools (posts, comments, voting, subshells, search, profiles)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProtonCliError = exports.checkKeychainPopulated = exports.checkProtonCli = exports.getTableRows = exports.execTransactionPush = exports.execAction = exports.createCliApi = exports.createCliSession = void 0;
exports.default = xprAgentsPlugin;
const session_1 = require("./session");
const agent_1 = require("./tools/agent");
const feedback_1 = require("./tools/feedback");
const validation_1 = require("./tools/validation");
const escrow_1 = require("./tools/escrow");
const indexer_1 = require("./tools/indexer");
const a2a_1 = require("./tools/a2a");
const shellbook_1 = require("./tools/shellbook");
// Re-export CLI session factories. Used by skill packages to obtain a
// signing session backed by the proton CLI (no private key in process).
var cli_session_1 = require("./cli-session");
Object.defineProperty(exports, "createCliSession", { enumerable: true, get: function () { return cli_session_1.createCliSession; } });
Object.defineProperty(exports, "createCliApi", { enumerable: true, get: function () { return cli_session_1.createCliApi; } });
var proton_cli_1 = require("./proton-cli");
Object.defineProperty(exports, "execAction", { enumerable: true, get: function () { return proton_cli_1.execAction; } });
Object.defineProperty(exports, "execTransactionPush", { enumerable: true, get: function () { return proton_cli_1.execTransactionPush; } });
Object.defineProperty(exports, "getTableRows", { enumerable: true, get: function () { return proton_cli_1.getTableRows; } });
Object.defineProperty(exports, "checkProtonCli", { enumerable: true, get: function () { return proton_cli_1.checkProtonCli; } });
Object.defineProperty(exports, "checkKeychainPopulated", { enumerable: true, get: function () { return proton_cli_1.checkKeychainPopulated; } });
Object.defineProperty(exports, "ProtonCliError", { enumerable: true, get: function () { return proton_cli_1.ProtonCliError; } });
/**
 * Create an adapter that bridges the real OpenClaw API to our internal PluginApi.
 * This lets all 57 tool registrations work unchanged.
 */
function createAdapter(realApi) {
    return {
        registerTool(tool) {
            realApi.registerTool({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
                async execute(_id, params) {
                    const result = await tool.handler(params);
                    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                    return { content: [{ type: 'text', text }] };
                },
            });
        },
        getConfig() {
            return realApi.pluginConfig || {};
        },
    };
}
function xprAgentsPlugin(realApi) {
    // Detect whether we're running inside the real OpenClaw runtime or in tests.
    // Real OpenClaw API has pluginConfig property; our test mock has getConfig method.
    const api = typeof realApi.getConfig === 'function'
        ? realApi
        : createAdapter(realApi);
    const rawConfig = api.getConfig();
    const network = rawConfig.network || 'mainnet';
    const defaultRpc = network === 'mainnet' ? 'https://proton.eosusa.io' : 'https://tn1.protonnz.com';
    const rpcEndpoint = rawConfig.rpcEndpoint || process.env.XPR_RPC_ENDPOINT || defaultRpc;
    // Signing is enabled when XPR_ACCOUNT is set. The proton CLI handles the
    // private key — the agent process never sees it. Verifying CLI presence
    // is the entry-point's job (starter/agent/src/index.ts), not the plugin's.
    const hasCredentials = !!process.env.XPR_ACCOUNT;
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
        network: rawConfig.network || 'mainnet',
        rpcEndpoint,
        indexerUrl: rawConfig.indexerUrl || process.env.INDEXER_URL || 'https://indexer.xpragents.com',
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
    (0, shellbook_1.registerShellbookTools)(api);
    if (!hasCredentials) {
        console.log('[xpr-agents] Read-only mode: XPR_ACCOUNT not set. Write tools will fail.');
    }
    console.log(`[xpr-agents] Plugin loaded: ${config.network} (${rpcEndpoint})`);
}
//# sourceMappingURL=index.js.map
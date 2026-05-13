"use strict";
/**
 * Server-side ProtonSession factory.
 *
 * This module previously held a JsSignatureProvider that loaded
 * XPR_PRIVATE_KEY into the agent process. After the 2026-04-24 charliebot
 * incident — where a hardcoded private key was leaked to a public repo —
 * all signing was moved to the proton CLI's encrypted keychain.
 *
 * This file is now a thin wrapper around createCliSession.
 *
 * Required env: XPR_ACCOUNT
 * Optional env: XPR_PERMISSION (defaults to 'active'), XPR_RPC_ENDPOINT
 *
 * The agent process MUST NOT read XPR_PRIVATE_KEY. The legacy entry-point
 * check in starter/agent/src/index.ts refuses to start if it is set.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSession = createSession;
exports.createReadOnlyRpc = createReadOnlyRpc;
const js_1 = require("@proton/js");
const cli_session_1 = require("./cli-session");
/**
 * Create a server-side ProtonSession backed by the proton CLI.
 * No private key required — the CLI signs internally via its keychain.
 */
function createSession(config) {
    const account = config.account || process.env.XPR_ACCOUNT;
    const permission = config.permission || process.env.XPR_PERMISSION || 'active';
    if (!account) {
        throw new Error('XPR_ACCOUNT environment variable is required');
    }
    return (0, cli_session_1.createCliSession)({ account, permission, rpcEndpoint: config.rpcEndpoint });
}
/**
 * Create a read-only RPC connection (no session/signing needed).
 */
function createReadOnlyRpc(rpcEndpoint) {
    return new js_1.JsonRpc(rpcEndpoint);
}
//# sourceMappingURL=session.js.map
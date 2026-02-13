"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSession = createSession;
exports.createReadOnlyRpc = createReadOnlyRpc;
const js_1 = require("@proton/js");
/**
 * Create a server-side ProtonSession from environment variables.
 * Uses @proton/js (no browser dependency).
 *
 * Required env vars: XPR_PRIVATE_KEY, XPR_ACCOUNT
 * Optional: XPR_PERMISSION (defaults to 'active')
 */
function createSession(config) {
    const privateKey = config.privateKey || process.env.XPR_PRIVATE_KEY;
    const account = config.account || process.env.XPR_ACCOUNT;
    const permission = config.permission || process.env.XPR_PERMISSION || 'active';
    if (!privateKey) {
        throw new Error('XPR_PRIVATE_KEY environment variable is required');
    }
    if (!account) {
        throw new Error('XPR_ACCOUNT environment variable is required');
    }
    const rpc = new js_1.JsonRpc(config.rpcEndpoint);
    const signatureProvider = new js_1.JsSignatureProvider([privateKey]);
    const api = new js_1.Api({ rpc, signatureProvider });
    const session = {
        auth: { actor: account, permission },
        link: {
            transact: async (args) => {
                const result = await api.transact({ actions: args.actions }, { blocksBehind: 3, expireSeconds: 30 });
                return result;
            },
        },
    };
    return { rpc, session };
}
/**
 * Create a read-only RPC connection (no session/signing needed).
 */
function createReadOnlyRpc(rpcEndpoint) {
    return new js_1.JsonRpc(rpcEndpoint);
}
//# sourceMappingURL=session.js.map
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
import { JsonRpc } from '@proton/js';
import type { ProtonSession } from '@xpr-agents/sdk';
export interface SessionConfig {
    rpcEndpoint: string;
    account?: string;
    permission?: string;
}
/**
 * Create a server-side ProtonSession backed by the proton CLI.
 * No private key required — the CLI signs internally via its keychain.
 */
export declare function createSession(config: SessionConfig): {
    rpc: JsonRpc;
    session: ProtonSession;
};
/**
 * Create a read-only RPC connection (no session/signing needed).
 */
export declare function createReadOnlyRpc(rpcEndpoint: string): JsonRpc;
//# sourceMappingURL=session.d.ts.map
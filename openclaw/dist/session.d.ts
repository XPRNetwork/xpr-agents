import { JsonRpc } from '@proton/js';
import type { ProtonSession } from '@xpr-agents/sdk';
export interface SessionConfig {
    rpcEndpoint: string;
    privateKey?: string;
    account?: string;
    permission?: string;
}
/**
 * Create a server-side ProtonSession from environment variables.
 * Uses @proton/js (no browser dependency).
 *
 * Required env vars: XPR_PRIVATE_KEY, XPR_ACCOUNT
 * Optional: XPR_PERMISSION (defaults to 'active')
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
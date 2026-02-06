import { Api, JsonRpc, JsSignatureProvider } from '@proton/js';
import type { ProtonSession, TransactArgs, TransactionResult } from '@xpr-agents/sdk';

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
export function createSession(config: SessionConfig): { rpc: JsonRpc; session: ProtonSession } {
  const privateKey = config.privateKey || process.env.XPR_PRIVATE_KEY;
  const account = config.account || process.env.XPR_ACCOUNT;
  const permission = config.permission || process.env.XPR_PERMISSION || 'active';

  if (!privateKey) {
    throw new Error('XPR_PRIVATE_KEY environment variable is required');
  }
  if (!account) {
    throw new Error('XPR_ACCOUNT environment variable is required');
  }

  const rpc = new JsonRpc(config.rpcEndpoint);
  const signatureProvider = new JsSignatureProvider([privateKey]);
  const api = new Api({ rpc, signatureProvider });

  const session: ProtonSession = {
    auth: { actor: account, permission },
    link: {
      transact: async (args: TransactArgs): Promise<TransactionResult> => {
        const result = await api.transact(
          { actions: args.actions },
          { blocksBehind: 3, expireSeconds: 30 }
        );
        return result as unknown as TransactionResult;
      },
    },
  };

  return { rpc, session };
}

/**
 * Create a read-only RPC connection (no session/signing needed).
 */
export function createReadOnlyRpc(rpcEndpoint: string): JsonRpc {
  return new JsonRpc(rpcEndpoint);
}

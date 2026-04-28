/**
 * CLI-backed session factories.
 *
 * Provides two shapes from the same underlying proton CLI wrapper:
 *
 * 1. createCliSession() → ProtonSession (SDK shape)
 *      Used by openclaw/src/session.ts and downstream tools/registries.
 *      Preserves the SDK's public ProtonSession interface — no changes to
 *      sdk/src/types.ts, no breaking changes for SDK consumers.
 *
 * 2. createCliApi() → eosjs-Api lookalike + auth metadata
 *      Used by skill files (defi, nft, lending, governance, xmd) that
 *      previously called `await session.api.transact({actions}, options)`.
 *      The .transact() signature matches eosjs so handler bodies need no
 *      changes — only the session factory swaps.
 *
 * Both shapes route every signed action through `proton transaction:push`.
 * Neither holds, reads, or transmits private key material.
 */

import { JsonRpc } from '@proton/js';
import type { ProtonSession, TransactArgs, TransactionResult } from '@xpr-agents/sdk';
import { execTransactionPush, type CliAction } from './proton-cli';

const DEFAULT_PERMISSION = 'active';

export interface CliSessionOptions {
  account: string;
  permission?: string;
  rpcEndpoint?: string;
}

/**
 * Result of CLI signing, normalised to the SDK's TransactionResult shape.
 * `processed` is best-effort: proton CLI returns the full Hyperion-style
 * trace, but we only surface block_num and block_time for SDK compatibility.
 */
function normaliseResult(result: { transaction_id: string; processed?: unknown }): TransactionResult {
  const processed = result.processed as
    | { block_num?: number; block_time?: string; receipt?: { block_num?: number } }
    | undefined;
  return {
    transaction_id: result.transaction_id,
    processed: {
      block_num: processed?.block_num ?? processed?.receipt?.block_num ?? 0,
      block_time: processed?.block_time ?? '',
    },
  };
}

function toCliActions(actions: TransactArgs['actions']): CliAction[] {
  return actions.map((a) => ({
    account: a.account,
    name: a.name,
    authorization: a.authorization,
    data: a.data,
  }));
}

/**
 * Create a ProtonSession (SDK shape) backed by the proton CLI.
 * No private key required — the CLI signs internally via its keychain.
 */
export function createCliSession(opts: CliSessionOptions): {
  rpc: JsonRpc;
  session: ProtonSession;
} {
  const account = opts.account;
  const permission = opts.permission ?? DEFAULT_PERMISSION;
  const rpcEndpoint = opts.rpcEndpoint ?? 'https://proton.greymass.com';

  const rpc = new JsonRpc(rpcEndpoint);

  const session: ProtonSession = {
    auth: { actor: account, permission },
    link: {
      transact: async (args: TransactArgs): Promise<TransactionResult> => {
        const result = await execTransactionPush({ actions: toCliActions(args.actions) });
        return normaliseResult(result);
      },
    },
  };

  return { rpc, session };
}

/**
 * Lightweight Api lookalike returned by createCliApi(). Matches the subset
 * of eosjs Api that the 5 signing skills use.
 */
export interface CliApi {
  transact(
    tx: { actions: TransactArgs['actions'] },
    options?: { blocksBehind?: number; expireSeconds?: number },
  ): Promise<TransactionResult>;
}

/**
 * Create an eosjs-Api lookalike backed by the proton CLI.
 * Drop-in replacement for the `api` returned by skill `getSession()`
 * functions that used to construct `new Api({ rpc, signatureProvider })`.
 *
 * The blocksBehind/expireSeconds options are accepted but ignored —
 * proton CLI manages tx headers internally. Skill code remains unchanged.
 */
export function createCliApi(opts: CliSessionOptions): {
  api: CliApi;
  account: string;
  permission: string;
} {
  const account = opts.account;
  const permission = opts.permission ?? DEFAULT_PERMISSION;

  const api: CliApi = {
    transact: async (tx, _options) => {
      const result = await execTransactionPush({ actions: toCliActions(tx.actions) });
      return normaliseResult(result);
    },
  };

  return { api, account, permission };
}

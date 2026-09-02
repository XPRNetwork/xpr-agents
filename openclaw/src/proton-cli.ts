/**
 * Proton CLI wrapper.
 *
 * Shells out to the `proton` CLI for all transaction signing. The agent
 * process never touches private keys — they live exclusively in the CLI's
 * encrypted keychain.
 *
 * Used by:
 *   - openclaw/src/session.ts (createCliSession factory)
 *   - openclaw/src/cli-session.ts (createCliApi factory)
 *   - openclaw/starter/agent/skills/* (via @xpr-agents/openclaw)
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const CLI_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

export type CliErrorCode = 'network' | 'auth' | 'serialization' | 'reverted' | 'unknown';

export class ProtonCliError extends Error {
  readonly code: CliErrorCode;
  readonly stderr: string;

  constructor(message: string, code: CliErrorCode, stderr: string) {
    super(message);
    this.name = 'ProtonCliError';
    this.code = code;
    this.stderr = stderr;
  }
}

export interface CliAction {
  account: string;
  name: string;
  authorization: Array<{ actor: string; permission: string }>;
  data: Record<string, unknown>;
}

export interface CliTransactionResult {
  transaction_id: string;
  processed?: unknown;
}

export interface TableQueryOpts {
  limit?: number;
  lower_bound?: string;
  upper_bound?: string;
  reverse?: boolean;
  index_position?: number;
  key_type?: string;
}

/**
 * Categorise an error from the CLI by stderr signature.
 * Default to 'unknown' — pattern set is intentionally narrow.
 */
function classifyError(stderr: string): CliErrorCode {
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed|getaddrinfo|ENETUNREACH/i.test(stderr)) {
    return 'network';
  }
  if (/no key found|key is not unlocked|account .* not found|signature_provider/i.test(stderr)) {
    return 'auth';
  }
  if (/unable to unpack|invalid type|cannot serialize|unknown action|unknown_action_exception/i.test(stderr)) {
    return 'serialization';
  }
  if (/assertion failure|eosio_assert|action_validate_exception/i.test(stderr)) {
    return 'reverted';
  }
  return 'unknown';
}

/**
 * Remove anything that looks like action data payload from stderr before logging.
 * Action data may contain memos, addresses, or other potentially sensitive info.
 */
function scrubStderr(stderr: string): string {
  if (!stderr) return '';
  return stderr
    // Strip "data": { ... } blocks (single-line and multi-line)
    .replace(/"data"\s*:\s*\{[^}]*\}/gs, '"data":[scrubbed]')
    // Strip hex_data blocks
    .replace(/"hex_data"\s*:\s*"[^"]*"/g, '"hex_data":"[scrubbed]"');
}

function logStart(contract: string, action: string, auth: string): void {
  console.error(`[proton-cli] action ${contract}::${action} auth=${auth}`);
}

function logSuccess(txid: string, ms: number): void {
  console.error(`[proton-cli] tx ${txid} ok in ${ms}ms`);
}

function logFailure(code: CliErrorCode, scrubbed: string): void {
  // Cap stderr in logs to avoid flooding
  const snippet = scrubbed.length > 500 ? scrubbed.slice(0, 500) + '...' : scrubbed;
  console.error(`[proton-cli] tx FAILED: ${code} ${snippet}`);
}

/**
 * Parse the transaction ID from proton CLI stdout.
 * Output is JSON containing a transaction_id (or trx_id) field.
 */
/**
 * `proton action` can exit 0 while printing a chain error (e.g. an
 * eosio_assert from the contract). Surface that text so callers see the real
 * reason instead of a generic "no transaction ID" message.
 */
function noTxIdError(stdout: string): ProtonCliError {
  const assertion = stdout.match(/assertion failure with message:\s*([^\n"]+)/i);
  if (assertion) {
    return new ProtonCliError(`contract rejected the action: ${assertion[1].trim()}`, 'reverted', scrubStderr(stdout));
  }
  const generic = stdout.match(/(?:^|\n)\s*(?:Error|error)[:\s]+([^\n]+)/);
  if (generic) {
    return new ProtonCliError(`proton CLI error: ${generic[1].trim()}`, classifyError(stdout), scrubStderr(stdout));
  }
  return new ProtonCliError('proton CLI returned success but no transaction ID could be parsed', 'unknown', stdout);
}

function parseTxId(stdout: string): string | null {
  const txMatch = stdout.match(/"transaction_id"\s*:\s*"([0-9a-f]+)"/);
  if (txMatch) return txMatch[1];
  const trxMatch = stdout.match(/"trx_id"\s*:\s*"([0-9a-f]+)"/);
  return trxMatch ? trxMatch[1] : null;
}

/**
 * Try to parse the full processed result block from stdout. Best-effort.
 */
function tryParseProcessed(stdout: string): unknown {
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && typeof parsed === 'object' && 'processed' in parsed) {
      return (parsed as { processed: unknown }).processed;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Run the proton CLI with the given arguments. Always uses execFile (no shell).
 */
async function runProton(args: string[]): Promise<{ stdout: string }> {
  try {
    const result = await execFileAsync('proton', args, {
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    return { stdout: result.stdout };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    const stderrRaw = (e.stderr || '') + (e.message || '');
    const scrubbed = scrubStderr(stderrRaw);
    const code = classifyError(stderrRaw);
    logFailure(code, scrubbed);
    throw new ProtonCliError(`proton CLI failed: ${code}`, code, scrubbed);
  }
}

/**
 * Sign and submit a single action via `proton action`.
 *
 * @param contract - Contract account (e.g. 'agentescrow')
 * @param action - Action name (e.g. 'createjob')
 * @param data - Positional args matching the contract's action ABI
 * @param authorization - "account@permission" string (e.g. "alice@active")
 */
export async function execAction(
  contract: string,
  action: string,
  data: unknown[],
  authorization: string,
): Promise<CliTransactionResult> {
  logStart(contract, action, authorization);
  const start = Date.now();
  const dataJson = JSON.stringify(data);
  const { stdout } = await runProton(['action', contract, action, dataJson, authorization]);
  const txid = parseTxId(stdout);
  if (!txid) {
    throw noTxIdError(stdout);
  }
  logSuccess(txid, Date.now() - start);
  return { transaction_id: txid, processed: tryParseProcessed(stdout) };
}

/**
 * Sign and submit a multi-action atomic transaction via `proton transaction:push`.
 *
 * NOTE: do NOT use the bare `proton transaction` command — it does not
 * JSON.parse its argument (bug in @proton/cli). Use `transaction:push` exclusively.
 */
export async function execTransactionPush(
  tx: { actions: CliAction[] },
): Promise<CliTransactionResult> {
  if (!tx.actions || tx.actions.length === 0) {
    throw new ProtonCliError('execTransactionPush: empty actions array', 'unknown', '');
  }
  const first = tx.actions[0];
  const auth = first.authorization[0];
  logStart(first.account, first.name, `${auth.actor}@${auth.permission}`);
  const start = Date.now();
  const txJson = JSON.stringify(tx);
  const { stdout } = await runProton(['transaction:push', txJson]);
  const txid = parseTxId(stdout);
  if (!txid) {
    throw noTxIdError(stdout);
  }
  logSuccess(txid, Date.now() - start);
  return { transaction_id: txid, processed: tryParseProcessed(stdout) };
}

/**
 * Read-only table query via `proton table`. No signing required.
 */
export async function getTableRows(
  code: string,
  table: string,
  scope?: string,
  opts?: TableQueryOpts,
): Promise<unknown> {
  const args = ['table', code, table];
  if (scope) args.push(scope);
  if (opts?.limit !== undefined) args.push('-c', String(opts.limit));
  if (opts?.lower_bound !== undefined) args.push('-l', opts.lower_bound);
  if (opts?.upper_bound !== undefined) args.push('-u', opts.upper_bound);
  if (opts?.reverse) args.push('-r');
  if (opts?.index_position !== undefined) args.push('-i', String(opts.index_position));
  if (opts?.key_type !== undefined) args.push('-k', opts.key_type);
  const { stdout } = await runProton(args);
  try {
    return JSON.parse(stdout);
  } catch {
    throw new ProtonCliError('proton table returned invalid JSON', 'unknown', stdout);
  }
}

/**
 * Verify the proton CLI is installed and on PATH. Used by startup checks.
 */
export async function checkProtonCli(): Promise<boolean> {
  try {
    await execFileAsync('proton', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify the proton CLI keychain has at least one key registered.
 * Soft check — this doesn't verify any specific account, just that
 * a keychain exists. The CLI itself will fail with auth code if the
 * specific account's key is missing.
 */
export async function checkKeychainPopulated(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('proton', ['key:list'], { timeout: 5000 });
    return stdout.includes('publicKey');
  } catch {
    return false;
  }
}

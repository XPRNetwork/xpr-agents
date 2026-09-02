/**
 * Deterministic escrow housekeeping for the poller (no LLM involved).
 *
 * Decides which of this account's jobs can be closed out on chain right now:
 *
 * - As the AGENT: a job we delivered that the client never approved. Once the
 *   deadline and the client's dispute window have both passed, `timeout`
 *   auto-approves it and pays us.
 * - As the CLIENT: a job we funded that the agent never delivered by the
 *   deadline. `timeout` refunds us.
 * - As the CLIENT: an open or direct-hire job we created that was never funded
 *   and is past its deadline. `cancel` removes it from the board.
 *
 * Mirrors the agentescrow contract rules:
 *   timeout: now > deadline; state 1..4; state 4 requires claimer == agent and
 *            now > updated_at + dispute_window; states 1..3 require claimer == client.
 *   cancel:  client only; state 0 (unfunded) or 1 (funded, not yet accepted).
 */

export interface EscrowJobLike {
  id: number;
  client: string;
  agent: string;
  state: number | string; // contract code or SDK label ('delivered', ...)
  deadline: number;     // unix seconds
  updated_at: number;   // unix seconds
}

export type HousekeepingKind = 'claim_payment' | 'refund' | 'cancel';

export interface HousekeepingAction {
  kind: HousekeepingKind;
  job: EscrowJobLike;
  reason: string;
}

export interface HousekeepingOptions {
  /** Account this runner signs as. */
  account: string;
  /** Current time in unix seconds. */
  nowSec: number;
  /** agentescrow config.dispute_window in seconds (default 3 days). */
  disputeWindowSec?: number;
  /** Previous attempt counts per job id; jobs at or over maxAttempts are skipped. */
  attempts?: Map<number, number>;
  /** Give up after this many failed attempts per job (default 3). */
  maxAttempts?: number;
}

export const DEFAULT_DISPUTE_WINDOW_SEC = 259200;
export const DEFAULT_MAX_TIMEOUT_ATTEMPTS = 3;

const EMPTY_NAME = '.............';

function isEmptyAgent(agent: string | undefined | null): boolean {
  return !agent || agent === '' || agent === EMPTY_NAME;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Job states as the contract numbers them; the SDK reports the lower-case labels. */
export const JOB_STATE_LABELS = [
  'created', 'funded', 'accepted', 'inprogress',
  'delivered', 'disputed', 'completed', 'refunded', 'arbitrated',
] as const;

/**
 * Normalise a job state to the contract's numeric code. Accepts numbers,
 * numeric strings and SDK labels (case-insensitive, `in_progress` too).
 * Returns -1 for anything unrecognised so callers skip the job instead of
 * mistaking it for CREATED (0).
 */
export function normalizeJobState(v: unknown): number {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 8 ? v : -1;
  if (typeof v !== 'string') return -1;
  const t = v.trim().toLowerCase().replace(/[\s_-]/g, '');
  if (/^[0-8]$/.test(t)) return Number(t);
  const i = (JOB_STATE_LABELS as readonly string[]).indexOf(t);
  return i;
}

/**
 * Pure selector: given jobs this account is party to, return the actions that
 * the contract would accept right now. Safe to call every poll cycle.
 */
export function findHousekeepingActions(jobs: EscrowJobLike[], opts: HousekeepingOptions): HousekeepingAction[] {
  const window = opts.disputeWindowSec ?? DEFAULT_DISPUTE_WINDOW_SEC;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_TIMEOUT_ATTEMPTS;
  const out: HousekeepingAction[] = [];
  const seen = new Set<number>();

  for (const job of jobs) {
    if (!job || job.id == null || seen.has(job.id)) continue;
    seen.add(job.id);
    if ((opts.attempts?.get(job.id) ?? 0) >= maxAttempts) continue;

    const state = normalizeJobState(job.state);
    if (state < 0) continue; // unknown state: never guess
    const deadline = num(job.deadline);
    const updatedAt = num(job.updated_at);
    const pastDeadline = deadline > 0 && opts.nowSec > deadline;
    const isAgent = job.agent === opts.account;
    const isClient = job.client === opts.account;

    if (isAgent && state === 4) {
      if (pastDeadline && opts.nowSec > updatedAt + window) {
        out.push({ kind: 'claim_payment', job, reason: 'delivered, deadline and client review window passed' });
      }
      continue;
    }

    if (isClient && !isAgent) {
      if (state === 0 && pastDeadline) {
        out.push({ kind: 'cancel', job, reason: 'unfunded past deadline' });
      } else if ((state === 1 || state === 2 || state === 3) && pastDeadline) {
        // State 1 with an assigned agent could also be cancelled, but timeout works
        // for all three undelivered states and refunds the same way.
        const label = state === 1 ? 'funded' : state === 2 ? 'accepted' : 'in progress';
        out.push({ kind: 'refund', job, reason: `${label}, not delivered by deadline` });
      }
    }
  }
  return out;
}

/** Human-readable one-liner for logs. */
export function describeHousekeeping(a: HousekeepingAction): string {
  const who = a.kind === 'claim_payment' ? 'agent' : 'client';
  const target = a.kind === 'cancel'
    ? 'cancel'
    : a.kind === 'refund' ? 'timeout (refund)' : 'timeout (claim payment)';
  const counterparty = a.kind === 'claim_payment' ? a.job.client : (isEmptyAgent(a.job.agent) ? 'no agent' : a.job.agent);
  return `job #${a.job.id} as ${who}: ${target} — ${a.reason} (${counterparty})`;
}

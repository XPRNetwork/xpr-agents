/**
 * Plain-language translations of the contract's `check()` assertions.
 *
 * Wallet failures reach the page as `Error`s whose message embeds the chain's
 * assertion text, usually as `assertion failure with message: <text>`. Showing
 * that raw string is how a buyer ends up staring at "Transaction Error: Service
 * is not active" with no idea what to do next, so every message the site can
 * provoke gets a title, a detail and — where there is one — a next step.
 *
 * Deliberately dependency-free: no `@proton/js`, no registry import, so it can
 * be unit-tested with `node --import ./scripts/ts-loader.mjs`.
 */

export interface ChainErrorExplanation {
  /** Short headline, sentence case, no trailing period. */
  title: string;
  /** One or two sentences saying what happened. */
  detail: string;
  /** What the reader can do about it, when there is something to do. */
  hint?: string;
}

const ASSERTION_PREFIXES = [
  /^assertion failure with message:\s*/i,
  /^eosio_assert(_message)? assertion failure:?\s*/i,
  /^transaction error:\s*/i,
  /^error:\s*/i,
];

/**
 * Best-effort extraction of the assertion text from whatever the wallet threw:
 * an `Error`, a bare string, an RPC error envelope (`json.error.details[]`), or
 * a `{ message }`-ish object.
 */
export function rawChainMessage(err: unknown): string {
  if (err === null || err === undefined) return '';
  if (typeof err === 'string') return err.trim();

  const anyErr = err as Record<string, any>;

  // EOSIO RPC envelope — the useful line lives in error.details, not in `message`.
  const details =
    anyErr?.json?.error?.details ??
    anyErr?.error?.details ??
    anyErr?.details;
  if (Array.isArray(details)) {
    const detailMsg = details
      .map((d: any) => (typeof d === 'string' ? d : d?.message))
      .filter((m: unknown): m is string => typeof m === 'string' && m.length > 0)
      .find((m) => /assertion failure/i.test(m)) ?? details
      .map((d: any) => (typeof d === 'string' ? d : d?.message))
      .find((m: unknown) => typeof m === 'string' && (m as string).length > 0);
    if (typeof detailMsg === 'string' && detailMsg.trim()) return detailMsg.trim();
  }

  const what = anyErr?.json?.error?.what ?? anyErr?.error?.what;
  if (typeof what === 'string' && what.trim() && !/assertion failure/i.test(what)) {
    // `what` is usually the generic "assertion failure" wrapper; only useful alone.
    if (typeof anyErr?.message !== 'string') return what.trim();
  }

  if (typeof anyErr?.message === 'string' && anyErr.message.trim()) return anyErr.message.trim();
  if (typeof what === 'string' && what.trim()) return what.trim();

  try {
    const s = String(err);
    return s === '[object Object]' ? '' : s.trim();
  } catch {
    return '';
  }
}

/** Strips the wrapper the wallet puts in front of the contract's own text. */
export function stripAssertionPrefix(message: string): string {
  let out = message.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of ASSERTION_PREFIXES) {
      if (prefix.test(out)) {
        out = out.replace(prefix, '').trim();
        changed = true;
      }
    }
  }
  // Some wallets append the console/pending-block noise after a newline.
  out = out.split('\n')[0].trim();
  return out;
}

interface Rule {
  match: RegExp;
  title: string;
  detail: string;
  hint?: string;
}

/**
 * Ordered — first match wins, so put the specific listing/service rules above
 * the broad "Only … can" and "Job must be …" catch-alls.
 */
const RULES: Rule[] = [
  // --- the buyer cancelled, not a chain failure ----------------------------
  {
    match: /user (rejected|cancelled|canceled|declined)|request (rejected|cancelled|canceled)|cancell?ed by user|closed the (popup|window)|Modal closed/i,
    title: 'Signing cancelled',
    detail: 'You closed the wallet before approving, so nothing was sent and no XPR left your account.',
    hint: 'Press Buy again when you are ready.',
  },

  // --- services / buy path -------------------------------------------------
  {
    match: /Service not found/i,
    title: 'That listing no longer exists',
    detail: 'The service was removed from the registry, so there is nothing to buy at this address.',
    hint: 'Browse the seller’s other services, or the full catalogue.',
  },
  {
    match: /Service is not active/i,
    title: 'This listing was delisted',
    detail: 'The seller took it off the catalogue while this page was open, so the purchase was refused. Nothing was charged.',
    hint: 'Reload the page — sellers usually relist the same offer under a new service number.',
  },
  {
    match: /Cannot buy your own service/i,
    title: 'This is your own listing',
    detail: 'The registry will not let an agent buy from itself.',
    hint: 'Use a different account to test the purchase flow.',
  },
  {
    match: /Client cannot hire an agent they own/i,
    title: 'You own this agent',
    detail: 'The registry blocks a KYC’d owner from hiring their own agent, so escrow cannot be self-dealt.',
    hint: 'Buy from another account.',
  },
  {
    match: /Agent is not active/i,
    title: 'The seller is offline',
    detail: 'This agent has been deactivated in the registry, so it cannot take new work.',
    hint: 'Check the agent’s profile, or find another agent offering the same service.',
  },
  {
    match: /Insufficient payment/i,
    title: 'The price changed',
    detail: 'The amount sent is below the listing’s current price — the seller repriced it while this page was open.',
    hint: 'Reload the page and buy at the new price.',
  },
  {
    match: /Contract is paused/i,
    title: 'The escrow contract is paused',
    detail: 'Purchases, funding and payouts are temporarily halted by the registry operators. No funds moved.',
    hint: 'Try again shortly — existing jobs and balances are unaffected.',
  },
  {
    match: /Buyer notes must be <= 200 characters/i,
    title: 'Your note is too long',
    detail: 'The note travels in the transfer memo, which the contract caps at 200 characters.',
    hint: 'Shorten the note, or post a custom job for a longer brief.',
  },

  // --- svcinput (the form answers sent with a purchase) --------------------
  {
    match: /No recent purchase/i,
    title: 'No purchase to attach this to',
    detail: 'The form answers must ride along with the buy transfer, and the contract found no matching purchase for your account.',
    hint: 'Buy the service again — the answers are sent in the same transaction.',
  },
  {
    match: /Purchase input window closed/i,
    title: 'Too late to attach your answers',
    detail: 'The contract only accepts the intake form right after the purchase, and that window has closed.',
    hint: 'Open the job and send the details as a message to the agent instead.',
  },
  {
    match: /Message must be 1-512 characters/i,
    title: 'Message length out of range',
    detail: 'Job messages have to be between 1 and 512 characters.',
    hint: 'Shorten your answers and send again.',
  },
  {
    match: /Job message limit reached/i,
    title: 'This job has hit its message limit',
    detail: 'A job accepts a fixed number of messages, and this one is full.',
    hint: 'Continue in the deliverables or raise a dispute if the work has stalled.',
  },

  // --- job lifecycle -------------------------------------------------------
  {
    match: /Rate limit exceeded/i,
    title: 'Rate limited',
    detail: 'The registry allows one review per agent every 24 hours to keep ratings honest.',
    hint: 'Try again tomorrow.',
  },
  {
    match: /Deadline not reached/i,
    title: 'The deadline has not passed yet',
    detail: 'A timeout can only be claimed once the job’s deadline is in the past.',
    hint: 'Wait for the deadline shown on the job, then try again.',
  },
  {
    match: /Client dispute window still open/i,
    title: 'The client can still respond',
    detail: 'After a delivery the client gets a window to approve, request changes or dispute. Payment cannot be auto-released until it closes.',
    hint: 'Wait for the window to close, then claim the timeout.',
  },
  {
    match: /Dispute window has passed/i,
    title: 'The dispute window has closed',
    detail: 'Too much time has passed since the delivery to request changes.',
    hint: 'Approve the job, or raise a dispute if the work is unacceptable.',
  },
  {
    match: /Insufficient funding/i,
    title: 'The job is not fully funded',
    detail: 'The escrow holds less than this action needs to pay out.',
    hint: 'Fund the job for the remaining amount first.',
  },
  {
    match: /overdrawn balance|Overdrawn balance/i,
    title: 'Not enough XPR',
    detail: 'Your account balance is lower than the amount this transaction sends.',
    hint: 'Top the account up and try again.',
  },
  {
    match: /^Only .+ can /i,
    title: 'Wrong account for this action',
    detail: 'The contract restricts this action to one side of the job, and the connected account is not it.',
    hint: 'Switch to the account that owns this job, then try again.',
  },
  {
    match: /^Job must be /i,
    title: 'The job has moved on',
    detail: 'This action only applies at a particular stage, and the job is no longer at that stage.',
    hint: 'Reload the job page to see where it actually stands.',
  },
];

/** Sentence-case a bare assertion so the fallback still reads like prose. */
function tidyFallback(text: string): string {
  if (!text) return '';
  const trimmed = text.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Maps whatever the wallet or RPC threw onto a title / detail / hint the buyer
 * can act on. Always returns something — an unknown assertion is shown with the
 * `assertion failure with message:` wrapper stripped off.
 */
export function explainChainError(err: unknown): ChainErrorExplanation {
  const raw = rawChainMessage(err);
  const message = stripAssertionPrefix(raw);

  for (const rule of RULES) {
    if (rule.match.test(message)) {
      return { title: rule.title, detail: rule.detail, hint: rule.hint };
    }
  }

  if (!message) {
    return {
      title: 'The transaction did not go through',
      detail: 'The wallet returned no reason. Nothing was charged unless you saw a confirmation.',
      hint: 'Try again — if it keeps failing, reload the page.',
    };
  }

  return {
    title: 'The chain rejected this transaction',
    detail: `${tidyFallback(message)}.`,
    hint: 'Reload the page — the on-chain state may have changed since it loaded.',
  };
}

/** One-line form for toasts, which only take a string. */
export function chainErrorLine(err: unknown): string {
  const { title, detail } = explainChainError(err);
  return `${title} — ${detail}`;
}

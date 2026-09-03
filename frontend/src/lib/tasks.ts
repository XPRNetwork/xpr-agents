/**
 * Outstanding tasks for a connected account: everything on the board that is
 * waiting on this account to act, as a client, as an agent, or as a seller.
 *
 * Pure computation over data the site already fetches, so it can be unit
 * tested and reused by the header bell and the dashboard inbox.
 */
import type { Job, JobMessage, Bid, Feedback, ServiceDeposit, EscrowConfig } from './registry';

export type TaskKind =
  | 'review_delivery'
  | 'answer_question'
  | 'select_bid'
  | 'fund_job'
  | 'reclaim_refund'
  | 'leave_review'
  | 'accept_job'
  | 'revise_job'
  | 'awaiting_answer'
  | 'claim_payment'
  | 'reclaim_fee';

export interface Task {
  /** Stable id; changes when the underlying state changes so a seen task re-notifies. */
  id: string;
  kind: TaskKind;
  /** 0 = money or deadline at stake, 1 = someone is waiting on you, 2 = housekeeping. */
  priority: 0 | 1 | 2;
  title: string;
  detail: string;
  href: string;
  action: string;
  /** Unix seconds when this stops being actionable or becomes urgent, if any. */
  due?: number;
  role: 'client' | 'agent' | 'seller';
}

export interface TaskInputs {
  account: string;
  asClient: Job[];
  asAgent: Job[];
  /** Messages per job id, only needed for jobs in states 1–3. */
  messages: Record<number, JobMessage[]>;
  /** Bids per open job id the account created. */
  bids: Record<number, Bid[]>;
  /** Reviews this account has written (to find completed jobs not yet rated). */
  myReviews: Feedback[];
  deposit: ServiceDeposit | null;
  config: EscrowConfig | null;
  /** Whether the account is a registered agent (agent-side tasks apply). */
  isAgent: boolean;
  now: number;
}

const DAY = 86400;
const DEFAULT_WINDOW = 259200;
const FEE_REFUND_DELAY = 7 * DAY;

function short(title: string, n = 48): string {
  return title.length > n ? title.slice(0, n - 1) + '…' : title;
}

export function computeTasks(i: TaskInputs): Task[] {
  const out: Task[] = [];
  const window = i.config?.dispute_window || DEFAULT_WINDOW;
  const reviewed = new Set(i.myReviews.map(f => String(f.job_hash).trim()));
  // agentfeed allows one review per reviewer per agent per 24h; do not offer one that would bounce.
  const lastReviewOfAgent: Record<string, number> = {};
  for (const f of i.myReviews) lastReviewOfAgent[f.agent] = Math.max(lastReviewOfAgent[f.agent] || 0, f.timestamp);
  const reviewAvailableAt = (agent: string) => (lastReviewOfAgent[agent] || 0) + DAY;

  // ── As a client ──
  for (const j of i.asClient) {
    const href = `/jobs/${j.id}`;
    const msgs = i.messages[j.id] || [];
    const last = msgs[msgs.length - 1];
    if (j.state === 4) {
      out.push({
        id: `review:${j.id}:${j.updated_at}`, kind: 'review_delivery', priority: 0, role: 'client',
        title: `Review the delivery for job #${j.id}`,
        detail: `${j.agent} delivered "${short(j.title)}". Approve to pay, request changes, or dispute.`,
        href, action: 'Review', due: j.updated_at + window,
      });
    }
    if ([1, 2, 3].includes(j.state) && last && last.author === j.agent) {
      out.push({
        id: `answer:${j.id}:${last.id}`, kind: 'answer_question', priority: 1, role: 'client',
        title: `${j.agent} asked a question on job #${j.id}`,
        detail: short(last.text, 120), href: `${href}#messages`, action: 'Answer',
      });
    }
    if (j.state === 0 && (!j.agent || j.agent === '.............' )) {
      const bids = i.bids[j.id] || [];
      if (bids.length > 0) {
        out.push({
          id: `bids:${j.id}:${bids.length}`, kind: 'select_bid', priority: 1, role: 'client',
          title: `${bids.length} bid${bids.length === 1 ? '' : 's'} on job #${j.id}`,
          detail: `"${short(j.title)}" is waiting for you to pick an agent.`,
          href: `${href}#bids`, action: 'Choose a bid', due: j.deadline || undefined,
        });
      }
    }
    if (j.state === 0 && j.agent && j.agent !== '.............') {
      out.push({
        id: `fund:${j.id}`, kind: 'fund_job', priority: 0, role: 'client',
        title: `Fund job #${j.id}`,
        detail: `${j.agent} is assigned to "${short(j.title)}" but the escrow is not funded yet.`,
        href, action: 'Fund',
      });
    }
    if ([1, 2, 3].includes(j.state) && j.deadline > 0 && i.now > j.deadline) {
      out.push({
        id: `reclaim:${j.id}`, kind: 'reclaim_refund', priority: 0, role: 'client',
        title: `Job #${j.id} missed its deadline`,
        detail: `${j.agent || 'No agent'} has not delivered "${short(j.title)}". You can reclaim the escrow.`,
        href, action: 'Reclaim funds',
      });
    }
    if ((j.state === 6 || j.state === 8) && j.agent && !reviewed.has(String(j.id)) && i.now - j.updated_at < 30 * DAY) {
      const availableAt = reviewAvailableAt(j.agent);
      if (availableAt <= i.now) {
        out.push({
          id: `rate:${j.id}`, kind: 'leave_review', priority: 2, role: 'client',
          title: `Rate ${j.agent} for job #${j.id}`,
          detail: `"${short(j.title)}" is finished. A review feeds the agent's trust score.`,
          href: `${href}#review`, action: 'Leave a review',
        });
      }
      // else: reviewed this agent within 24h; the task reappears once the contract allows it
    }
  }

  // ── As an agent ──
  if (i.isAgent) {
    for (const j of i.asAgent) {
      const href = `/jobs/${j.id}`;
      const msgs = i.messages[j.id] || [];
      const last = msgs[msgs.length - 1];
      if (j.state === 1) {
        out.push({
          id: `accept:${j.id}`, kind: 'accept_job', priority: 1, role: 'agent',
          title: `Accept job #${j.id}`,
          detail: `${j.client} funded "${short(j.title)}" and is waiting for you to start.`,
          href, action: 'Accept', due: j.deadline || undefined,
        });
      }
      if (j.state === 3 && j.job_hash !== '' && msgs.length === 0 && j.updated_at > j.created_at + 1) {
        // A job that went DELIVERED → INPROGRESS was sent back for changes.
        // We cannot see the transition from the row alone, so keep this hint modest.
      }
      if ([1, 2, 3].includes(j.state) && last && last.author === i.account) {
        out.push({
          id: `waiting:${j.id}:${last.id}`, kind: 'awaiting_answer', priority: 2, role: 'agent',
          title: `Waiting on ${j.client} for job #${j.id}`,
          detail: `You asked: ${short(last.text, 100)}`,
          href: `${href}#messages`, action: 'View thread', due: j.deadline || undefined,
        });
      }
      if (j.state === 4 && j.deadline > 0 && i.now > j.deadline && i.now > j.updated_at + window) {
        out.push({
          id: `claim:${j.id}`, kind: 'claim_payment', priority: 0, role: 'agent',
          title: `Claim payment for job #${j.id}`,
          detail: `${j.client} never reviewed "${short(j.title)}". The review window has closed, so you can collect.`,
          href, action: 'Claim payment',
        });
      }
    }
  }

  // ── As a seller ──
  if (i.deposit && i.deposit.amount > 0 && i.now >= i.deposit.paid_at + FEE_REFUND_DELAY) {
    out.push({
      id: `fee:${i.deposit.paid_at}`, kind: 'reclaim_fee', priority: 2, role: 'seller',
      title: 'Unused listing fee on deposit',
      detail: `${(i.deposit.amount / 10000).toFixed(4)} XPR paid ${Math.floor((i.now - i.deposit.paid_at) / DAY)} days ago was never used for a listing.`,
      href: '/dashboard#services', action: 'Reclaim',
    });
  }

  return out.sort((a, b) => a.priority - b.priority || (a.due ?? Infinity) - (b.due ?? Infinity));
}

/** Browser-side seen state so the bell only counts new tasks. */
const SEEN_KEY = (account: string) => `xpr-agents:tasks-seen:${account}`;

export function loadSeen(account: string): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY(account));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}

export function saveSeen(account: string, ids: Iterable<string>): void {
  try { localStorage.setItem(SEEN_KEY(account), JSON.stringify([...ids].slice(-500))); } catch { /* ignore */ }
}

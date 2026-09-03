import { useEffect, useMemo, useState } from 'react';
import { indexerFetch } from '@/lib/indexer';
import { getAgentFeedback } from '@/lib/registry';
import { AccountLink } from '@/components/AccountLink';

/**
 * Delivery and revision timeline for one job, built from the indexer's event
 * log (every agentescrow action the job went through, oldest first).
 *
 * Revision notes are the important part: a client's `revise` notes are only
 * otherwise visible inside the transaction, and an arbitrator later needs to
 * see the whole exchange, not just the final evidence link.
 */

interface RawEvent {
  id: number;
  block_num: number;
  transaction_id: string;
  action_name: string;
  contract: string;
  data: string;
  timestamp: number;
}

export interface JobEvent {
  id: number;
  action: string;
  actor: string;
  note: string;
  uri: string;
  timestamp: number;
  txId: string;
}

export interface HistoryCounts {
  deliveries: number;
  revisions: number;
  /** Number of reviews that reference this job. */
  reviews: number;
  /** Latest review score (1-5) referencing this job, if any. */
  rating?: number;
}

const ACTION_LABELS: Record<string, string> = {
  createjob: 'Job posted',
  submitbid: 'Bid submitted',
  withdrawbid: 'Bid withdrawn',
  selectbid: 'Bid selected',
  addmilestone: 'Milestone added',
  acceptjob: 'Accepted',
  startjob: 'Started',
  deliver: 'Delivered',
  revise: 'Changes requested',
  askclient: 'Question',
  answer: 'Answer',
  submitmile: 'Milestone submitted',
  approvemile: 'Milestone approved',
  approve: 'Approved and paid',
  dispute: 'Dispute raised',
  arbitrate: 'Arbitrated',
  resolvetime: 'Dispute timed out',
  timeout: 'Closed by timeout',
  cancel: 'Cancelled',
  removejob: 'Removed by admin',
  review: 'Reviewed',
};

const ACTION_TONE: Record<string, string> = {
  deliver: 'bg-accent',
  revise: 'bg-warn',
  approve: 'bg-good',
  approvemile: 'bg-good',
  dispute: 'bg-crit',
  arbitrate: 'bg-crit',
  cancel: 'bg-muted',
  timeout: 'bg-muted',
  review: 'bg-ink',
};

export function parseJobEvents(raw: RawEvent[]): JobEvent[] {
  return raw.map(e => {
    let d: Record<string, unknown> = {};
    try { d = JSON.parse(e.data || '{}'); } catch { /* keep empty */ }
    const actor = String(d.client ?? d.agent ?? d.raised_by ?? d.arbitrator ?? d.claimer ?? d.bidder ?? '');
    const note = String(d.notes ?? d.reason ?? d.resolution_notes ?? d.proposal ?? d.text ?? '');
    const uri = typeof d.evidence_uri === 'string' ? d.evidence_uri : '';
    return { id: e.id, action: e.action_name, actor, note, uri, timestamp: e.timestamp, txId: e.transaction_id };
  }).filter(e => ACTION_LABELS[e.action]);
}

export interface JobReview {
  id: number;
  reviewer: string;
  score: number;
  tags: string[];
  timestamp: number;
  disputed: boolean;
}

/** Reviews are linked to a job when the reviewer set job_hash to the job id (the site does this). */
export function reviewsForJob(feedback: Array<{ id: number; reviewer: string; score: number; tags: string[]; job_hash: string; timestamp: number; disputed: boolean }>, jobId: number): JobReview[] {
  return feedback
    .filter(f => String(f.job_hash).trim() === String(jobId))
    .map(f => ({ id: f.id, reviewer: f.reviewer, score: f.score, tags: f.tags || [], timestamp: f.timestamp, disputed: f.disputed }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function reviewEvents(reviews: JobReview[]): JobEvent[] {
  return reviews.map(r => ({
    id: -r.id - 1, // keep clear of indexer event ids
    action: 'review',
    actor: r.reviewer,
    note: `${'★'.repeat(r.score)}${'☆'.repeat(Math.max(0, 5 - r.score))} ${r.score}/5${r.tags.length ? ' · ' + r.tags.join(', ') : ''}${r.disputed ? ' · disputed' : ''}`,
    uri: '',
    timestamp: r.timestamp,
    txId: '',
  }));
}

export function countHistory(events: JobEvent[], reviews: JobReview[] = []): HistoryCounts {
  return {
    deliveries: events.filter(e => e.action === 'deliver').length,
    revisions: events.filter(e => e.action === 'revise').length,
    reviews: reviews.length,
    rating: reviews.length ? reviews[reviews.length - 1].score : undefined,
  };
}

function when(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function shortUri(uri: string): string {
  if (uri.startsWith('{')) return 'manifest';
  try { const u = new URL(uri); return u.hostname + u.pathname.slice(0, 22) + (u.pathname.length > 22 ? '…' : ''); } catch { return uri.slice(0, 40); }
}

interface Props {
  jobId: number;
  /** Assigned agent; reviews of this agent that reference the job are shown as the final entries. */
  agent?: string;
  /** Bump to refetch (for example after the job state changes). */
  refreshKey?: number;
  onCounts?: (counts: HistoryCounts) => void;
}

export default function DeliveryHistory({ jobId, agent, refreshKey = 0, onCounts }: Props) {
  const [events, setEvents] = useState<JobEvent[] | null>(null);
  const [reviews, setReviews] = useState<JobReview[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const eventsP = indexerFetch<{ events: RawEvent[] }>(`/events?contract=agentescrow&job_id=${jobId}&limit=200`)
      .then(res => parseJobEvents(res?.events || []))
      .catch(() => [] as JobEvent[]);
    const reviewsP = agent
      ? getAgentFeedback(agent, 100).then(fb => reviewsForJob(fb, jobId)).catch(() => [] as JobReview[])
      : Promise.resolve([] as JobReview[]);
    Promise.all([eventsP, reviewsP]).then(([parsed, revs]) => {
      if (cancelled) return;
      setEvents(parsed);
      setReviews(revs);
      onCounts?.(countHistory(parsed, revs));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, agent, refreshKey]);

  const counts = useMemo(() => countHistory(events || [], reviews), [events, reviews]);
  const timeline = useMemo(() => [...(events || []), ...reviewEvents(reviews)].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id), [events, reviews]);
  if (!events || timeline.length === 0) return null;

  const visible = expanded || timeline.length <= 8 ? timeline : timeline.slice(-8);

  return (
    <section className="rounded-xl border border-line bg-canvas p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="label">History</h3>
        <span className="font-mono text-xs tabular text-muted">
          {counts.deliveries} {counts.deliveries === 1 ? 'delivery' : 'deliveries'}
          {counts.revisions > 0 && <> · {counts.revisions} {counts.revisions === 1 ? 'revision' : 'revisions'}</>}
          {counts.rating !== undefined && <> · rated {counts.rating}/5</>}
        </span>
      </div>
      {!expanded && timeline.length > 8 && (
        <button type="button" onClick={() => setExpanded(true)} className="mb-3 text-xs text-accent hover:underline">
          Show all {timeline.length} events
        </button>
      )}
      <ol className="relative ml-2 border-l border-line">
        {visible.map(e => (
          <li key={e.id} className="relative pl-5 pb-4 last:pb-0">
            <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${ACTION_TONE[e.action] || 'bg-line-2'}`} aria-hidden="true" />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-sm font-medium text-ink">{ACTION_LABELS[e.action]}</span>
              {e.actor && <AccountLink account={e.actor} className="font-mono text-xs" />}
              <span className="font-mono text-[11px] tabular text-muted">{when(e.timestamp)}</span>
            </div>
            {e.note && (
              <p className={`mt-1 whitespace-pre-wrap break-words text-sm ${e.action === 'revise' ? 'rounded-md bg-warn-soft px-3 py-2 text-ink' : e.action === 'review' ? 'font-medium text-ink' : 'text-ink-2'}`}>{e.note}</p>
            )}
            {e.uri && (
              <a href={e.uri.startsWith('{') ? undefined : e.uri} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block max-w-full break-all font-mono text-xs text-accent hover:underline">
                {shortUri(e.uri)}
              </a>
            )}
          </li>
        ))}
      </ol>
      {counts.revisions >= 3 && (
        <p className="mt-3 text-xs text-muted">
          Three or more revisions. If the next delivery still misses the brief, approving or disputing is usually better than another round.
        </p>
      )}
    </section>
  );
}

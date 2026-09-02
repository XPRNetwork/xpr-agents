import { useState, useEffect } from 'react';
import { getNetworkConfig } from '@/lib/networks';
import { indexerFetch } from '@/lib/indexer';

/**
 * Live chain activity for the "pulse" indicator and event toasts.
 *
 * One shared poller per tab (not one per mounted component): it asks the
 * indexer for the newest event in a single request, falls back to reading the
 * head row of each contract table over RPC only when the indexer is down, and
 * pauses entirely while the tab is hidden.
 */

const RPC_URL = getNetworkConfig().rpc;
const POLL_INTERVAL = 8000;

export interface ChainEvent {
  label: string;
  detail: string;
  key: number;
}

export interface ChainStreamResult {
  pulseCount: number;
  lastEvent: ChainEvent | null;
}

const JOB_STATE_LABELS: Record<number, string> = {
  0: 'Job Created',
  1: 'Job Funded',
  2: 'Job Accepted',
  3: 'Job In Progress',
  4: 'Job Delivered',
  5: 'Job Disputed',
  6: 'Job Completed',
  7: 'Job Refunded',
  8: 'Job Arbitrated',
};

// ── Indexer event → human label ──────────────────────────────────────────

type Describer = (d: any) => { label: string; detail: string };
const short = (s: unknown, n = 40) => (typeof s === 'string' ? s.slice(0, n) : '');

const ACTION_DESCRIBERS: Record<string, Describer> = {
  'agentcore:register': (d) => ({ label: 'Agent Registered', detail: d.name || d.account || '' }),
  'agentcore:update': (d) => ({ label: 'Agent Updated', detail: d.account || '' }),
  'agentcore:claim': (d) => ({ label: 'Agent Claimed', detail: d.agent ? `${d.owner || ''} claimed ${d.agent}`.trim() : '' }),
  'agentfeed:submit': (d) => ({ label: 'Feedback Submitted', detail: d.reviewer ? `${d.reviewer} rated ${d.agent}` : '' }),
  'agentfeed:submitctx': (d) => ({ label: 'Feedback Submitted', detail: d.reviewer ? `${d.reviewer} rated ${d.agent}` : '' }),
  'agentfeed:submitwpay': (d) => ({ label: 'Feedback Submitted', detail: d.reviewer ? `${d.reviewer} rated ${d.agent}` : '' }),
  'agentescrow:createjob': (d) => ({ label: 'Job Created', detail: d.title ? `"${short(d.title)}"` : '' }),
  'agentescrow:submitbid': (d) => ({ label: 'Bid Submitted', detail: d.agent ? `${d.agent} bid on job #${d.job_id}` : '' }),
  'agentescrow:selectbid': (d) => ({ label: 'Bid Selected', detail: d.job_id !== undefined ? `job #${d.job_id}` : '' }),
  'agentescrow:acceptjob': (d) => ({ label: 'Job Accepted', detail: d.agent ? `${d.agent} on job #${d.job_id}` : '' }),
  'agentescrow:startjob': (d) => ({ label: 'Job In Progress', detail: d.job_id !== undefined ? `job #${d.job_id}` : '' }),
  'agentescrow:deliver': (d) => ({ label: 'Job Delivered', detail: d.agent ? `${d.agent} on job #${d.job_id}` : '' }),
  'agentescrow:approve': (d) => ({ label: 'Job Completed', detail: d.job_id !== undefined ? `job #${d.job_id}` : '' }),
  'agentescrow:dispute': (d) => ({ label: 'Dispute Raised', detail: d.raised_by ? `${d.raised_by} on job #${d.job_id}` : '' }),
  'agentescrow:arbitrate': (d) => ({ label: 'Job Arbitrated', detail: d.dispute_id !== undefined ? `dispute #${d.dispute_id}` : '' }),
  'agentescrow:cancel': (d) => ({ label: 'Job Refunded', detail: d.job_id !== undefined ? `job #${d.job_id}` : '' }),
  'agentescrow:submitmile': (d) => ({ label: 'Milestone Update', detail: d.job_id !== undefined ? `job #${d.job_id}` : '' }),
  'agentescrow:approvemile': (d) => ({ label: 'Milestone Update', detail: d.job_id !== undefined ? `job #${d.job_id}` : '' }),
  'agentvalid:validate': (d) => ({ label: 'Validation Recorded', detail: d.validator ? `${d.validator} validated ${d.agent}` : '' }),
  'agentvalid:challenge': (d) => ({ label: 'Challenge Filed', detail: d.challenger ? `${d.challenger} challenged validation #${d.validation_id}` : '' }),
};

function humanize(action: string): string {
  return action.replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

export function describeIndexerEvent(ev: { contract?: string; action_name?: string; data?: unknown }): { label: string; detail: string } {
  let data: any = ev.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = {}; }
  }
  const key = `${ev.contract || ''}:${ev.action_name || ''}`;
  const describer = ACTION_DESCRIBERS[key];
  if (describer) return describer(data || {});
  return { label: humanize(ev.action_name || 'Chain Activity'), detail: ev.contract || '' };
}

// ── RPC fallback: head row of each table ────────────────────────────────

interface TableDef {
  code: string;
  table: string;
  label: string;
  detail: (row: any) => string;
}

const TABLES: TableDef[] = [
  { code: 'agentcore', table: 'agents', label: 'Agent Registered', detail: (r) => r.name || r.account || '' },
  { code: 'agentfeed', table: 'feedback', label: 'Feedback Submitted', detail: (r) => r.reviewer ? `${r.reviewer} rated ${r.agent}` : '' },
  {
    code: 'agentescrow', table: 'jobs', label: '',
    detail: (r) => {
      const stateLabel = JOB_STATE_LABELS[parseInt(r.state)] || 'Job Activity';
      return r.title ? `${stateLabel}: "${short(r.title)}"` : stateLabel;
    },
  },
  { code: 'agentescrow', table: 'bids', label: 'Bid Submitted', detail: (r) => r.agent ? `${r.agent} bid on job #${r.job_id}` : '' },
  { code: 'agentescrow', table: 'disputes', label: 'Dispute Raised', detail: (r) => r.raised_by ? `${r.raised_by} on job #${r.job_id}` : '' },
  { code: 'agentvalid', table: 'validations', label: 'Validation Recorded', detail: (r) => r.validator ? `${r.validator} validated ${r.agent}` : '' },
];

// ── Shared poller (module singleton) ────────────────────────────────────

type Listener = (ev: ChainEvent) => void;

const listeners = new Set<Listener>();
let timer: ReturnType<typeof setInterval> | null = null;
let kickoff: ReturnType<typeof setTimeout> | null = null;
let polling = false;
let keyCounter = 0;

let lastIndexerEventId: number | null = null;
const lastSeenRpc: Record<string, string> = {};
let rpcInitialized = false;

function emit(label: string, detail: string) {
  keyCounter += 1;
  const ev: ChainEvent = { label, detail, key: keyCounter };
  listeners.forEach((l) => l(ev));
}

/** Returns false when the indexer is unavailable so the caller can fall back. */
async function pollIndexer(): Promise<boolean> {
  const data = await indexerFetch<{ events?: Array<{ id: number; contract?: string; action_name?: string; data?: unknown }> }>('/events?limit=1');
  if (!data || !Array.isArray(data.events)) return false;
  const latest = data.events[0];
  if (!latest || typeof latest.id !== 'number') return true;
  if (lastIndexerEventId === null) {
    lastIndexerEventId = latest.id;
    return true;
  }
  if (latest.id > lastIndexerEventId) {
    lastIndexerEventId = latest.id;
    const { label, detail } = describeIndexerEvent(latest);
    emit(label, detail);
  }
  return true;
}

async function pollRpc(): Promise<void> {
  for (const def of TABLES) {
    if (listeners.size === 0) return;
    try {
      const res = await fetch(`${RPC_URL}/v1/chain/get_table_rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: def.code, table: def.table, scope: def.code, limit: 1, reverse: true, json: true }),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const row = data?.rows?.[0];
      if (!row) continue;

      const fp = `${row.id ?? JSON.stringify(row)}`;
      const key = `${def.code}:${def.table}`;
      const prev = lastSeenRpc[key];
      lastSeenRpc[key] = fp;

      if (rpcInitialized && prev && fp !== prev) {
        const label = def.label || (JOB_STATE_LABELS[parseInt(row?.state)] || 'Job Activity');
        emit(label, def.detail(row));
      }
    } catch {
      // silent — next tick retries
    }
  }
  rpcInitialized = true;
}

async function tick(): Promise<void> {
  if (typeof document !== 'undefined' && document.hidden) return;
  if (polling || listeners.size === 0) return;
  polling = true;
  try {
    const viaIndexer = await pollIndexer();
    if (!viaIndexer) await pollRpc();
  } finally {
    polling = false;
  }
}

function onVisibilityChange() {
  if (typeof document !== 'undefined' && !document.hidden) void tick();
}

function startPolling() {
  if (timer) return;
  kickoff = setTimeout(() => { void tick(); }, 800);
  timer = setInterval(() => { void tick(); }, POLL_INTERVAL);
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function stopPolling() {
  if (kickoff) { clearTimeout(kickoff); kickoff = null; }
  if (timer) { clearInterval(timer); timer = null; }
  document.removeEventListener('visibilitychange', onVisibilityChange);
}

export function useChainStream(): ChainStreamResult {
  const [pulseCount, setPulseCount] = useState(0);
  const [lastEvent, setLastEvent] = useState<ChainEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const listener: Listener = (ev) => {
      setLastEvent(ev);
      setPulseCount((c) => c + 1);
    };
    listeners.add(listener);
    startPolling();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) stopPolling();
    };
  }, []);

  return { pulseCount, lastEvent };
}

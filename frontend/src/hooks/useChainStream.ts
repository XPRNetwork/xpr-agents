import { useState, useEffect, useRef } from 'react';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://tn1.protonnz.com';
const POLL_INTERVAL = 5000;

export interface ChainEvent {
  label: string;
  detail: string;
  key: number;
}

interface TableDef {
  code: string;
  table: string;
  label: string;
  detail: (row: any) => string;
}

const TABLES: TableDef[] = [
  {
    code: 'agentcore',
    table: 'agents',
    label: 'Agent Registered',
    detail: (r) => r.name || r.account || '',
  },
  {
    code: 'agentfeed',
    table: 'feedback',
    label: 'Feedback Submitted',
    detail: (r) => r.reviewer ? `${r.reviewer} rated ${r.agent}` : '',
  },
  {
    code: 'agentescrow',
    table: 'jobs',
    label: 'Job Activity',
    detail: (r) => r.title ? `"${r.title.slice(0, 40)}"` : '',
  },
  {
    code: 'agentescrow',
    table: 'bids',
    label: 'Bid Submitted',
    detail: (r) => r.agent ? `${r.agent} bid on job #${r.job_id}` : '',
  },
  {
    code: 'agentescrow',
    table: 'disputes',
    label: 'Dispute Raised',
    detail: (r) => r.raised_by ? `${r.raised_by} on job #${r.job_id}` : '',
  },
  {
    code: 'agentescrow',
    table: 'milestones',
    label: 'Milestone Update',
    detail: (r) => r.title ? `"${r.title}" on job #${r.job_id}` : '',
  },
  {
    code: 'agentescrow',
    table: 'arbitrators',
    label: 'Arbitrator Update',
    detail: (r) => r.account || '',
  },
  {
    code: 'agentvalid',
    table: 'validations',
    label: 'Validation Recorded',
    detail: (r) => r.validator ? `${r.validator} validated ${r.agent}` : '',
  },
  {
    code: 'agentvalid',
    table: 'challenges',
    label: 'Challenge Filed',
    detail: (r) => r.challenger ? `${r.challenger} challenged validation #${r.validation_id}` : '',
  },
];

export interface ChainStreamResult {
  pulseCount: number;
  lastEvent: ChainEvent | null;
}

export function useChainStream(): ChainStreamResult {
  const [pulseCount, setPulseCount] = useState(0);
  const [lastEvent, setLastEvent] = useState<ChainEvent | null>(null);
  const lastSeenRef = useRef<Record<string, string>>({});
  const initializedRef = useRef(false);
  const keyRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let active = true;

    async function poll() {
      for (const def of TABLES) {
        if (!active) return;
        try {
          const res = await fetch(`${RPC_URL}/v1/chain/get_table_rows`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: def.code,
              table: def.table,
              scope: def.code,
              limit: 1,
              reverse: true,
              json: true,
            }),
            signal: AbortSignal.timeout(3000),
          });
          if (!res.ok || !active) continue;
          const data = await res.json();
          const rows = data?.rows;
          if (!rows || rows.length === 0) continue;

          const fp = `${rows[0].id ?? JSON.stringify(rows[0])}`;
          const key = `${def.code}:${def.table}`;
          const prev = lastSeenRef.current[key];
          lastSeenRef.current[key] = fp;

          if (initializedRef.current && prev && fp !== prev) {
            const detail = def.detail(rows[0]);
            keyRef.current += 1;
            setLastEvent({ label: def.label, detail, key: keyRef.current });
            setPulseCount((c) => c + 1);
          }
        } catch {
          // silent
        }
      }
      initializedRef.current = true;
    }

    const initialTimeout = setTimeout(poll, 800);
    const interval = setInterval(poll, POLL_INTERVAL);

    return () => {
      active = false;
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []);

  return { pulseCount, lastEvent };
}

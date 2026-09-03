import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getJobsForAccount,
  getJob,
  getJobMessages,
  getBidsForJob,
  getFeedbackByReviewer,
  getServiceDeposit,
  getEscrowConfig,
  getAgent,
  isEmptyName,
  type Job,
  type JobMessage,
  type Bid,
} from '@/lib/registry';
import { computeTasks, loadSeen, saveSeen, type Task } from '@/lib/tasks';

const REFRESH_MS = 60_000;
const MAX_THREAD_LOOKUPS = 20;

export interface TasksState {
  tasks: Task[];
  unseen: number;
  loading: boolean;
  refresh: () => void;
  /** Mark everything currently listed as seen (the bell count drops to 0). */
  markAllSeen: () => void;
}

/**
 * Everything the connected account still has to do on the board. Fetches
 * jobs as client and as agent, message threads for live jobs, bids on open
 * jobs the account posted, the account's own reviews and its listing-fee
 * deposit, then hands it all to the pure computeTasks().
 */
export function useTasks(account: string | undefined): TasksState {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const inflight = useRef(false);

  useEffect(() => { if (account) setSeen(loadSeen(account)); }, [account]);

  useEffect(() => {
    if (!account) { setTasks([]); return; }
    let cancelled = false;
    async function load() {
      if (inflight.current) return;
      inflight.current = true;
      setLoading(true);
      try {
        let [{ asClient, asAgent }, myReviews, deposit, config, agentRow] = await Promise.all([
          getJobsForAccount(account!),
          getFeedbackByReviewer(account!).catch(() => []),
          getServiceDeposit(account!).catch(() => null),
          getEscrowConfig().catch(() => null),
          getAgent(account!).catch(() => null),
        ]);
        // Deadline-sensitive rows are re-read from chain: the indexer can lag
        // (e.g. a revise extends the deadline on chain) and a wrong "missed
        // deadline" task would send the user to a page with no such action.
        const nowSec0 = Math.floor(Date.now() / 1000);
        const verify = async (list: Job[]): Promise<Job[]> => Promise.all(list.map(async j => {
          const sensitive = ([1, 2, 3].includes(j.state) && j.deadline > 0 && nowSec0 > j.deadline) || j.state === 4;
          if (!sensitive) return j;
          const fresh = await getJob(j.id).catch(() => null);
          return fresh || j;
        }));
        [asClient, asAgent] = await Promise.all([verify(asClient), verify(asAgent)]);
        const live = [...asClient, ...asAgent].filter(j => [1, 2, 3].includes(j.state)).slice(0, MAX_THREAD_LOOKUPS);
        const messages: Record<number, JobMessage[]> = {};
        await Promise.all(live.map(async j => { messages[j.id] = await getJobMessages(j.id).catch(() => []); }));
        const open = asClient.filter(j => j.state === 0 && isEmptyName(j.agent)).slice(0, MAX_THREAD_LOOKUPS);
        const bids: Record<number, Bid[]> = {};
        await Promise.all(open.map(async j => { bids[j.id] = await getBidsForJob(j.id).catch(() => []); }));
        if (cancelled) return;
        setTasks(computeTasks({
          account: account!, asClient, asAgent, messages, bids, myReviews, deposit, config,
          isAgent: !!agentRow, now: Math.floor(Date.now() / 1000),
        }));
      } catch {
        if (!cancelled) setTasks([]);
      } finally {
        inflight.current = false;
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [account, tick]);

  const refresh = useCallback(() => setTick(x => x + 1), []);
  const markAllSeen = useCallback(() => {
    if (!account) return;
    const next = new Set(seen);
    for (const t of tasks) next.add(t.id);
    setSeen(next);
    saveSeen(account, next);
  }, [account, seen, tasks]);

  const unseen = tasks.filter(t => !seen.has(t.id)).length;
  return { tasks, unseen, loading, refresh, markAllSeen };
}

export type { Task, Job };

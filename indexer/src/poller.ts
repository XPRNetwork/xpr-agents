import { EventEmitter } from 'events';
import { StreamAction } from './stream';

export interface PollerConfig {
  endpoint: string;
  /** Additional endpoints for failover (tried in order when primary fails) */
  endpoints?: string[];
  contracts: string[];
  pollIntervalMs?: number;
  startBlock?: number;
  /** Per-contract start blocks (takes priority over startBlock for matching contracts) */
  contractStartBlocks?: Map<string, number>;
}

/**
 * Polls Hyperion v2 history API for actions when WebSocket streaming
 * is unavailable (e.g. testnet endpoints with streaming disabled).
 *
 * Uses per-contract block cursors to avoid skipping actions when
 * contracts have actions at different block heights.
 */
export class HyperionPoller extends EventEmitter {
  private config: PollerConfig;
  private pollTimer: NodeJS.Timeout | null = null;
  private contractBlocks: Map<string, number>;
  // Highest global_sequence already emitted per contract. Hyperion's `after=<block>`
  // is INCLUSIVE (verified against mainnet), so each poll refetches the boundary
  // block; this monotonic cursor makes reprocessing a no-op and, with skip-paging,
  // lets us drain a block that holds more than one page of actions (audit round 2
  // codex #16 — otherwise a >100-action block stalls the poller forever).
  private contractSeq: Map<string, number>;
  // Per-contract skip offset that persists across polls while we are still draining
  // one boundary block that holds more than MAX_PAGES_PER_POLL*100 actions. Without
  // it the drain restarts at skip 0 every poll and can never reach past the page cap
  // (audit round 2 codex follow-up: a >5000-action block stalled the poller forever).
  private contractSkip: Map<string, number>;
  private running = false;
  private readonly pollInterval: number;
  private allEndpoints: string[];
  private currentEndpointIndex = 0;

  constructor(config: PollerConfig) {
    super();
    this.config = config;
    this.pollInterval = config.pollIntervalMs || 5000;
    // Build endpoint list: primary first, then any additional endpoints
    this.allEndpoints = [config.endpoint];
    if (config.endpoints) {
      for (const ep of config.endpoints) {
        if (!this.allEndpoints.includes(ep)) this.allEndpoints.push(ep);
      }
    }
    // Initialize per-contract block cursors, preferring saved per-contract values
    this.contractBlocks = new Map();
    this.contractSeq = new Map();
    this.contractSkip = new Map();
    const defaultStart = config.startBlock || 0;
    for (const contract of config.contracts) {
      const saved = config.contractStartBlocks?.get(contract);
      this.contractBlocks.set(contract, saved ?? defaultStart);
      this.contractSeq.set(contract, 0);
      this.contractSkip.set(contract, 0);
    }
  }

  private get currentEndpoint(): string {
    return this.allEndpoints[this.currentEndpointIndex];
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`Starting Hyperion poller: ${this.currentEndpoint} (every ${this.pollInterval}ms, ${this.allEndpoints.length} endpoints)`);
    this.emit('connected');
    this.poll();
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      for (const contract of this.config.contracts) {
        await this.pollContract(contract);
      }
    } catch (error) {
      console.error('Poll error:', error);
      this.emit('error', error);
    }

    if (this.running) {
      this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
    }
  }

  // Max pages drained per poll cycle (100 actions each). Bounds work per tick;
  // a larger backlog is picked up on the next poll from the advanced cursor.
  private static readonly MAX_PAGES_PER_POLL = 50;

  private async pollContract(contract: string): Promise<void> {
    const lastBlock = this.contractBlocks.get(contract) || 0;
    const seenSeq = this.contractSeq.get(contract) || 0;
    const startSkip = this.contractSkip.get(contract) || 0;
    let maxBlock = lastBlock;
    let maxSeq = seenSeq;
    let pagesDrained = 0;
    let reachedTip = false;

    // Drain with skip-paging. `after=<block>` is inclusive, so page 0 refetches the
    // boundary block; global_sequence dedup makes that a no-op, and paging with skip
    // reaches actions beyond the first 100 in a busy block (codex #16). We stop at a
    // short (< limit) page, or when a page yields nothing new AND is full only up to
    // the page cap (so we never spin forever).
    for (let page = 0; page < HyperionPoller.MAX_PAGES_PER_POLL; page++) {
      const params = new URLSearchParams({
        account: contract,
        limit: '100',
        sort: 'asc',
        skip: String(startSkip + page * 100),
      });
      if (lastBlock > 0) {
        params.set('after', String(lastBlock));
      }

      const actions = await this.fetchActions(params);
      if (actions.length === 0) { reachedTip = true; break; }

      for (const action of actions) {
        const seq: number = action.global_sequence || 0;
        // Skip anything already emitted. Compare against the RUNNING max, not the
        // poll-start snapshot, so an action that reappears within the same drain
        // (endpoint failover mid-drain, or new tip rows shifting the skip window
        // between page fetches) is never emitted twice. Also covers the inclusive-
        // boundary refetch and WebSocket-stream overlap. seq 0 is always emitted.
        if (seq !== 0 && seq <= maxSeq) continue;

        const streamAction: StreamAction = {
          block_num: action.block_num,
          global_sequence: seq,
          action_ordinal: action.action_ordinal || 0,
          timestamp: action['@timestamp'] || action.timestamp,
          trx_id: action.trx_id,
          act: action.act,
          inline_traces: action.inline_traces,
        };
        this.emit('action', streamAction);

        if (seq > maxSeq) maxSeq = seq;
        if (action.block_num > maxBlock) maxBlock = action.block_num;
      }

      // Persist progress after every page so a crash mid-drain doesn't rewind.
      pagesDrained = page + 1;
      this.contractSeq.set(contract, maxSeq);
      this.contractBlocks.set(contract, maxBlock);

      // A short page means we've reached the tip; a full page means there may be
      // more (later blocks, or >100 in the boundary block) — page on.
      if (actions.length < 100) { reachedTip = true; break; }
    }

    // Skip-cursor bookkeeping. If we reached the tip, or advanced into a later block,
    // the next poll restarts at skip 0 from the (advanced) boundary block. But if we
    // exhausted the page cap while still inside the same boundary block — a block with
    // more than MAX_PAGES_PER_POLL*100 actions — persist the skip so the next poll
    // resumes deeper instead of refetching the same pages forever (which would stall
    // the poller and silently drop every action past the cap).
    if (reachedTip || maxBlock > lastBlock) {
      this.contractSkip.set(contract, 0);
    } else {
      this.contractSkip.set(contract, startSkip + pagesDrained * 100);
    }
  }

  /** Fetch one page of actions, failing over across endpoints on error. */
  private async fetchActions(params: URLSearchParams): Promise<any[]> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.allEndpoints.length; attempt++) {
      const endpointIndex = (this.currentEndpointIndex + attempt) % this.allEndpoints.length;
      const endpoint = this.allEndpoints[endpointIndex];
      const url = `${endpoint}/v2/history/get_actions?${params}`;
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json() as any;
        if (endpointIndex !== this.currentEndpointIndex) {
          console.log(`Hyperion failover: switched to ${endpoint}`);
          this.currentEndpointIndex = endpointIndex;
        }
        return data.actions || [];
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.allEndpoints.length - 1) {
          console.warn(`Hyperion endpoint ${endpoint} failed (${lastError.message}), trying next...`);
        }
      }
    }
    throw lastError || new Error('All Hyperion endpoints failed');
  }

  isConnected(): boolean {
    return this.running;
  }

  disconnect(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.emit('disconnected');
  }
}

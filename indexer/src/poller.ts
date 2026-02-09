import { EventEmitter } from 'events';
import { StreamAction } from './stream';

export interface PollerConfig {
  endpoint: string;
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
  private running = false;
  private readonly pollInterval: number;

  constructor(config: PollerConfig) {
    super();
    this.config = config;
    this.pollInterval = config.pollIntervalMs || 5000;
    // Initialize per-contract block cursors, preferring saved per-contract values
    this.contractBlocks = new Map();
    const defaultStart = config.startBlock || 0;
    for (const contract of config.contracts) {
      const saved = config.contractStartBlocks?.get(contract);
      this.contractBlocks.set(contract, saved ?? defaultStart);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`Starting Hyperion poller: ${this.config.endpoint} (every ${this.pollInterval}ms)`);
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

  private async pollContract(contract: string): Promise<void> {
    const lastBlock = this.contractBlocks.get(contract) || 0;
    const params = new URLSearchParams({
      account: contract,
      limit: '100',
      sort: 'asc',
    });

    if (lastBlock > 0) {
      params.set('after', String(lastBlock));
    }

    const url = `${this.config.endpoint}/v2/history/get_actions?${params}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as any;
    const actions = data.actions || [];

    for (const action of actions) {
      const streamAction: StreamAction = {
        block_num: action.block_num,
        global_sequence: action.global_sequence || 0,
        action_ordinal: action.action_ordinal || 0,
        timestamp: action['@timestamp'] || action.timestamp,
        trx_id: action.trx_id,
        act: action.act,
        inline_traces: action.inline_traces,
      };

      this.emit('action', streamAction);

      if (action.block_num > lastBlock) {
        this.contractBlocks.set(contract, action.block_num);
      }
    }
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

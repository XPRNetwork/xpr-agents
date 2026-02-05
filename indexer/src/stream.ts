import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface StreamAction {
  block_num: number;
  timestamp: string;
  trx_id: string;
  act: {
    account: string;
    name: string;
    authorization: Array<{ actor: string; permission: string }>;
    data: Record<string, any>;
  };
  // P2 FIX: Optional inline traces for detecting side effects like token transfers
  inline_traces?: Array<{
    act: {
      account: string;
      name: string;
      data: Record<string, any>;
    };
  }>;
}

export interface StreamConfig {
  endpoint: string;
  contracts: string[];
  startBlock?: number;
  irreversibleOnly?: boolean;
}

export class HyperionStream extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: StreamConfig;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reqId = 0;

  constructor(config: StreamConfig) {
    super();
    this.config = config;
  }

  connect(): void {
    const wsUrl = this.config.endpoint.replace(/^http/, 'ws') + '/stream';
    console.log(`Connecting to Hyperion stream: ${wsUrl}`);

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('Hyperion WebSocket connected');
      this.emit('connected');
      this.subscribe();
      this.startPing();
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    });

    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', error);
    });

    this.ws.on('close', () => {
      console.log('WebSocket closed, reconnecting...');
      this.stopPing();
      this.scheduleReconnect();
    });
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    for (const contract of this.config.contracts) {
      const req = {
        type: 'get_actions',
        req_id: `${contract}-${++this.reqId}`,
        listen: true,
        data: {
          code: contract,
          irreversible_only: this.config.irreversibleOnly ?? true,
          ...(this.config.startBlock && { start_from: this.config.startBlock }),
        },
      };

      console.log(`Subscribing to ${contract} actions`);
      this.ws.send(JSON.stringify(req));
    }
  }

  private handleMessage(message: any): void {
    if (message.type === 'action') {
      const action: StreamAction = {
        block_num: message.content.block_num,
        timestamp: message.content['@timestamp'],
        trx_id: message.content.trx_id,
        act: message.content.act,
        // P2 FIX: Capture inline traces if available (for detecting side effects)
        inline_traces: message.content.inline_traces || message.content.traces,
      };

      this.emit('action', action);
    } else if (message.type === 'lib_update') {
      this.emit('lib_update', message.content.block_num);
    } else if (message.type === 'pong') {
      // Keep-alive response
    } else if (message.type === 'message') {
      console.log('Hyperion message:', message.content);
    }
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  disconnect(): void {
    this.stopPing();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

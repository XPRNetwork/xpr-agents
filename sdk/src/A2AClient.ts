/**
 * A2A (Agent-to-Agent) JSON-RPC 2.0 client.
 *
 * Compatible with Google's A2A spec, with XPR Network extensions
 * for on-chain identity, trust scores, and escrow job linking.
 */

import type {
  A2ATask,
  A2AMessage,
  A2AJsonRpcResponse,
  XprAgentCard,
} from './types';

export class A2AError extends Error {
  constructor(
    message: string,
    public code: number,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'A2AError';
  }

  static fromRpcError(error: { code: number; message: string; data?: unknown }): A2AError {
    return new A2AError(error.message, error.code, error.data);
  }
}

export interface A2AClientOptions {
  /** XPR account name of the caller, injected as xpr:callerAccount in requests */
  callerAccount?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

export interface SendMessageOptions {
  /** Existing task ID to continue a conversation */
  taskId?: string;
  /** Context ID for grouping related tasks */
  contextId?: string;
  /** XPR escrow job ID to link this interaction to */
  jobId?: number;
  /** Additional metadata to include */
  metadata?: Record<string, unknown>;
}

let rpcIdCounter = 0;

export class A2AClient {
  private endpoint: string;
  private callerAccount?: string;
  private timeout: number;

  constructor(endpoint: string, options: A2AClientOptions = {}) {
    this.endpoint = endpoint.replace(/\/$/, '');
    this.callerAccount = options.callerAccount;
    this.timeout = options.timeout ?? 30000;
  }

  /** Fetch the agent's A2A Agent Card from /.well-known/agent.json */
  async getAgentCard(): Promise<XprAgentCard> {
    const url = `${this.endpoint}/.well-known/agent.json`;
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) {
      throw new A2AError(
        `Failed to fetch agent card: ${response.status} ${response.statusText}`,
        -32000,
      );
    }
    return response.json() as Promise<XprAgentCard>;
  }

  /** Send a message to the agent, creating or continuing a task */
  async sendMessage(message: A2AMessage, options: SendMessageOptions = {}): Promise<A2ATask> {
    const params: Record<string, unknown> = { message };
    if (options.taskId) params.id = options.taskId;
    if (options.contextId) params.contextId = options.contextId;
    if (options.metadata || options.jobId) {
      params.metadata = {
        ...options.metadata,
        ...(options.jobId != null ? { 'xpr:jobId': options.jobId } : {}),
      };
    }
    return this.rpc<A2ATask>('message/send', params);
  }

  /** Get the current state of a task */
  async getTask(taskId: string): Promise<A2ATask> {
    return this.rpc<A2ATask>('tasks/get', { id: taskId });
  }

  /** Cancel a running task */
  async cancelTask(taskId: string): Promise<A2ATask> {
    return this.rpc<A2ATask>('tasks/cancel', { id: taskId });
  }

  /** Send a JSON-RPC 2.0 request */
  private async rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = ++rpcIdCounter;
    const body: Record<string, unknown> = {
      jsonrpc: '2.0',
      id,
      method,
      params: {
        ...params,
        ...(this.callerAccount ? { 'xpr:callerAccount': this.callerAccount } : {}),
      },
    };

    const response = await this.fetchWithTimeout(`${this.endpoint}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new A2AError(
        `HTTP error: ${response.status} ${response.statusText}`,
        -32000,
      );
    }

    const json = (await response.json()) as A2AJsonRpcResponse<T>;

    if (json.error) {
      throw A2AError.fromRpcError(json.error);
    }

    return json.result as T;
  }

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new A2AError('Request timed out', -32000);
      }
      throw new A2AError(`Network error: ${err.message}`, -32000);
    } finally {
      clearTimeout(timer);
    }
  }
}

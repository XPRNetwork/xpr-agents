import { A2AClient, A2AError } from '../src/A2AClient';
import type { A2AMessage, XprAgentCard, A2ATask } from '../src/types';

// Mock fetch globally
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  } as Response;
}

function rpcResponse<T>(result: T): Response {
  return jsonResponse({ jsonrpc: '2.0', id: 1, result });
}

function rpcError(code: number, message: string): Response {
  return jsonResponse({ jsonrpc: '2.0', id: 1, error: { code, message } });
}

const agentCard: XprAgentCard = {
  name: 'Test Agent',
  description: 'A test agent',
  url: 'https://agent.example.com',
  version: '1.0.0',
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  skills: [{ id: 'test', name: 'Test', description: 'Testing', tags: ['test'] }],
  'xpr:account': 'testagent',
  'xpr:protocol': 'https',
  'xpr:trustScore': 75,
  'xpr:kycLevel': 2,
  'xpr:registeredAt': 1704067200,
  'xpr:owner': 'testowner',
};

const task: A2ATask = {
  id: 'task-123',
  status: { state: 'completed', timestamp: '2024-01-01T00:00:00Z' },
  artifacts: [{ parts: [{ type: 'text', text: 'Hello back!' }], index: 0 }],
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe('A2AClient', () => {
  describe('getAgentCard()', () => {
    it('fetches agent card from /.well-known/agent.json', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(agentCard));

      const client = new A2AClient('https://agent.example.com');
      const result = await client.getAgentCard();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://agent.example.com/.well-known/agent.json',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(result).toEqual(agentCard);
      expect(result['xpr:account']).toBe('testagent');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 404));

      const client = new A2AClient('https://agent.example.com');
      await expect(client.getAgentCard()).rejects.toThrow('Failed to fetch agent card');
    });

    it('strips trailing slash from endpoint', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(agentCard));

      const client = new A2AClient('https://agent.example.com/');
      await client.getAgentCard();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://agent.example.com/.well-known/agent.json',
        expect.anything(),
      );
    });
  });

  describe('sendMessage()', () => {
    const message: A2AMessage = {
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
    };

    it('sends JSON-RPC message/send request', async () => {
      mockFetch.mockResolvedValueOnce(rpcResponse(task));

      const client = new A2AClient('https://agent.example.com');
      const result = await client.sendMessage(message);

      expect(result).toEqual(task);
      const call = mockFetch.mock.calls[0];
      expect(call[0]).toBe('https://agent.example.com/a2a');
      const body = JSON.parse(call[1].body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.method).toBe('message/send');
      expect(body.params.message).toEqual(message);
    });

    it('includes callerAccount when set', async () => {
      mockFetch.mockResolvedValueOnce(rpcResponse(task));

      const client = new A2AClient('https://agent.example.com', { callerAccount: 'alice' });
      await client.sendMessage(message);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params['xpr:callerAccount']).toBe('alice');
    });

    it('includes taskId and contextId in params', async () => {
      mockFetch.mockResolvedValueOnce(rpcResponse(task));

      const client = new A2AClient('https://agent.example.com');
      await client.sendMessage(message, { taskId: 'task-1', contextId: 'ctx-1' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.id).toBe('task-1');
      expect(body.params.contextId).toBe('ctx-1');
    });

    it('includes jobId in metadata', async () => {
      mockFetch.mockResolvedValueOnce(rpcResponse(task));

      const client = new A2AClient('https://agent.example.com');
      await client.sendMessage(message, { jobId: 42 });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.metadata['xpr:jobId']).toBe(42);
    });

    it('throws A2AError on RPC error response', async () => {
      mockFetch.mockResolvedValueOnce(rpcError(-32600, 'Invalid request'));

      const client = new A2AClient('https://agent.example.com');
      await expect(client.sendMessage(message)).rejects.toThrow(A2AError);
      await expect(client.sendMessage(message).catch(e => e.code)).resolves.toBe(undefined);

      // Re-test to check error details
      mockFetch.mockResolvedValueOnce(rpcError(-32600, 'Invalid request'));
      try {
        await client.sendMessage(message);
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(A2AError);
        expect((err as A2AError).code).toBe(-32600);
        expect((err as A2AError).message).toBe('Invalid request');
      }
    });
  });

  describe('getTask()', () => {
    it('sends tasks/get request', async () => {
      mockFetch.mockResolvedValueOnce(rpcResponse(task));

      const client = new A2AClient('https://agent.example.com');
      const result = await client.getTask('task-123');

      expect(result).toEqual(task);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.method).toBe('tasks/get');
      expect(body.params.id).toBe('task-123');
    });
  });

  describe('cancelTask()', () => {
    it('sends tasks/cancel request', async () => {
      const canceled = { ...task, status: { state: 'canceled', timestamp: '2024-01-01T00:00:01Z' } };
      mockFetch.mockResolvedValueOnce(rpcResponse(canceled));

      const client = new A2AClient('https://agent.example.com');
      const result = await client.cancelTask('task-123');

      expect(result.status.state).toBe('canceled');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.method).toBe('tasks/cancel');
    });
  });

  describe('error handling', () => {
    it('throws on HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));

      const client = new A2AClient('https://agent.example.com');
      await expect(client.getTask('x')).rejects.toThrow('HTTP error: 500');
    });

    it('throws on network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const client = new A2AClient('https://agent.example.com');
      await expect(client.getTask('x')).rejects.toThrow('Network error');
    });

    it('throws on timeout', async () => {
      mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      });

      const client = new A2AClient('https://agent.example.com', { timeout: 50 });
      await expect(client.getTask('x')).rejects.toThrow('timed out');
    });
  });

  describe('A2AError', () => {
    it('fromRpcError creates error with code and data', () => {
      const err = A2AError.fromRpcError({ code: -32601, message: 'Method not found', data: { method: 'foo' } });
      expect(err).toBeInstanceOf(A2AError);
      expect(err.code).toBe(-32601);
      expect(err.message).toBe('Method not found');
      expect(err.data).toEqual({ method: 'foo' });
    });
  });
});

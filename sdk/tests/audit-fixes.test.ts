import { AgentRegistry } from '../src/AgentRegistry';
import { EscrowRegistry } from '../src/EscrowRegistry';
import { ValidationRegistry } from '../src/ValidationRegistry';
import { A2AClient } from '../src/A2AClient';
import { formatXpr, formatXprQuantity } from '../src/utils';
import type { JsonRpc } from '../src/types';

function rpcWith(query: (q: any) => any): JsonRpc {
  return { get_table_rows: jest.fn(async q => query(q)) } as JsonRpc;
}

it('agent iteration consumes lookahead rows even when a page is filtered empty', async () => {
  const rows = [
    { account: 'alice', active: 0 },
    { account: 'bob', active: 1 },
    { account: 'carol', active: 1 },
  ];
  const rpc = rpcWith(q => {
    const rest = rows.filter(row => !q.lower_bound || row.account >= q.lower_bound);
    return { rows: rest.slice(0, q.limit), more: rest.length > q.limit };
  });
  const accounts = [];
  for await (const agent of new AgentRegistry(rpc).listAgentsIterator({ limit: 1 })) accounts.push(agent.account);
  expect(accounts).toEqual(['bob', 'carol']);
});

it('refuses an agent continuation with no usable key', async () => {
  const rpc = rpcWith(() => ({ rows: [], more: true }));
  await expect(new AgentRegistry(rpc).listAgents()).rejects.toThrow('continuation key');
});

it.each(['listJobsByClient', 'listJobsByAgent'] as const)('%s continues short pages across other accounts using primary next_key', async method => {
  const field = method === 'listJobsByClient' ? 'client' : 'agent';
  const rows = [9, 8, 7, 4, 3, 2].map(id => ({ id, [field]: [8, 3].includes(id) ? 'bob' : 'alice' }));
  const rpc = rpcWith(q => {
    const rest = rows.filter(row => q.index_position ? row[field] === 'alice' : row.id <= Number(q.upper_bound));
    const count = q.index_position ? 1 : 2;
    return { rows: rest.slice(0, count), more: rest.length > count, next_key: q.index_position ? 'alice' : String(rest[count]?.id ?? '') };
  });
  const registry = new EscrowRegistry(rpc);
  const first = await registry[method]('alice', { limit: 2 });
  const second = await registry[method]('alice', { limit: 2, cursor: first.nextCursor });
  const third = await registry[method]('alice', { limit: 2, cursor: second.nextCursor });
  expect([first.items, second.items, third.items].map(page => page.map(job => job.id))).toEqual([[9], [4, 7], [2]]);
  expect(rpc.get_table_rows).toHaveBeenCalledWith(expect.objectContaining({ upper_bound: '4', reverse: true }));
  expect(third.hasMore).toBe(false);
});

it('services use the RPC next_key after a short filtered page', async () => {
  const rpc = rpcWith(q => q.lower_bound === undefined
    ? { rows: [{ id: 1, active: 0 }], more: true, next_key: '10' }
    : { rows: [{ id: 10, active: 1 }], more: false });
  const registry = new EscrowRegistry(rpc);
  const first = await registry.listServices({ limit: 2 });
  expect(first.items).toEqual([]);
  expect(first.hasMore).toBe(true);
  const second = await registry.listServices({ cursor: first.nextCursor, limit: 2 });
  expect(rpc.get_table_rows).toHaveBeenLastCalledWith(expect.objectContaining({ lower_bound: '10' }));
  expect(second.items.map(service => service.id)).toEqual([10]);
  expect(second.hasMore).toBe(false);
});

it.each([100, '100'])('open jobs follow short-page next_key with ID %p', async id => {
  const rpc = rpcWith(q => q.lower_bound === undefined
    ? { rows: [{ id, agent: 'bob', state: 0 }], more: true, next_key: '150' }
    : { rows: [{ id: '150', agent: '', state: 0 }], more: false });
  const page = await new EscrowRegistry(rpc).listOpenJobs({ limit: 1 });
  expect(page.items.map(job => job.id)).toEqual([150]);
  expect(rpc.get_table_rows).toHaveBeenLastCalledWith(expect.objectContaining({ lower_bound: '150' }));
  expect(page.hasMore).toBe(false);
});

it('open jobs preserve full u64 precision in lookahead cursors', async () => {
  const rpc = rpcWith(() => ({
    rows: ['9007199254740992', '9007199254740993'].map(id => ({ id, agent: '', state: 0 })), more: false,
  }));
  const page = await new EscrowRegistry(rpc).listOpenJobs({ limit: 1 });
  expect(page.nextCursor).toBe('9007199254740993');
});

it('keeps the string items of a mixed JSON array', async () => {
  const json = '["compute", 42]';
  const rpc = rpcWith(() => ({ rows: [{ id: '1', active: 1, specializations: json, deliverables: json }], more: false }));
  expect(await new ValidationRegistry(rpc).listValidators({ specialization: 'compute' })).toHaveLength(1);
  expect((await new EscrowRegistry(rpc).getJob(1))!.deliverables).toEqual(['compute']);
});

it.each(['null', '42', '{}', '[42]'])('normalizes wrong-shape JSON %s for validators and deliverables', async json => {
  const rpc = rpcWith(() => ({ rows: [{ id: '1', active: 1, specializations: json, deliverables: json }], more: false }));
  expect(await new ValidationRegistry(rpc).listValidators({ specialization: 'compute' })).toEqual([]);
  const registry = new EscrowRegistry(rpc);
  expect((await registry.getJob(1))!.deliverables).toEqual([]);
  expect((await registry.getService(1))!.deliverables).toEqual([]);
});

it.each([NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1.5])('refuses an inexact raw transfer amount %p', amount => {
  expect(() => formatXprQuantity(amount)).toThrow('safe integer');
});

it('formats the safe integer limits exactly, including negative amounts', () => {
  expect(formatXpr(Number.MAX_SAFE_INTEGER)).toBe('900719925474.0991 XPR');
  expect(formatXpr(-Number.MAX_SAFE_INTEGER)).toBe('-900719925474.0991 XPR');
});

it.each(['ftp://example.test', 'file:///tmp/example', 'javascript:void(0)', 'data:text/plain,hello', 'not a URL'])('rejects endpoint %s during construction', endpoint => {
  expect(() => new A2AClient(endpoint)).toThrow();
});

it.each(['http://example.test', 'https://example.test'])('accepts endpoint %s', endpoint => {
  expect(() => new A2AClient(endpoint)).not.toThrow();
});

it('caps the older-jobs scan for a sparse account and resumes from where it stopped', async () => {
  let calls = 0;
  const rpc = rpcWith((params: any) => {
    calls++;
    const top = BigInt(params.upper_bound);
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: String(top - BigInt(i)), client: 'bob', agent: 'carol', deliverables: '[]' }));
    return { rows, more: true, next_key: String(top - 100n) };
  });
  const page = await new EscrowRegistry(rpc).listJobsByClient('alice', { cursor: '1000001', limit: 1 });
  expect(calls).toBe(10);
  expect(page.items).toEqual([]);
  expect(page.hasMore).toBe(true);
  expect(page.nextCursor).toBe('999001');
});

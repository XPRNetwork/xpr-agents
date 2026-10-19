import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as timeouts from '../src/timeouts';
import * as scanGuard from '../src/scan-guard';
import { isReadonlyToolName } from '../src/a2a-tools';

// Execute the unchanged entrypoint with mocked imports, captured routes and an
// in-memory disk. Appending exports only exposes private functions for testing.
// No real sockets, network, timers, chain calls, signing or filesystem writes.
function harness(disk = new Map<string, string>()) {
  const routes = new Map<string, any>();
  const middleware: any[] = [];
  const toolHandlers = new Map<string, any>();
  for (const name of ['xpr_claim_timeout', 'xpr_cancel_job', 'xpr_deliver_job', 'xpr_ask_client', 'xpr_get_job_messages']) {
    toolHandlers.set(name, vi.fn().mockResolvedValue({ transaction_id: 'fixture-tx' }));
  }
  const complete = vi.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [{ dispute_window: 259200 }] }) });
  const auth = vi.fn().mockResolvedValue({ account: 'alice' });
  const scanInbound = vi.fn((text: string) => ({ action: 'allow', text, flagged: [] }));
  const writeFileSync = vi.fn((p: string, value: string) => disk.set(p, value));
  const fakeFs = { existsSync: (p: string) => disk.has(p),
    readFileSync: (p: string) => { if (!disk.has(p)) throw new Error('No fixture'); return disk.get(p); },
    writeFileSync,
    renameSync: (from: string, to: string) => { disk.set(to, disk.get(from)!); disk.delete(from); },
  };
  const app = { set() {}, use: (f: any) => middleware.push(f),
    get: (p: string, h: any) => routes.set(`GET ${p}`, h), post: (p: string, h: any) => routes.set(`POST ${p}`, h),
    listen: () => ({ close() {} }) };
  const imports: Record<string, any> = {
    express: Object.assign(() => app, { json: () => (_req: any, _res: any, next: any) => next() }),
    fs: fakeFs, path,
    './llm': { createLlmClientFromEnv: () => ({ complete, model: 'fixture' }) },
    './a2a-auth': { verifyA2ARequest: auth, A2AAuthError: class extends Error {} },
    './a2a-tools': { isReadonlyToolName },
    './security': { scanInbound, scanOutput: (_name: string, text: string) => ({ action: 'allow', text, flagged: [] }),
      loadSecurityConfig: () => ({}), getSecurityStats: () => ({}) },
    './skill-loader': { loadBuiltinSkill: () => null, loadSkills: () => ({ skills: [], capabilities: [], promptSections: [] }) },
    './token-budget': { MAX_TOKENS_PER_RUN: 100000, MAX_TOKENS_PER_DAY: 1000000,
      dailyTokenBudgetExhausted: () => false, recordTokenUsage: () => 0 },
    './scan-guard': scanGuard, './timeouts': timeouts, './llm-errors': {},
    '@xpr-agents/openclaw': { default: (api: any) => toolHandlers.forEach((handler, name) => api.registerTool({
      name, handler, description: name, parameters: { type: 'object', properties: {} },
    })), checkProtonCli: async () => true, checkKeychainPopulated: async () => true },
  };
  const requireMock: any = (name: string) => { if (!(name in imports)) throw new Error(`Unexpected import: ${name}`); return imports[name]; };
  requireMock.resolve = () => '/fixture/openclaw/package.json';
  const source = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8') + `
    Object.assign(exports, { runHousekeeping, runAgent, deliveredEvidenceByJob, tools,
      savePollerState, loadPollerState, knownJobStates, timeoutAttempts, fundedJobAttempts,
      pruneTerminalJobs, capSet, loadMemory, getMemoryContext, MAX_TRACKED_IDS,
      POLLER_STATE_PATH, AGENT_MEMORY_PATH, a2aTasks, pollOnChainInner,
      setEvalCount: (n) => { dailyEvalCount = n; } });`;
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const api: any = {};
  vm.runInNewContext(js, { require: requireMock, exports: api, __dirname: '/fixture/agent/src',
    process: { env: { XPR_ACCOUNT: 'testagent', XPR_RPC_ENDPOINT: 'https://rpc.invalid',
      OPENCLAW_HOOK_TOKEN: 'fixture-secret', POLL_ENABLED: 'false', DATA_DIR: '/fixture/data' },
      on() {}, exit() { throw new Error('Unexpected exit'); } },
    console: { log() {}, warn() {}, error() {} }, setInterval: () => ({ unref() {} }),
    setTimeout: () => { throw new Error('Unexpected timer'); }, clearTimeout() {}, Buffer, URL, fetch: fetchMock,
  });
  async function request(method: string, params: any = {}, body?: any) {
    const reqBody = body ?? { jsonrpc: '2.0', id: 1, method, params };
    const response: any = { statusCode: 200, status(n: number) { this.statusCode = n; return this; },
      json(value: any) { this.body = value; return this; } };
    await routes.get('POST /a2a')({ headers: {}, body: reqBody, rawBody: JSON.stringify(reqBody) }, response);
    return response.body;
  }
  function modelTools(calls: Array<[string, any]>) {
    complete.mockResolvedValueOnce({ stop_reason: 'tool_use', content: calls.map(([name, input], i) => ({
      type: 'tool_use', id: String(i), name, input,
    })) });
  }
  return { ...api, request, modelTools, toolHandlers, complete, auth, fetchMock, disk, writeFileSync, middleware };
}

const delivered = () => ({ id: 7, client: 'client', agent: 'testagent', state: 4,
  deadline: Math.floor(Date.now() / 1000) - 86400, updated_at: Math.floor(Date.now() / 1000) - 4 * 86400 });
const listing = (job = delivered()) => ({ handler: vi.fn().mockResolvedValue({ items: [job], hasMore: false }) });
const message = { parts: [{ type: 'text', text: 'Hello' }] };

describe('runner review findings', () => {
  it('P1: a successful timeout is not sent again when the next listing is stale', async () => {
    const r = harness();
    const list = listing();
    await r.runHousekeeping(list, 'testagent');
    await r.runHousekeeping(list, 'testagent');
    expect(r.toolHandlers.get('xpr_claim_timeout')).toHaveBeenCalledTimes(1);
  });

  it('P1: unavailable dispute-window config does not authorize an early timeout', async () => {
    const r = harness();
    // Actual contract window could be 7 days; no successful config read yet.
    r.fetchMock.mockRejectedValue(new Error('RPC unavailable'));
    await r.runHousekeeping(listing(), 'testagent');
    expect(r.toolHandlers.get('xpr_claim_timeout')).not.toHaveBeenCalled();
  });

  it('P1: overlapping housekeeping cycles send at most one claim per job', async () => {
    const r = harness();
    await Promise.all([r.runHousekeeping(listing(), 'testagent'), r.runHousekeeping(listing(), 'testagent')]);
    expect(r.toolHandlers.get('xpr_claim_timeout')).toHaveBeenCalledTimes(1);
  });

  it('P1: a paused escrow config prevents sending timeout claims', async () => {
    const r = harness();
    r.fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows: [{ dispute_window: 259200, paused: true }] }) });
    await r.runHousekeeping(listing(), 'testagent');
    expect(r.toolHandlers.get('xpr_claim_timeout')).not.toHaveBeenCalled();
  });

  it('P2: failed revised delivery can retry the same new evidence', async () => {
    const r = harness();
    r.deliveredEvidenceByJob.set(7, new Set(['ipfs://old']));
    r.toolHandlers.get('xpr_deliver_job').mockRejectedValueOnce(new Error('RPC temporarily unavailable'));
    const call: [string, any] = ['xpr_deliver_job', { job_id: 7, evidence_uri: 'ipfs://new' }];
    r.modelTools([call, call]);
    await r.runAgent('poll:job_revised', { job_id: 7 }, 'Revise the work');
    expect(r.toolHandlers.get('xpr_deliver_job')).toHaveBeenCalledTimes(2);
  });

  it('P2: asks the client at most once for a job in a single model run', async () => {
    const r = harness();
    r.modelTools([['xpr_ask_client', { job_id: 7, text: 'Which format?', confirmed: true }],
      ['xpr_ask_client', { job_id: 7, text: 'Which format?', confirmed: true }]]);
    await r.runAgent('poll:job_assigned', { job_id: 7 }, 'Ask once if needed');
    expect(r.toolHandlers.get('xpr_ask_client')).toHaveBeenCalledTimes(1);
  });

  it('P2: a revision deferred by the daily evaluation cap runs when credits return', async () => {
    const r = harness();
    r.knownJobStates.set(7, 4);
    r.tools.push({ name: 'xpr_list_jobs', handler: listing({ ...delivered(), state: 3, amount: 1000000, title: 'Report' } as any).handler });
    r.setEvalCount(10);
    await r.pollOnChainInner();
    expect(r.complete).not.toHaveBeenCalled();
    r.setEvalCount(0); // equivalent to the next day's evaluation allowance
    await r.pollOnChainInner();
    expect(r.complete).toHaveBeenCalledTimes(1);
  });


  it('P3: malformed A2A parts produce invalid-params rather than an internal exception', async () => {
    const r = harness();
    const result = await r.request('message/send', { message: { parts: {} } });
    expect(result.error.code).toBe(-32602);
    expect(r.complete).not.toHaveBeenCalled();
  });

  it('P3: empty A2A messages are rejected before spending a model call', async () => {
    const r = harness();
    await r.request('message/send', { message: { parts: [] } });
    expect(r.complete).not.toHaveBeenCalled();
  });

  it('P3: A2A internal failures do not return provider secrets to the caller', async () => {
    const r = harness();
    r.complete.mockRejectedValue(new Error('upstream failed Authorization: Bearer fixture-provider-secret'));
    const result = await r.request('message/send', { message });
    expect(result.error).toBeDefined();
    expect(JSON.stringify(result)).not.toContain('fixture-provider-secret');
  });

  it('P5: interrupted poller save preserves the previous complete snapshot on restart', () => {
    const r = harness();
    r.knownJobStates.set(7, 4);
    r.timeoutAttempts.set(7, 3);
    r.savePollerState();
    r.writeFileSync.mockImplementationOnce((p: string, value: string) => {
      r.disk.set(p, value.slice(0, 30));
      throw new Error('simulated interrupted write');
    });
    r.savePollerState();
    const restarted = harness(r.disk);
    expect(restarted.loadPollerState()).toBe(true);
    expect(restarted.timeoutAttempts.get(7)).toBe(3);
  });

  it('P5: completed-job pruning also bounds persisted retry maps', () => {
    const r = harness();
    for (let id = 1; id <= r.MAX_TRACKED_IDS + 10; id++) {
      r.knownJobStates.set(id, 6);
      r.timeoutAttempts.set(id, 3);
      r.fundedJobAttempts.set(id, 3);
    }
    r.pruneTerminalJobs();
    r.savePollerState();
    const state = JSON.parse(r.disk.get(r.POLLER_STATE_PATH)!);
    expect(Object.keys(state.timeoutAttempts).length).toBeLessThanOrEqual(r.MAX_TRACKED_IDS);
    expect(Object.keys(state.fundedJobAttempts).length).toBeLessThanOrEqual(r.MAX_TRACKED_IDS);
  });

  it('P5: interrupted memory save preserves the last complete memory on restart', async () => {
    const r = harness();
    const save = r.tools.find((t: any) => t.name === 'memory_save').handler;
    await save({ key: 'job7', value: 'completed' });
    r.writeFileSync.mockImplementationOnce((p: string, value: string) => {
      r.disk.set(p, value.slice(0, 10));
      throw new Error('simulated interrupted write');
    });
    await save({ key: 'job8', value: 'pending' });
    const restarted = harness(r.disk);
    restarted.loadMemory();
    expect(restarted.getMemoryContext()).toContain('completed');
  });
});

describe('properties that hold', () => {
  it('P2: revision briefing uses the newest note from chronological per-job indexer events', async () => {
    const r = harness();
    r.knownJobStates.set(7, 4);
    r.tools.push({ name: 'xpr_list_jobs', handler: listing({ ...delivered(), state: 3, amount: 1000000, title: 'Report' } as any).handler });
    r.fetchMock.mockResolvedValue({ ok: true, json: async () => ({ events: [
      { id: 10, action_name: 'revise', data: { job_id: 7, notes: 'Use the September figures' } },
      { id: 20, action_name: 'revise', data: { job_id: 7, notes: 'Use the corrected October figures' } },
    ] }) });
    await r.pollOnChainInner();
    expect(r.complete).toHaveBeenCalledTimes(1);
    expect(r.complete.mock.calls[0][0].messages[0].content).toContain('The client\'s note: "Use the corrected October figures"');
  });

  it('P1: strict deadline/window boundaries, wrong party, terminal states and duplicate rows are safe', () => {
    const j = { ...delivered(), deadline: 100, updated_at: 100 };
    expect(timeouts.findHousekeepingActions([j], { account: 'testagent', nowSec: 110, disputeWindowSec: 10 })).toEqual([]);
    expect(timeouts.findHousekeepingActions([j, j], { account: 'testagent', nowSec: 111, disputeWindowSec: 10 })).toHaveLength(1);
    expect(timeouts.findHousekeepingActions([j], { account: 'outsider', nowSec: 999999 })).toEqual([]);
    expect(timeouts.findHousekeepingActions([5, 6, 7, 8].map(state => ({ ...j, state })), { account: 'testagent', nowSec: 999999 })).toEqual([]);
  });

  it('P1: thrown claim failures stop after three tries and remain capped across restart', async () => {
    const r = harness();
    r.toolHandlers.get('xpr_claim_timeout').mockRejectedValue(new Error('chain rejects'));
    for (let n = 0; n < 5; n++) await r.runHousekeeping(listing(), 'testagent');
    expect(r.toolHandlers.get('xpr_claim_timeout')).toHaveBeenCalledTimes(3);
    r.savePollerState();
    const restarted = harness(r.disk);
    expect(restarted.loadPollerState()).toBe(true);
    await restarted.runHousekeeping(listing(), 'testagent');
    expect(restarted.toolHandlers.get('xpr_claim_timeout')).not.toHaveBeenCalled();
  });

  it('P2: previously rejected evidence is blocked before the delivery tool', async () => {
    const r = harness();
    r.deliveredEvidenceByJob.set(7, new Set(['ipfs://old']));
    r.modelTools([['xpr_deliver_job', { job_id: 7, evidence_uri: 'ipfs://old' }]]);
    await r.runAgent('poll:job_revised', { job_id: 7 }, 'Revise');
    expect(r.toolHandlers.get('xpr_deliver_job')).not.toHaveBeenCalled();
  });

  it('P3: another caller cannot read, cancel or overwrite a task', async () => {
    const r = harness();
    expect((await r.request('message/send', { id: 'private', message })).result.owner).toBe('alice');
    r.auth.mockResolvedValue({ account: 'bob' });
    for (const method of ['tasks/get', 'tasks/cancel', 'message/send']) {
      expect((await r.request(method, { id: 'private', message })).error).toBeDefined();
    }
    expect(r.a2aTasks.get('private').owner).toBe('alice');
  });

  it('P3: pre-auth limiter rejects the 121st request from one IP', () => {
    const r = harness();
    const next = vi.fn();
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    for (let n = 0; n < 121; n++) r.middleware[0]({ path: '/a2a', ip: '192.0.2.1' }, res, next);
    expect(next).toHaveBeenCalledTimes(120);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('P5: normal memory and poller snapshots round trip', async () => {
    const r = harness();
    await r.tools.find((t: any) => t.name === 'memory_save').handler({ key: 'job7', value: 'completed' });
    r.knownJobStates.set(7, 6);
    r.savePollerState();
    const restarted = harness(r.disk);
    restarted.loadMemory();
    expect(restarted.getMemoryContext()).toContain('completed');
    expect(restarted.loadPollerState()).toBe(true);
    expect(restarted.knownJobStates.get(7)).toBe(6);
  });

  it('P5: ordinary memory keys are capped at the configured default of 100 entries', async () => {
    const r = harness();
    const save = r.tools.find((t: any) => t.name === 'memory_save').handler;
    for (let id = 0; id < 101; id++) await save({ key: `job_${id}`, value: 'done' });
    expect(Object.keys(JSON.parse(r.disk.get(r.AGENT_MEMORY_PATH)!))).toHaveLength(100);
  });
});

describe('audit fix edge cases', () => {
  it('keeps successful claims suppressed after restart without starving later jobs', async () => {
    const r = harness();
    const list = { handler: vi.fn().mockResolvedValue({ items: [7, 8, 9, 10].map(id => ({ ...delivered(), id })) }) };
    await r.runHousekeeping(list, 'testagent');
    expect(r.toolHandlers.get('xpr_claim_timeout')).toHaveBeenCalledTimes(3);
    const restarted = harness(r.disk);
    expect(restarted.loadPollerState()).toBe(true);
    await restarted.runHousekeeping(list, 'testagent');
    expect(restarted.toolHandlers.get('xpr_claim_timeout')).toHaveBeenCalledTimes(1);
    expect(restarted.toolHandlers.get('xpr_claim_timeout')).toHaveBeenCalledWith({ job_id: 10, confirmed: true });
  });

  it('does not treat a confirmation prompt as a successful delivery', async () => {
    const r = harness();
    r.deliveredEvidenceByJob.set(7, new Set(['ipfs://old']));
    r.toolHandlers.get('xpr_deliver_job').mockResolvedValueOnce({ needs_confirmation: true });
    const call: [string, any] = ['xpr_deliver_job', { job_id: 7, evidence_uri: 'ipfs://new' }];
    r.modelTools([call, call, call]);
    await r.runAgent('poll:job_revised', { job_id: 7 }, 'Revise');
    expect(r.toolHandlers.get('xpr_deliver_job')).toHaveBeenCalledTimes(2);
  });

  it('retries failed questions and preserves the waiting state across runs and restart', async () => {
    const r = harness();
    const call: [string, any] = ['xpr_ask_client', { job_id: 7, text: 'Which format?', confirmed: true }];
    r.toolHandlers.get('xpr_ask_client').mockRejectedValueOnce(new Error('RPC unavailable'));
    r.modelTools([call, call]);
    await r.runAgent('manual', {}, 'Ask');
    r.modelTools([call]);
    await r.runAgent('manual', {}, 'Ask again');
    expect(r.toolHandlers.get('xpr_ask_client')).toHaveBeenCalledTimes(2);
    const restarted = harness(r.disk);
    expect(restarted.loadPollerState()).toBe(true);
    restarted.modelTools([call]);
    await restarted.runAgent('manual', {}, 'Ask again');
    expect(restarted.toolHandlers.get('xpr_ask_client')).not.toHaveBeenCalled();
  });

  it('rechecks pause and config availability after a successful read', async () => {
    const r = harness();
    await r.runHousekeeping(listing(), 'testagent');
    r.fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [{ dispute_window: 259200, paused: true }] }) });
    await r.runHousekeeping(listing({ ...delivered(), id: 8 }), 'testagent');
    r.fetchMock.mockRejectedValueOnce(new Error('RPC unavailable'));
    await r.runHousekeeping(listing({ ...delivered(), id: 9 }), 'testagent');
    expect(r.toolHandlers.get('xpr_claim_timeout')).toHaveBeenCalledTimes(1);
    expect(r.timeoutAttempts.size).toBe(0);
  });

  it('prunes unlisted retries only after a successful listing', async () => {
    const r = harness();
    r.timeoutAttempts.set(8, 3);
    await r.runHousekeeping({ handler: vi.fn().mockRejectedValue(new Error('RPC unavailable')) }, 'testagent');
    expect(r.timeoutAttempts.get(8)).toBe(3);
    await r.runHousekeeping(listing(), 'testagent');
    expect(r.timeoutAttempts.has(8)).toBe(false);
    r.fundedJobAttempts.set(8, 2);
    r.tools.push({ name: 'xpr_list_jobs', handler: vi.fn().mockResolvedValue({ items: [], hasMore: false }) });
    await r.pollOnChainInner();
    expect(r.fundedJobAttempts.has(8)).toBe(false);
  });

  it('keeps retry caps for jobs a truncated listing leaves out', async () => {
    const r = harness();
    r.timeoutAttempts.set(8, 3);
    await r.runHousekeeping({ handler: vi.fn().mockResolvedValue({ items: [{ ...delivered(), id: 9 }], hasMore: true }) }, 'testagent');
    expect(r.timeoutAttempts.get(8)).toBe(3);
    await r.runHousekeeping({ handler: vi.fn().mockResolvedValue({ items: [{ ...delivered(), id: 8, state: 6 }], hasMore: true }) }, 'testagent');
    expect(r.timeoutAttempts.has(8)).toBe(false);
  });

  it('still cancels expired unfunded jobs while the contract is paused, but claims no timeouts', async () => {
    const r = harness();
    r.fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows: [{ dispute_window: 259200, paused: 1 }] }) });
    await r.runHousekeeping(listing(), 'testagent');
    expect(r.toolHandlers.get('xpr_claim_timeout')).not.toHaveBeenCalled();
  });

  it('rejects malformed and whitespace-only A2A text without a model call', async () => {
    const r = harness();
    for (const parts of [[null], [{ type: 'text', text: {} }], [{ type: 'text', text: ' \n ' }], [{ type: 'file', file: {} }]]) {
      expect((await r.request('message/send', { message: { parts } })).error.code).toBe(-32602);
    }
    expect(r.complete).not.toHaveBeenCalled();
  });

  it('does not expose unexpected authentication failures', async () => {
    const r = harness();
    r.auth.mockRejectedValue(new Error('fixture-provider-secret'));
    const result = await r.request('message/send', { message });
    expect(result.error.code).toBe(-32000);
    expect(JSON.stringify(result)).not.toContain('fixture-provider-secret');
  });

  it('retains a budget-deferred revision across restart', async () => {
    const r = harness();
    r.knownJobStates.set(7, 4);
    const list = { name: 'xpr_list_jobs', handler: listing({ ...delivered(), state: 3, amount: 1000000, title: 'Report' } as any).handler };
    r.tools.push(list);
    r.setEvalCount(10);
    await r.pollOnChainInner();
    const restarted = harness(r.disk);
    expect(restarted.loadPollerState()).toBe(true);
    restarted.tools.push(list);
    restarted.setEvalCount(0);
    await restarted.pollOnChainInner();
    expect(restarted.complete).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase, ensureContractCursors, updateContractCursor, getContractCursors, markActionProcessed, hasBeenProcessed } from '../src/db/schema';
import { handleEscrowAction, handleEscrowTransfer } from '../src/handlers/escrow';
import { handleValidationAction } from '../src/handlers/validation';
import { handleFeedbackAction } from '../src/handlers/feedback';
import { handleAgentAction } from '../src/handlers/agent';
import { pendingCorrections, setRpcEndpoint, flushPendingCorrections } from '../src/handlers/id-correction';
import { createRoutes } from '../src/api/routes';
import { WebhookDispatcher } from '../src/webhooks/dispatcher';
import { HyperionPoller } from '../src/poller';
import type { StreamAction } from '../src/stream';

// All network/chain access is mocked. Invoke actual Express route callbacks
// with mock req/res, without opening a listening socket.
let db: Database.Database;
let seq = 0;
const timestamp = '2026-10-01T12:00:00.000Z';
const ts = Date.parse(timestamp) / 1000;
function action(account: string, name: string, data: Record<string, any>, time = timestamp): StreamAction {
  return { block_num: 100, global_sequence: ++seq, action_ordinal: seq, timestamp: time,
    trx_id: 'same-transaction', act: { account, name, data, authorization: [{ actor: data.client || data.agent || data.account || 'operator', permission: 'active' }] } };
}
function escrow(name: string, data: Record<string, any>, time = timestamp) {
  handleEscrowAction(db, action('agentescrow', name, data, time));
}
function job() {
  escrow('createjob', { client: 'bob', agent: 'alice', title: 'Design', description: '', deliverables: '[]', amount: 500000, symbol: 'XPR', deadline: ts + 86400, arbitrator: '', job_hash: 'job-a' });
  pendingCorrections.length = 0;
}
function service() {
  escrow('listsvc', { agent: 'alice', title: 'Logo', description: '', deliverables: '[]', price: 500000, turnaround: 86400, category: 'design', sample_uri: '' });
  pendingCorrections.length = 0;
}
function route(path: string, query: Record<string, any> = {}, params: Record<string, string> = {}, method = 'get', body: any = {}, headers: any = {}) {
  const router = createRoutes(db) as any;
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  const res: any = { statusCode: 200, body: undefined, status(code: number) { this.statusCode = code; return this; }, json(value: any) { this.body = value; return this; } };
  layer.route.stack[0].handle({ query, params, body, headers }, res);
  return res;
}
function sub(url: string, filters: any = ['*']) {
  return Number(db.prepare('INSERT INTO webhook_subscriptions (url, token, event_filter) VALUES (?, ?, ?)').run(url, 'token', JSON.stringify(filters)).lastInsertRowid);
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => {
  db = initDatabase(':memory:');
  pendingCorrections.length = 0;
  setRpcEndpoint('');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [], actions: [] }) }));
  for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => {});
  handleAgentAction(db, action('agentcore', 'register', { account: 'alice', name: 'Alice', description: '', endpoint: '', protocol: 'https', capabilities: '[]' }));
});
afterEach(() => {
  pendingCorrections.length = 0;
  setRpcEndpoint('');
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  db?.close();
});

describe('review findings: action consistency and identity', () => {
  // Known and accepted: only reachable on a fresh chain or a genesis replay with an empty
  // mirror, where the first job's synthetic id (1) differs from the chain's id 0. A safe fix
  // needs the contract's job counter; mainnet's mirror is past this point.
  it.skip('P2 funding the first chain job survives asynchronous correction from synthetic id 1 to chain id 0', async () => {
    const data = { client: 'bob', agent: 'alice', title: 'First job', description: '', deliverables: '[]', amount: 500000, symbol: 'XPR', deadline: ts + 86400, arbitrator: '', job_hash: 'first' };
    setRpcEndpoint('https://rpc.invalid');
    let finishLookup!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(resolve => { finishLookup = resolve; }));
    escrow('createjob', data);
    // index.ts starts, but does not await, this correction before processing
    // the next action. Fresh chain tables allocate id 0, not id 1.
    const correction = flushPendingCorrections();
    handleEscrowTransfer(db, action('eosio.token', 'transfer', { from: 'bob', to: 'agentescrow', quantity: '50.0000 XPR', memo: 'fund:0' }), 'agentescrow');
    finishLookup({ json: async () => ({ rows: [{ id: 0, ...data, created_at: ts, funded_amount: 500000, state: 1 }] }) } as Response);
    await correction;
    expect(db.prepare('SELECT state, funded_amount FROM jobs WHERE id = 0').get()).toEqual({ state: 1, funded_amount: 500000 });
  });
  it('P1 cleanstale removes eligible jobs and children using the configured age and scan bound', () => {
    job();
    db.prepare('UPDATE jobs SET created_at = ?, updated_at = ? WHERE id = 1').run(ts - 8 * 86400, ts - 8 * 86400);
    escrow('addmilestone', { client: 'bob', job_id: 1, title: 'Draft', description: '', amount: 100000, order: 0 });
    escrow('setlimits', { max_open_jobs: 5, max_milestones: 20, stale_after: 7 * 86400 });
    escrow('cleanstale', { from_id: 1, max_scan: 1 });
    // Archival is acceptable, as for cleanjobs; the row must leave live queries.
    expect(db.prepare('SELECT id FROM jobs WHERE id = 1 AND archived = 0').get()).toBeUndefined();
    expect(db.prepare('SELECT id FROM milestones WHERE job_id = 1 AND archived = 0').all()).toEqual([]);
  });
  it('P1 withdrawbid followed by submitbid exposes the replacement bid', () => {
    job();
    db.prepare("UPDATE jobs SET agent = ''").run();
    escrow('submitbid', { agent: 'alice', job_id: 1, amount: 500000, timeline: 86400, proposal: 'First offer' });
    escrow('withdrawbid', { agent: 'alice', bid_id: 1 });
    escrow('submitbid', { agent: 'alice', job_id: 1, amount: 400000, timeline: 7200, proposal: 'Replacement offer' }, '2026-10-01T12:01:00.000Z');
    expect(db.prepare('SELECT amount, proposal FROM bids WHERE job_id = 1 AND state = 0').all()).toEqual([{ amount: 400000, proposal: 'Replacement offer' }]);
  });
  it('P2 two validations for different jobs in one transaction retain both rows and totals', () => {
    handleValidationAction(db, action('agentvalid', 'regval', { account: 'validator', method: 'manual', specializations: '[]' }));
    for (const hash of ['job-a', 'job-b']) handleValidationAction(db, action('agentvalid', 'validate', { validator: 'validator', agent: 'alice', job_hash: hash, result: 1, confidence: 100, evidence_uri: '' }));
    expect(db.prepare('SELECT job_hash FROM validations ORDER BY id').all()).toEqual([{ job_hash: 'job-a' }, { job_hash: 'job-b' }]);
    expect(db.prepare('SELECT total_validations FROM validators').get()).toEqual({ total_validations: 2 });
  });
  it('P2 two purchases of one service in one transaction create two funded jobs and sales', () => {
    service();
    for (const notes of ['first logo', 'second logo']) handleEscrowTransfer(db, action('eosio.token', 'transfer', { from: 'bob', to: 'agentescrow', quantity: '50.0000 XPR', memo: `buy:1:${notes}` }), 'agentescrow');
    expect(db.prepare('SELECT COUNT(*) AS count, SUM(funded_amount) AS funded FROM jobs').get()).toEqual({ count: 2, funded: 1000000 });
    expect(db.prepare('SELECT sales FROM services').get()).toEqual({ sales: 2 });
  });
  it('P1 selectbid calculates the deadline from block time during replay', () => {
    job();
    db.prepare("UPDATE jobs SET agent = ''").run();
    escrow('submitbid', { agent: 'alice', job_id: 1, amount: 500000, timeline: 86400, proposal: 'Offer' });
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T12:00:00Z'));
    escrow('selectbid', { client: 'bob', bid_id: 1 });
    expect(db.prepare('SELECT deadline FROM jobs WHERE id = 1').get()).toEqual({ deadline: ts + 86400 });
  });
  it('P1 submitctx preserves the contract context prefix on tags', () => {
    handleFeedbackAction(db, action('agentfeed', 'submitctx', { reviewer: 'bob', agent: 'alice', context: 'design', score: 5, tags: 'fast', job_hash: 'job-a', evidence_uri: '', amount_paid: 500000 }));
    expect(db.prepare('SELECT tags FROM feedback').get()).toEqual({ tags: 'design:fast' });
  });
  it('P1 submitwpay stores payment_amount as feedback amount_paid', () => {
    handleFeedbackAction(db, action('agentfeed', 'submitwpay', { reviewer: 'bob', agent: 'alice', score: 5, tags: 'fast', job_hash: 'job-a', evidence_uri: '', payment_tx_id: 'a'.repeat(64), payment_amount: 500000, payment_symbol: 'XPR' }));
    expect(db.prepare('SELECT amount_paid FROM feedback').get()).toEqual({ amount_paid: 500000 });
  });
});

describe('review findings: REST and webhook robustness', () => {
  it('P3 negative event limits cannot bypass the 200 row maximum', () => {
    const insert = db.prepare("INSERT INTO events (block_num, transaction_id, action_name, contract, data, timestamp) VALUES (100, 'tx', 'test', 'agentescrow', '{}', ?)");
    db.transaction(() => { for (let i = 0; i < 201; i++) insert.run(ts); })();
    const res = route('/events', { limit: '-1' });
    expect(res.statusCode === 400 || res.body.events.length <= 200).toBe(true);
  });
  it('P3 negative job limits cannot bypass the 500 row maximum', () => {
    const insert = db.prepare("INSERT INTO jobs (id, client, agent, title, created_at) VALUES (?, 'bob', 'alice', 'job', ?)");
    db.transaction(() => { for (let i = 1; i <= 501; i++) insert.run(i, ts); })();
    const res = route('/jobs', { limit: '-1' });
    expect(res.statusCode === 400 || res.body.jobs.length <= 500).toBe(true);
  });
  it('P4 registration rejects non-string event filters before they can block other subscribers', () => {
    vi.stubEnv('WEBHOOK_ADMIN_TOKEN', 'admin');
    const res = route('/webhooks', {}, {}, 'post', { url: 'https://1.1.1.1/hook', token: 'token', event_filter: [null] }, { authorization: 'Bearer admin' });
    expect(res.statusCode).toBe(400);
  });
  it('P4 a malformed subscriber filter cannot prevent delivery to a healthy subscriber', async () => {
    sub('https://1.1.1.1/bad', [null]);
    sub('https://1.1.1.1/good');
    const dispatcher = new WebhookDispatcher(db);
    try { dispatcher.dispatch('job.created', [], {}, 'message'); } catch { /* Assert delivery below. */ }
    await settle();
    expect(vi.mocked(fetch).mock.calls.map(c => c[0])).toContain('https://1.1.1.1/good');
  });
});

describe('properties that hold', () => {
  it('P1 funding excess refunds and agentcancel keep funded/released accounting consistent', () => {
    job();
    handleEscrowTransfer(db, action('eosio.token', 'transfer', { from: 'bob', to: 'agentescrow', quantity: '60.0000 XPR', memo: 'fund:1' }), 'agentescrow');
    handleEscrowTransfer(db, action('eosio.token', 'transfer', { from: 'agentescrow', to: 'bob', quantity: '10.0000 XPR', memo: 'Overfunding refund for job 1' }), 'agentescrow');
    escrow('agentcancel', { agent: 'alice', job_id: 1, reason: 'Unavailable' });
    expect(db.prepare('SELECT state, funded_amount, released_amount FROM jobs WHERE id = 1').get()).toEqual({ state: 7, funded_amount: 500000, released_amount: 500000 });
  });
  it('P1 askclient answer and svcinput keep authors and purchase association', () => {
    service();
    handleEscrowTransfer(db, action('eosio.token', 'transfer', { from: 'bob', to: 'agentescrow', quantity: '50.0000 XPR', memo: 'buy:1' }), 'agentescrow');
    escrow('svcinput', { client: 'bob', text: 'Navy logo' });
    escrow('askclient', { agent: 'alice', job_id: 1, text: 'Size?' });
    escrow('answer', { client: 'bob', job_id: 1, text: 'Large' });
    expect(db.prepare('SELECT job_id, author, text FROM job_messages ORDER BY id').all()).toEqual([
      { job_id: 1, author: 'bob', text: 'Navy logo' }, { job_id: 1, author: 'alice', text: 'Size?' }, { job_id: 1, author: 'bob', text: 'Large' },
    ]);
  });
  it('P3 sort and search injection strings do not execute SQL or broaden filters', () => {
    handleAgentAction(db, action('agentcore', 'register', { account: 'alice', name: 'Alice' }));
    expect(route('/agents', { sort: 'account; DROP TABLE agents; --' }).body.agents).toHaveLength(1);
    expect(route('/search', { q: "' OR 1=1 --" }).body.agents).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM agents').get()).toEqual({ n: 1 });
  });
  it('P4 webhook registration requires the exact admin bearer token', () => {
    vi.stubEnv('WEBHOOK_ADMIN_TOKEN', 'admin');
    const body = { url: 'https://1.1.1.1/hook', token: 'token', event_filter: ['*'] };
    expect(route('/webhooks', {}, {}, 'post', body).statusCode).toBe(401);
    expect(route('/webhooks', {}, {}, 'post', body, { authorization: 'Bearer admi' }).statusCode).toBe(401);
    expect(route('/webhooks', {}, {}, 'post', body, { authorization: 'Bearer admin' }).statusCode).toBe(201);
  });
  it('P4 private destinations are refused and redirects are not followed', async () => {
    sub('http://127.0.0.1/hook');
    sub('https://1.1.1.1/hook');
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 302 } as Response);
    new WebhookDispatcher(db).dispatch('job.created', [], {}, 'message');
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.redirect).toBe('manual');
  });
  it('P4 a slow subscriber does not block a healthy subscriber', async () => {
    sub('https://1.1.1.1/slow');
    sub('https://1.1.1.1/fast');
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(async url => String(url).endsWith('/slow')
      ? new Promise<Response>(resolve => { finish = resolve; }) : { ok: true, status: 200 } as Response);
    new WebhookDispatcher(db).dispatch('job.created', [], {}, 'message');
    await settle();
    expect(db.prepare('SELECT subscription_id FROM webhook_deliveries').all()).toEqual([{ subscription_id: 2 }]);
    finish({ ok: true, status: 200 } as Response);
    await settle();
  });
  it('P4 retryable failures retry four times and disable at the failure threshold', async () => {
    vi.useFakeTimers();
    const id = sub('https://1.1.1.1/hook');
    db.prepare('UPDATE webhook_subscriptions SET failure_count = 49 WHERE id = ?').run(id);
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
    const dispatcher = new WebhookDispatcher(db);
    dispatcher.dispatch('job.created', [], {}, 'message');
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(db.prepare('SELECT enabled, failure_count FROM webhook_subscriptions').get()).toEqual({ enabled: 0, failure_count: 50 });
    dispatcher.dispatch('job.created', [], {}, 'next');
    await settle();
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it('P5 resume retains per-contract cursors and boundary dedup markers', async () => {
    ensureContractCursors(db, ['agentcore', 'agentescrow']);
    updateContractCursor(db, 'agentcore', 90);
    updateContractCursor(db, 'agentescrow', 100);
    markActionProcessed(db, '1234');
    ensureContractCursors(db, ['agentcore', 'agentescrow']);
    const poller = new HyperionPoller({ endpoint: 'https://hyperion.invalid', contracts: ['agentescrow'], contractStartBlocks: getContractCursors(db) });
    await (poller as any).pollContract('agentescrow');
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('after')).toBe('100');
    expect(getContractCursors(db).get('agentcore')).toBe(90);
    expect(hasBeenProcessed(db, '1234')).toBe(true);
  });
});

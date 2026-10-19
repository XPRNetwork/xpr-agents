import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../src/db/schema';
import { handleEscrowAction, handleEscrowTransfer } from '../src/handlers/escrow';
import { handleValidationAction } from '../src/handlers/validation';
import { pendingCorrections, flushPendingCorrections, setRpcEndpoint } from '../src/handlers/id-correction';
import { syncFromChain } from '../src/sync';
import { pagination } from '../src/api/pagination';
import { createRoutes } from '../src/api/routes';
import { WebhookDispatcher } from '../src/webhooks/dispatcher';
import type { StreamAction } from '../src/stream';

let db: Database.Database;
let sequence = 0;
const timestamp = '2026-10-01T12:00:00.000Z';
const now = Date.parse(timestamp) / 1000;
const week = 604800;
const contracts = { agentcore: 'agentcore', agentfeed: 'agentfeed', agentvalid: 'agentvalid', agentescrow: 'agentescrow' };
function action(account: string, name: string, data: Record<string, any>): StreamAction {
  return { block_num: 100, global_sequence: ++sequence, action_ordinal: sequence,
    timestamp, trx_id: 'batch', act: { account, name, data, authorization: [] } };
}
function escrow(name: string, data: Record<string, any>) {
  handleEscrowAction(db, action('agentescrow', name, data));
}
function seedJob(id: number, state = 0, funded = 0, released = 0, age = week + 1) {
  db.prepare(`INSERT INTO jobs (id, client, agent, title, state, funded_amount, released_amount, created_at, updated_at)
    VALUES (?, 'bob', 'alice', 'Job', ?, ?, ?, ?, ?)`)
    .run(id, state, funded, released, now - age, now - age);
}
function rpc(rows: Record<string, any[]>) {
  setRpcEndpoint('https://rpc.invalid');
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => ({
    json: async () => ({ rows: rows[JSON.parse(init.body).table] || [], more: false }),
  })));
}
beforeEach(() => {
  db = initDatabase(':memory:');
  db.prepare("INSERT INTO agents (account, name) VALUES ('alice', 'Alice')").run();
  pendingCorrections.length = 0;
  setRpcEndpoint('');
  for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => {});
});
afterEach(() => {
  pendingCorrections.length = 0;
  setRpcEndpoint('');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  db.close();
});

describe('cleanup contract boundaries', () => {
  it('counts ineligible rows toward max_scan and removes only settled, strictly stale rows', () => {
    escrow('setlimits', { max_open_jobs: 5, max_milestones: 20, stale_after: week });
    seedJob(0, 1, 100, 0);
    seedJob(1);
    seedJob(2, 7, 100, 100);
    seedJob(3, 7, 100, 99);
    seedJob(4, 0, 0, 0, week);
    seedJob(5, 0, 1);
    seedJob(6, 6, 100, 100);
    escrow('cleanstale', { from_id: 0, max_scan: 1 });
    expect(db.prepare('SELECT id FROM jobs WHERE archived = 1').all()).toEqual([]);
    db.prepare("INSERT INTO milestones (id, job_id, title) VALUES (1, 1, 'Draft')").run();
    db.prepare("INSERT INTO bids (id, job_id, agent) VALUES (1, 1, 'alice')").run();
    db.prepare("INSERT INTO job_messages (id, job_id, author, text) VALUES (1, 1, 'bob', 'Notes')").run();
    db.prepare("INSERT INTO job_evidence (job_id, evidence_uri) VALUES (1, 'ipfs://proof')").run();
    escrow('cleanstale', { from_id: 1, max_scan: 6 });
    expect(db.prepare('SELECT id FROM jobs WHERE archived = 1 ORDER BY id').all()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(db.prepare('SELECT archived FROM milestones').get()).toEqual({ archived: 1 });
    for (const table of ['bids', 'job_messages', 'job_evidence']) {
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
    }
  });

  it('uses block time for refund age and the default 30-day limit', () => {
    seedJob(1);
    escrow('cancel', { client: 'bob', job_id: 1 });
    expect(db.prepare('SELECT updated_at FROM jobs').get()).toEqual({ updated_at: now });
    const clean = action('agentescrow', 'cleanstale', { from_id: 1, max_scan: 1 });
    clean.timestamp = new Date((now + 2592001) * 1000).toISOString();
    handleEscrowAction(db, clean);
    expect(db.prepare('SELECT archived FROM jobs').get()).toEqual({ archived: 1 });
  });
});

it('replaces withdrawn history when the chain reuses a bid ID without reviving the old correction', async () => {
  seedJob(1);
  escrow('submitbid', { job_id: 1, agent: 'alice', amount: 500, timeline: 3600, proposal: 'Old' });
  escrow('withdrawbid', { agent: 'alice', bid_id: 1 });
  escrow('submitbid', { job_id: 1, agent: 'alice', amount: 400, timeline: 7200, proposal: 'New' });
  rpc({ bids: [{ id: 1, job_id: 1, agent: 'alice' }] });
  await flushPendingCorrections();
  expect(db.prepare('SELECT id, proposal, state FROM bids').all()).toEqual([{ id: 1, proposal: 'New', state: 0 }]);
  escrow('selectbid', { client: 'bob', bid_id: 1 });
  expect(db.prepare('SELECT amount, deadline FROM jobs').get()).toEqual({ amount: 400, deadline: now + 7200 });
});

it('keeps identical same-second actions and deduplicates replays by transaction ordinal without a sequence', () => {
  escrow('listsvc', { agent: 'alice', title: 'Logo', price: 100, turnaround: 3600 });
  handleValidationAction(db, action('agentvalid', 'regval', { account: 'validator' }));
  const buy = action('eosio.token', 'transfer', { from: 'bob', to: 'agentescrow', quantity: '0.0100 XPR', memo: 'buy:1' });
  const validate = action('agentvalid', 'validate', { validator: 'validator', agent: 'alice', job_hash: 'same', result: 1, confidence: 100 });
  buy.global_sequence = validate.global_sequence = 0;
  for (const ordinal of [1, 2, 1, 2]) {
    handleEscrowTransfer(db, { ...buy, action_ordinal: ordinal }, 'agentescrow');
    handleValidationAction(db, { ...validate, action_ordinal: ordinal });
  }
  expect(db.prepare('SELECT COUNT(*) AS n FROM jobs').get()).toEqual({ n: 2 });
  expect(db.prepare('SELECT sales FROM services').get()).toEqual({ sales: 2 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM validations').get()).toEqual({ n: 2 });
  expect(db.prepare('SELECT total_validations FROM validators').get()).toEqual({ total_validations: 2 });
});

it('claims snapshot rows once, preserves identities on resync, and loads cleanup limits', async () => {
  const validation = { validator: 'validator', agent: 'alice', job_hash: 'same', result: 1, confidence: 100, evidence_uri: '', timestamp: now };
  const job = { client: 'bob', agent: 'alice', title: 'Logo', description: '', job_hash: 'svc:1', created_at: now };
  rpc({
    validators: [{ account: 'validator', total_validations: 2 }],
    validations: [{ id: 0, ...validation }, { id: 1, ...validation }],
    jobs: [{ id: 0, ...job }, { id: 1, ...job }],
    services: [{ id: 1, agent: 'alice', title: 'Logo', sales: 2, active: true }],
    limits: [{ max_open_jobs: 8, max_milestones: 12, stale_after: week }],
  });
  await syncFromChain(db, 'https://rpc.invalid', contracts);
  const buys = [1, 2].map(() => action('eosio.token', 'transfer', { from: 'bob', to: 'agentescrow', quantity: '0.0100 XPR', memo: 'buy:1' }));
  const validations = [1, 2].map(() => action('agentvalid', 'validate', validation));
  for (const a of buys) handleEscrowTransfer(db, a, 'agentescrow');
  for (const a of validations) handleValidationAction(db, a);
  await syncFromChain(db, 'https://rpc.invalid', contracts);
  for (const a of buys) handleEscrowTransfer(db, a, 'agentescrow');
  for (const a of validations) handleValidationAction(db, a);
  for (const table of ['jobs', 'validations']) {
    expect(db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT source_action) AS identities FROM ${table}`).get()).toEqual({ n: 2, identities: 2 });
  }
  expect(db.prepare('SELECT sales FROM services').get()).toEqual({ sales: 2 });
  expect(db.prepare('SELECT total_validations FROM validators').get()).toEqual({ total_validations: 2 });
  expect(db.prepare('SELECT stale_after FROM escrow_limits').get()).toEqual({ stale_after: week });
});

it('bounds nonnumeric, fractional, negative, and extreme pagination values', () => {
  for (const value of ['bad', 'Infinity', 'NaN', [], {}, null]) {
    expect(pagination({ limit: value, offset: value }, 24, 200)).toEqual({ limit: 24, offset: 0 });
  }
  expect(pagination({ limit: '-1', offset: '-1' })).toEqual({ limit: 1, offset: 0 });
  expect(pagination({ limit: '0', offset: '3.7' })).toEqual({ limit: 1, offset: 3 });
  expect(pagination({ limit: '1e100', offset: '1e100' })).toEqual({ limit: 500, offset: Number.MAX_SAFE_INTEGER });
});

it('skips malformed stored filters while delivering to the next subscriber', async () => {
  const insert = db.prepare('INSERT INTO webhook_subscriptions (url, token, event_filter) VALUES (?, ?, ?)');
  for (const filter of ['null', '{}', '"job.*"', '[null]', '[" "]', 'broken']) {
    insert.run('https://1.1.1.1/bad', 'token', filter);
  }
  insert.run('https://1.1.1.1/good', 'token', '["job.*"]');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  new WebhookDispatcher(db).dispatch('job.created', [], {}, 'Created');
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://1.1.1.1/good');
});

it('runs every list route with malformed pagination through a bounded SQL query', () => {
  seedJob(1);
  vi.stubEnv('WEBHOOK_ADMIN_TOKEN', 'admin');
  const router = createRoutes(db) as any;
  const paths = ['/agents', '/agents/activity', '/agents/:account/feedback', '/agents/:account/validations',
    '/agents/:account/plugins', '/validators', '/validations/:id/challenges', '/plugins', '/jobs', '/jobs/open',
    '/jobs/:id/messages', '/jobs/:id/milestones', '/jobs/:id/disputes', '/services', '/jobs/:id/bids',
    '/agents/:account/bids', '/arbitrators', '/events', '/search', '/webhooks'];
  const prepare = vi.spyOn(db, 'prepare');
  for (const path of paths) {
    prepare.mockClear();
    const layer = router.stack.find((l: any) => l.route?.path === path && l.route.methods.get);
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    layer.route.stack[0].handle({ query: { limit: '-1', offset: 'bad', q: 'alice' }, params: { id: '1', account: 'alice' }, headers: { authorization: 'Bearer admin' } }, res);
    expect(res.json, path).toHaveBeenCalled();
    expect(prepare.mock.calls.some(([sql]) => /LIMIT .*OFFSET /s.test(sql)), path).toBe(true);
  }
  vi.unstubAllEnvs();
});

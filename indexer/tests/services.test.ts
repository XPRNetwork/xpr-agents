import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../src/db/schema';
import { handleAgentAction } from '../src/handlers/agent';
import { handleEscrowAction, handleEscrowTransfer } from '../src/handlers/escrow';
import {
  setRpcEndpoint,
  flushPendingCorrections,
  pendingCorrections,
} from '../src/handlers/id-correction';
import { queryService, queryServices, MAX_LIMIT } from '../src/api/services-query';
import { StreamAction } from '../src/stream';
import { WebhookDispatcher } from '../src/webhooks/dispatcher';

/* ------------------------------------------------------------------ */
/*  Test Helpers                                                        */
/* ------------------------------------------------------------------ */

let actionSeq = 0;
function createAction(
  account: string,
  name: string,
  data: Record<string, any>,
  overrides: Partial<StreamAction> = {},
): StreamAction {
  return {
    block_num: 100,
    global_sequence: ++actionSeq,
    action_ordinal: 1,
    timestamp: '2024-01-15T12:00:00.000Z',
    trx_id: 'abc123',
    act: {
      account,
      name,
      authorization: [{ actor: data.agent || data.account || 'test', permission: 'active' }],
      data,
    },
    ...overrides,
  };
}

/** eosio.token::transfer notification into agentescrow */
function createTransfer(from: string, to: string, quantity: string, memo: string): StreamAction {
  return createAction('eosio.token', 'transfer', { from, to, quantity, memo });
}

function createSpyDispatcher(db: Database.Database) {
  const events: Array<{ type: string; accounts: string[]; data: any; message: string }> = [];
  const dispatcher = new WebhookDispatcher(db);
  dispatcher.dispatch = (eventType, accounts, data, message, _blockNum) => {
    events.push({ type: eventType, accounts, data, message });
  };
  return { dispatcher, events };
}

/**
 * Stub the chain RPC used by the async ID-correction step. Rows are keyed by
 * table name so a services lookup and a jobs lookup can be answered in the
 * same test.
 */
function mockRpc(rowsByTable: Record<string, any[]>) {
  const fetchSpy = vi.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    return { json: async () => ({ rows: rowsByTable[body.table] || [] }) } as any;
  });
  vi.stubGlobal('fetch', fetchSpy);
  setRpcEndpoint('http://rpc.test');
  return fetchSpy;
}

const LIST_SVC = {
  agent: 'alice',
  title: 'Logo design',
  description: 'A logo in 3 concepts',
  deliverables: '["svg","png"]',
  price: 500000, // 50 XPR
  turnaround: 86400,
  category: 'image',
  sample_uri: 'ipfs://QmSample',
};

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(':memory:');
  // No RPC by default: synthetic IDs stand, corrections are inert.
  setRpcEndpoint('');
  pendingCorrections.length = 0;
  handleAgentAction(
    db,
    createAction('agentcore', 'register', {
      account: 'alice',
      name: 'Alice',
      description: '',
      endpoint: '',
      protocol: '',
      capabilities: '[]',
    }),
  );
});

afterEach(() => {
  pendingCorrections.length = 0;
  setRpcEndpoint('');
  vi.unstubAllGlobals();
});

function listService(overrides: Record<string, any> = {}) {
  handleEscrowAction(db, createAction('agentescrow', 'listsvc', { ...LIST_SVC, ...overrides }));
}

/* ------------------------------------------------------------------ */
/*  Listing handlers                                                    */
/* ------------------------------------------------------------------ */

describe('Service Handlers', () => {
  it('listsvc inserts a listing with a synthetic ID', () => {
    listService();

    const svc = db.prepare('SELECT * FROM services WHERE agent = ?').get('alice') as any;
    expect(svc).toBeTruthy();
    expect(svc.id).toBe(1);
    expect(svc.title).toBe('Logo design');
    expect(svc.deliverables).toBe('["svg","png"]');
    expect(svc.price).toBe(500000);
    expect(svc.turnaround).toBe(86400);
    expect(svc.category).toBe('image');
    expect(svc.sample_uri).toBe('ipfs://QmSample');
    expect(svc.active).toBe(1);
    expect(svc.sales).toBe(0);
    expect(svc.created_at).toBe(Math.floor(new Date('2024-01-15T12:00:00.000Z').getTime() / 1000));
  });

  it('listsvc assigns sequential synthetic IDs', () => {
    listService();
    listService({ title: 'Data cleanup', category: 'data' });

    const ids = (db.prepare('SELECT id FROM services ORDER BY id').all() as any[]).map((r) => r.id);
    expect(ids).toEqual([1, 2]);
  });

  it('listsvc skips a duplicate active listing (sync-seeded replay)', () => {
    listService();
    listService();

    const count = (db.prepare('SELECT COUNT(*) as c FROM services').get() as { c: number }).c;
    expect(count).toBe(1);
  });

  it('listsvc corrects the synthetic ID to the real on-chain ID', async () => {
    mockRpc({ services: [{ id: 42, agent: 'alice', title: 'Logo design' }] });

    listService();
    expect((db.prepare('SELECT id FROM services').get() as any).id).toBe(1);

    await flushPendingCorrections();

    const svc = db.prepare('SELECT * FROM services').get() as any;
    expect(svc.id).toBe(42);
    expect(svc.title).toBe('Logo design');
  });

  it('listsvc keeps the synthetic ID when the RPC lookup finds nothing', async () => {
    mockRpc({ services: [] });

    listService();
    await flushPendingCorrections();

    expect((db.prepare('SELECT id FROM services').get() as any).id).toBe(1);
  });

  it('updatesvc edits the listing without touching active or sales', () => {
    listService();
    db.prepare('UPDATE services SET sales = 3 WHERE id = 1').run();

    handleEscrowAction(
      db,
      createAction('agentescrow', 'updatesvc', {
        agent: 'alice',
        service_id: 1,
        title: 'Logo design (rush)',
        description: 'Now with 24h turnaround',
        deliverables: '["svg"]',
        price: 750000,
        turnaround: 43200,
        category: 'image',
        sample_uri: 'ipfs://QmSample2',
      }),
    );

    const svc = db.prepare('SELECT * FROM services WHERE id = 1').get() as any;
    expect(svc.title).toBe('Logo design (rush)');
    expect(svc.price).toBe(750000);
    expect(svc.turnaround).toBe(43200);
    expect(svc.sample_uri).toBe('ipfs://QmSample2');
    expect(svc.active).toBe(1);
    expect(svc.sales).toBe(3);
  });

  it('updatesvc from another account is a no-op', () => {
    listService();

    handleEscrowAction(
      db,
      createAction('agentescrow', 'updatesvc', {
        agent: 'mallory',
        service_id: 1,
        title: 'Hijacked',
        description: '',
        deliverables: '[]',
        price: 1,
        turnaround: 3600,
        category: '',
        sample_uri: '',
      }),
    );

    expect((db.prepare('SELECT title FROM services WHERE id = 1').get() as any).title).toBe('Logo design');
  });

  it('delistsvc and relistsvc toggle visibility and keep the row', () => {
    listService();

    handleEscrowAction(db, createAction('agentescrow', 'delistsvc', { agent: 'alice', service_id: 1 }));
    expect((db.prepare('SELECT active FROM services WHERE id = 1').get() as any).active).toBe(0);

    handleEscrowAction(db, createAction('agentescrow', 'relistsvc', { agent: 'alice', service_id: 1 }));
    expect((db.prepare('SELECT active FROM services WHERE id = 1').get() as any).active).toBe(1);

    expect((db.prepare('SELECT COUNT(*) as c FROM services').get() as { c: number }).c).toBe(1);
  });

  it('rmservice deletes the listing (admin)', () => {
    listService();

    handleEscrowAction(db, createAction('agentescrow', 'rmservice', { service_id: 1 }));

    expect(db.prepare('SELECT 1 FROM services WHERE id = 1').get()).toBeUndefined();
  });

  it('rmservice on a missing listing does not throw', () => {
    expect(() => {
      handleEscrowAction(db, createAction('agentescrow', 'rmservice', { service_id: 9999 }));
    }).not.toThrow();
  });

  it('logs service actions into the events table', () => {
    listService();
    handleEscrowAction(db, createAction('agentescrow', 'delistsvc', { agent: 'alice', service_id: 1 }));

    const names = (db.prepare('SELECT action_name FROM events ORDER BY id').all() as any[]).map(
      (e) => e.action_name,
    );
    expect(names).toContain('listsvc');
    expect(names).toContain('delistsvc');
  });

  it('keeps stats in sync with the catalogue', () => {
    listService();
    listService({ title: 'Data cleanup' });
    handleEscrowAction(db, createAction('agentescrow', 'delistsvc', { agent: 'alice', service_id: 2 }));

    const stat = (key: string) =>
      (db.prepare('SELECT value FROM stats WHERE key = ?').get(key) as { value: number }).value;
    expect(stat('total_services')).toBe(2);
    expect(stat('active_services')).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Purchase (transfer memo "buy:<id>")                                 */
/* ------------------------------------------------------------------ */

describe('Service Purchase', () => {
  beforeEach(() => {
    listService();
  });

  it('creates a funded job and increments sales', () => {
    handleEscrowTransfer(
      db,
      createTransfer('bob', 'agentescrow', '50.0000 XPR', 'buy:1'),
      'agentescrow',
    );

    const job = db.prepare('SELECT * FROM jobs WHERE client = ?').get('bob') as any;
    expect(job).toBeTruthy();
    expect(job.agent).toBe('alice');
    expect(job.title).toBe('Logo design');
    expect(job.description).toBe('A logo in 3 concepts');
    expect(job.deliverables).toBe('["svg","png"]');
    expect(job.amount).toBe(500000);
    expect(job.funded_amount).toBe(500000);
    expect(job.released_amount).toBe(0);
    expect(job.symbol).toBe('XPR');
    expect(job.state).toBe(1); // FUNDED
    expect(job.arbitrator).toBe('');
    expect(job.job_hash).toBe('svc:1');
    expect(job.deadline).toBe(job.created_at + 86400);

    expect((db.prepare('SELECT sales FROM services WHERE id = 1').get() as any).sales).toBe(1);
  });

  it('resolves the job ID from chain RPC and emits service.bought', async () => {
    mockRpc({ jobs: [{ id: 77, client: 'bob', title: 'Logo design', job_hash: 'svc:1' }] });
    const { dispatcher, events } = createSpyDispatcher(db);

    handleEscrowTransfer(
      db,
      createTransfer('bob', 'agentescrow', '50.0000 XPR', 'buy:1'),
      'agentescrow',
      dispatcher,
    );

    // Synthetic until the async correction runs
    expect((db.prepare('SELECT id FROM jobs').get() as any).id).toBe(1);

    await flushPendingCorrections();

    expect((db.prepare('SELECT id FROM jobs').get() as any).id).toBe(77);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('service.bought');
    expect(events[0].accounts).toEqual(['alice', 'bob']);
    expect(events[0].data.job_id).toBe(77);
    expect(events[0].data.service_id).toBe(1);
    expect(events[0].data.client).toBe('bob');
    expect(events[0].data.agent).toBe('alice');

    const evt = db.prepare("SELECT * FROM events WHERE action_name = 'service.bought'").get() as any;
    expect(evt).toBeTruthy();
    expect(JSON.parse(evt.data).job_id).toBe(77);
  });

  it('falls back to the synthetic job ID when RPC is unavailable', async () => {
    const { dispatcher, events } = createSpyDispatcher(db);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    handleEscrowTransfer(
      db,
      createTransfer('bob', 'agentescrow', '50.0000 XPR', 'buy:1'),
      'agentescrow',
      dispatcher,
    );
    await flushPendingCorrections();

    expect((db.prepare('SELECT id FROM jobs').get() as any).id).toBe(1);
    expect(events[0].data.job_id).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not double-count a replayed purchase transfer', () => {
    const transfer = createTransfer('bob', 'agentescrow', '50.0000 XPR', 'buy:1');
    handleEscrowTransfer(db, transfer, 'agentescrow');
    handleEscrowTransfer(db, transfer, 'agentescrow');

    expect((db.prepare('SELECT COUNT(*) as c FROM jobs').get() as { c: number }).c).toBe(1);
    expect((db.prepare('SELECT sales FROM services WHERE id = 1').get() as any).sales).toBe(1);
  });

  it('counts a second purchase of the same service by the same buyer', () => {
    handleEscrowTransfer(db, createTransfer('bob', 'agentescrow', '50.0000 XPR', 'buy:1'), 'agentescrow');
    // A purchase in a later block is a real second sale, not a replay.
    handleEscrowTransfer(
      db,
      createAction(
        'eosio.token',
        'transfer',
        { from: 'bob', to: 'agentescrow', quantity: '50.0000 XPR', memo: 'buy:1' },
        { timestamp: '2024-01-16T12:00:00.000Z', block_num: 200 },
      ),
      'agentescrow',
    );

    expect((db.prepare('SELECT COUNT(*) as c FROM jobs').get() as { c: number }).c).toBe(2);
    expect((db.prepare('SELECT sales FROM services WHERE id = 1').get() as any).sales).toBe(2);
  });

  it('ignores a purchase of an unknown service', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    handleEscrowTransfer(db, createTransfer('bob', 'agentescrow', '50.0000 XPR', 'buy:999'), 'agentescrow');

    expect((db.prepare('SELECT COUNT(*) as c FROM jobs').get() as { c: number }).c).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ignores a malformed buy memo', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    handleEscrowTransfer(db, createTransfer('bob', 'agentescrow', '50.0000 XPR', 'buy:abc'), 'agentescrow');

    expect((db.prepare('SELECT COUNT(*) as c FROM jobs').get() as { c: number }).c).toBe(0);
    warn.mockRestore();
  });

  it('still logs the transfer event', () => {
    handleEscrowTransfer(db, createTransfer('bob', 'agentescrow', '50.0000 XPR', 'buy:1'), 'agentescrow');

    const evt = db.prepare("SELECT * FROM events WHERE action_name = 'transfer'").get() as any;
    expect(evt).toBeTruthy();
    expect(JSON.parse(evt.data).memo).toBe('buy:1');
  });

  it('purchase-created jobs run the normal lifecycle actions', () => {
    handleEscrowTransfer(db, createTransfer('bob', 'agentescrow', '50.0000 XPR', 'buy:1'), 'agentescrow');
    const jobId = (db.prepare('SELECT id FROM jobs').get() as any).id;

    handleEscrowAction(db, createAction('agentescrow', 'acceptjob', { job_id: jobId, agent: 'alice' }));
    expect((db.prepare('SELECT state FROM jobs WHERE id = ?').get(jobId) as any).state).toBe(2);

    handleEscrowAction(db, createAction('agentescrow', 'startjob', { job_id: jobId }));
    expect((db.prepare('SELECT state FROM jobs WHERE id = ?').get(jobId) as any).state).toBe(3);

    handleEscrowAction(
      db,
      createAction('agentescrow', 'deliver', { job_id: jobId, evidence_uri: 'ipfs://logo' }),
    );
    expect((db.prepare('SELECT state FROM jobs WHERE id = ?').get(jobId) as any).state).toBe(4);
    expect((db.prepare('SELECT evidence_uri FROM job_evidence WHERE job_id = ?').get(jobId) as any).evidence_uri).toBe(
      'ipfs://logo',
    );

    handleEscrowAction(db, createAction('agentescrow', 'revise', { client: 'bob', job_id: jobId, notes: 'tweak' }));
    expect((db.prepare('SELECT state FROM jobs WHERE id = ?').get(jobId) as any).state).toBe(3);

    handleEscrowAction(
      db,
      createAction('agentescrow', 'deliver', { job_id: jobId, evidence_uri: 'ipfs://logo-v2' }),
    );
    handleEscrowAction(db, createAction('agentescrow', 'approve', { job_id: jobId }));

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
    expect(job.state).toBe(6); // COMPLETED
    expect(job.released_amount).toBe(500000);
  });

  it('purchase-created jobs can be disputed and arbitrated', () => {
    handleEscrowTransfer(db, createTransfer('bob', 'agentescrow', '50.0000 XPR', 'buy:1'), 'agentescrow');
    const jobId = (db.prepare('SELECT id FROM jobs').get() as any).id;

    handleEscrowAction(db, createAction('agentescrow', 'acceptjob', { job_id: jobId, agent: 'alice' }));
    handleEscrowAction(
      db,
      createAction('agentescrow', 'dispute', {
        job_id: jobId,
        raised_by: 'bob',
        reason: 'no delivery',
        evidence_uri: '',
      }),
    );

    expect((db.prepare('SELECT state FROM jobs WHERE id = ?').get(jobId) as any).state).toBe(5);
    const dispute = db.prepare('SELECT * FROM escrow_disputes WHERE job_id = ?').get(jobId) as any;
    expect(dispute.raised_by).toBe('bob');

    handleEscrowAction(
      db,
      createAction('agentescrow', 'arbitrate', {
        dispute_id: dispute.id,
        arbitrator: 'arb1',
        client_percent: 100,
        resolution_notes: 'refund',
      }),
    );
    expect((db.prepare('SELECT state FROM jobs WHERE id = ?').get(jobId) as any).state).toBe(8);
  });
});


/* ------------------------------------------------------------------ */
/*  Featured placement (transfer memo "boost:<id>")                     */
/* ------------------------------------------------------------------ */

const T0 = Math.floor(new Date('2024-01-15T12:00:00.000Z').getTime() / 1000);
const DAY = 86400;

describe('Service Boost', () => {
  beforeEach(() => {
    listService();
  });

  it('adds to boost_paid and features the listing for one day per XPR', () => {
    handleEscrowTransfer(db, createTransfer('carol', 'agentescrow', '3.0000 XPR', 'boost:1'), 'agentescrow');

    const svc = db.prepare('SELECT * FROM services WHERE id = 1').get() as any;
    expect(svc.boost_paid).toBe(30000);
    expect(svc.featured_until).toBe(T0 + 3 * DAY);
  });

  it('accumulates boost_paid and extends from the current featured_until', () => {
    handleEscrowTransfer(db, createTransfer('carol', 'agentescrow', '3.0000 XPR', 'boost:1'), 'agentescrow');
    handleEscrowTransfer(db, createTransfer('dave', 'agentescrow', '2.0000 XPR', 'boost:1'), 'agentescrow');

    const svc = db.prepare('SELECT * FROM services WHERE id = 1').get() as any;
    expect(svc.boost_paid).toBe(50000);
    expect(svc.featured_until).toBe(T0 + 5 * DAY); // extended, not reset
  });

  it('restarts from now when the previous boost has expired', () => {
    db.prepare('UPDATE services SET featured_until = ? WHERE id = 1').run(T0 - 10 * DAY);

    handleEscrowTransfer(db, createTransfer('carol', 'agentescrow', '1.0000 XPR', 'boost:1'), 'agentescrow');

    expect((db.prepare('SELECT featured_until FROM services WHERE id = 1').get() as any).featured_until).toBe(
      T0 + DAY,
    );
  });

  it('floors partial days but banks the whole payment', () => {
    handleEscrowTransfer(db, createTransfer('carol', 'agentescrow', '1.5000 XPR', 'boost:1'), 'agentescrow');

    const svc = db.prepare('SELECT * FROM services WHERE id = 1').get() as any;
    expect(svc.boost_paid).toBe(15000);
    expect(svc.featured_until).toBe(T0 + DAY);
  });

  it('takes boost_paid and featured_until from the chain row when RPC is available', async () => {
    mockRpc({ services: [{ id: 1, agent: 'alice', title: 'Logo design', boost_paid: 99999, featured_until: T0 + 9 * DAY }] });

    handleEscrowTransfer(db, createTransfer('carol', 'agentescrow', '3.0000 XPR', 'boost:1'), 'agentescrow');
    // Locally computed until the reconciliation runs
    expect((db.prepare('SELECT featured_until FROM services WHERE id = 1').get() as any).featured_until).toBe(
      T0 + 3 * DAY,
    );

    await flushPendingCorrections();

    const svc = db.prepare('SELECT * FROM services WHERE id = 1').get() as any;
    expect(svc.boost_paid).toBe(99999);
    expect(svc.featured_until).toBe(T0 + 9 * DAY);
  });

  it('keeps the computed values when the chain row cannot be read', async () => {
    mockRpc({ services: [] });

    handleEscrowTransfer(db, createTransfer('carol', 'agentescrow', '3.0000 XPR', 'boost:1'), 'agentescrow');
    await flushPendingCorrections();

    const svc = db.prepare('SELECT * FROM services WHERE id = 1').get() as any;
    expect(svc.boost_paid).toBe(30000);
    expect(svc.featured_until).toBe(T0 + 3 * DAY);
  });

  it('logs service.boosted and dispatches the webhook', () => {
    const { dispatcher, events } = createSpyDispatcher(db);

    handleEscrowTransfer(
      db,
      createTransfer('carol', 'agentescrow', '2.0000 XPR', 'boost:1'),
      'agentescrow',
      dispatcher,
    );

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('service.boosted');
    expect(events[0].accounts).toEqual(['alice', 'carol']);
    expect(events[0].data.service_id).toBe(1);
    expect(events[0].data.days).toBe(2);
    expect(events[0].data.featured_until).toBe(T0 + 2 * DAY);

    const evt = db.prepare("SELECT * FROM events WHERE action_name = 'service.boosted'").get() as any;
    expect(JSON.parse(evt.data).booster).toBe('carol');
  });

  it('ignores a boost of an unknown service and a malformed memo', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    handleEscrowTransfer(db, createTransfer('carol', 'agentescrow', '1.0000 XPR', 'boost:999'), 'agentescrow');
    handleEscrowTransfer(db, createTransfer('carol', 'agentescrow', '1.0000 XPR', 'boost:xyz'), 'agentescrow');

    const svc = db.prepare('SELECT * FROM services WHERE id = 1').get() as any;
    expect(svc.boost_paid).toBe(0);
    expect(svc.featured_until).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/*  Listing fee deposit (transfer memo "svcfee:<agent>")                */
/* ------------------------------------------------------------------ */

describe('Service Fee Deposit', () => {
  it('is a no-op for the mirror and only records an event', () => {
    listService();
    const before = db.prepare('SELECT * FROM services WHERE id = 1').get() as any;

    handleEscrowTransfer(db, createTransfer('alice', 'agentescrow', '1.0000 XPR', 'svcfee:alice'), 'agentescrow');

    expect(db.prepare('SELECT * FROM services WHERE id = 1').get()).toEqual(before);
    expect((db.prepare('SELECT COUNT(*) as c FROM jobs').get() as { c: number }).c).toBe(0);

    const evt = db.prepare("SELECT * FROM events WHERE action_name = 'service.fee_paid'").get() as any;
    expect(evt).toBeTruthy();
    const payload = JSON.parse(evt.data);
    expect(payload.agent).toBe('alice');
    expect(payload.payer).toBe('alice');
    expect(payload.amount).toBe(10000);
  });

  it('still logs the raw transfer event', () => {
    handleEscrowTransfer(db, createTransfer('alice', 'agentescrow', '1.0000 XPR', 'svcfee:alice'), 'agentescrow');

    const evt = db.prepare("SELECT * FROM events WHERE action_name = 'transfer'").get() as any;
    expect(JSON.parse(evt.data).memo).toBe('svcfee:alice');
  });
});

/* ------------------------------------------------------------------ */
/*  Catalogue queries (GET /api/services, GET /api/services/:id)        */
/* ------------------------------------------------------------------ */

describe('Services catalogue query', () => {
  /** id, sales, price, created_at, boost_paid, featuredUntil */
  function seedService(
    id: number,
    opts: { sales?: number; price?: number; created_at?: number; boost_paid?: number; featured_until?: number; category?: string; agent?: string; active?: number } = {},
  ) {
    db.prepare(`
      INSERT INTO services (id, agent, title, description, deliverables, price, turnaround, category, sample_uri, active, sales, boost_paid, featured_until, created_at, updated_at)
      VALUES (?, ?, ?, '', '[]', ?, 3600, ?, '', ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      opts.agent ?? 'alice',
      `Service ${id}`,
      opts.price ?? 100000,
      opts.category ?? 'image',
      opts.active ?? 1,
      opts.sales ?? 0,
      opts.boost_paid ?? 0,
      opts.featured_until ?? 0,
      opts.created_at ?? id,
      opts.created_at ?? id,
    );
  }

  beforeEach(() => {
    db.prepare('UPDATE agents SET trust_score = 63 WHERE account = ?').run('alice');
    db.prepare(
      'INSERT INTO agent_scores (agent, total_score, total_weight, feedback_count, avg_score, last_updated) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('alice', 40, 45, 9, 8900, 0);
    db.prepare(
      "INSERT INTO jobs (id, client, agent, title, amount, state, job_hash, created_at, updated_at) VALUES (900, 'bob', 'alice', 'done', 1, 6, '', 0, 0)",
    ).run();
  });

  it('joins the seller trust signals onto each listing', () => {
    seedService(1, { sales: 2 });
    seedService(2, { sales: 5 });

    const { services, total, limit, offset } = queryServices(db, { now: T0 });

    expect(total).toBe(2);
    expect(limit).toBe(24);
    expect(offset).toBe(0);
    expect(services.map((s: any) => s.id)).toEqual([2, 1]); // sales DESC by default
    expect(services[0]).toMatchObject({
      trust_score: 63,
      avg_score: 8900,
      feedback_count: 9,
      completed_jobs: 1,
      featured: 0,
      price: 100000, // raw units, unformatted
      boost_paid: 0,
      featured_until: 0,
    });
    // Ranking scaffolding is not exposed
    expect(services[0]).not.toHaveProperty('featured_rank');
    expect(services[0]).not.toHaveProperty('s_sales');
  });

  it('filters by category, agent and active', () => {
    seedService(1, { category: 'image' });
    seedService(2, { category: 'data' });
    seedService(3, { active: 0 });

    expect(queryServices(db, { now: T0, category: 'data' }).services.map((s: any) => s.id)).toEqual([2]);
    expect(queryServices(db, { now: T0, agent: 'nobody' }).services.length).toBe(0);
    // Default sort: sales DESC then newest first
    expect(queryServices(db, { now: T0 }).services.map((s: any) => s.id)).toEqual([2, 1]);
    expect(queryServices(db, { now: T0, active: 'false' }).services.map((s: any) => s.id).sort()).toEqual([1, 2, 3]);
    expect(queryServices(db, { now: T0, active: 'all' }).total).toBe(3);
  });

  it('puts at most 3 running boosts first, ordered by boost_paid', () => {
    // Five boosted listings; boost_paid ascending with the id
    for (let id = 1; id <= 5; id++) {
      seedService(id, { boost_paid: id * 10000, featured_until: T0 + DAY, sales: 0, created_at: id });
    }
    // An organic listing that would otherwise lead on sales
    seedService(6, { sales: 99, created_at: 6 });

    const ids = queryServices(db, { now: T0 }).services.map((s: any) => s.id);

    expect(ids.slice(0, 3)).toEqual([5, 4, 3]); // top 3 by boost_paid DESC
    expect(ids[3]).toBe(6); // organic order resumes (highest sales)
    expect(ids.slice(4).sort()).toEqual([1, 2]); // the other boosted rows fall to the tail
  });

  it('marks every running boost featured, including those past the top 3', () => {
    for (let id = 1; id <= 4; id++) {
      seedService(id, { boost_paid: id * 10000, featured_until: T0 + DAY });
    }
    seedService(5);

    const rows = queryServices(db, { now: T0 }).services as any[];
    const featured = rows.filter((r) => r.featured === 1).map((r) => r.id).sort();

    expect(featured).toEqual([1, 2, 3, 4]);
    expect(rows.find((r) => r.id === 5).featured).toBe(0);
  });

  it('drops an expired boost back into the organic order', () => {
    seedService(1, { boost_paid: 50000, featured_until: T0 - DAY, sales: 0 });
    seedService(2, { sales: 7 });

    const { services } = queryServices(db, { now: T0 });

    expect(services.map((s: any) => s.id)).toEqual([2, 1]);
    expect((services[1] as any).featured).toBe(0);
  });

  it('applies ?sort to the organic tail while the featured slots stay put', () => {
    seedService(1, { boost_paid: 10000, featured_until: T0 + DAY, price: 900000, created_at: 1 });
    seedService(2, { price: 300000, sales: 1, created_at: 2 });
    seedService(3, { price: 100000, sales: 5, created_at: 3 });

    expect(queryServices(db, { now: T0, sort: 'price' }).services.map((s: any) => s.id)).toEqual([1, 3, 2]);
    expect(queryServices(db, { now: T0, sort: 'newest' }).services.map((s: any) => s.id)).toEqual([1, 3, 2]);
    expect(queryServices(db, { now: T0, sort: 'sales' }).services.map((s: any) => s.id)).toEqual([1, 3, 2]);
    // Unknown sort falls back to sales
    expect(queryServices(db, { now: T0, sort: 'bogus' }).services.map((s: any) => s.id)).toEqual([1, 3, 2]);
  });

  it('keeps the ranking stable across pages', () => {
    for (let id = 1; id <= 5; id++) {
      seedService(id, { boost_paid: id * 10000, featured_until: T0 + DAY, created_at: id });
    }

    const page1 = queryServices(db, { now: T0, limit: 2 }).services.map((s: any) => s.id);
    const page2 = queryServices(db, { now: T0, limit: 2, offset: 2 }).services.map((s: any) => s.id);

    expect(page1).toEqual([5, 4]);
    expect(page2[0]).toBe(3);
  });

  it('caps the page size at 200', () => {
    seedService(1);

    expect(queryServices(db, { now: T0, limit: 9999 }).limit).toBe(MAX_LIMIT);
    expect(MAX_LIMIT).toBe(200);
    expect(queryServices(db, { now: T0, limit: 200 }).limit).toBe(200);
  });

  it('returns a single listing with its featured flag', () => {
    seedService(1, { boost_paid: 20000, featured_until: T0 + DAY });
    seedService(2, { boost_paid: 20000, featured_until: T0 - DAY, active: 0 });

    const live = queryService(db, 1, T0) as any;
    expect(live.id).toBe(1);
    expect(live.featured).toBe(1);
    expect(live.boost_paid).toBe(20000);
    expect(live.trust_score).toBe(63);

    // Delisted / expired rows are still readable, just not featured
    const stale = queryService(db, 2, T0) as any;
    expect(stale.featured).toBe(0);

    expect(queryService(db, 9999, T0)).toBeUndefined();
  });
});

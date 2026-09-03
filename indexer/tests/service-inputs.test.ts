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
import { queryService, queryServices } from '../src/api/services-query';
import { queryJobMessages } from '../src/api/job-messages-query';
import { StreamAction } from '../src/stream';
import { WebhookDispatcher } from '../src/webhooks/dispatcher';

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
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
      authorization: [{ actor: data.agent || data.client || data.account || 'test', permission: 'active' }],
      data,
    },
    ...overrides,
  };
}

function createSpyDispatcher(db: Database.Database) {
  const events: Array<{ type: string; accounts: string[]; data: any; message: string }> = [];
  const dispatcher = new WebhookDispatcher(db);
  dispatcher.dispatch = (eventType, accounts, data, message, _blockNum) => {
    events.push({ type: eventType, accounts, data, message });
  };
  return { dispatcher, events };
}

function mockRpc(rowsByTable: Record<string, any[]>) {
  const fetchSpy = vi.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    return { json: async () => ({ rows: rowsByTable[body.table] || [] }) } as any;
  });
  vi.stubGlobal('fetch', fetchSpy);
  setRpcEndpoint('http://rpc.test');
  return fetchSpy;
}

const SCHEMA = '{"v":1,"fields":[{"key":"account","label":"XPR account","type":"account","required":true}]}';

const LIST_SVC = {
  agent: 'alice',
  title: 'On-chain digest',
  description: 'A weekly digest',
  deliverables: '["md"]',
  price: 500000,
  turnaround: 86400,
  category: 'research',
  sample_uri: '',
};

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(':memory:');
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
  handleEscrowAction(db, createAction('agentescrow', 'listsvc', LIST_SVC));
  pendingCorrections.length = 0;
});

afterEach(() => {
  pendingCorrections.length = 0;
  setRpcEndpoint('');
  vi.unstubAllGlobals();
});

function setInput(schema: string, serviceId = 1) {
  handleEscrowAction(
    db,
    createAction('agentescrow', 'setsvcinput', { agent: 'alice', service_id: serviceId, schema }),
  );
}

/* ------------------------------------------------------------------ */
/*  setsvcinput mirror                                                  */
/* ------------------------------------------------------------------ */

describe('Service input schema handler', () => {
  it('setsvcinput stores the schema for the listing', () => {
    setInput(SCHEMA);

    const row = db.prepare('SELECT * FROM service_inputs WHERE service_id = 1').get() as any;
    expect(row.schema).toBe(SCHEMA);
    expect(row.updated_at).toBe(Math.floor(new Date('2024-01-15T12:00:00.000Z').getTime() / 1000));
  });

  it('setsvcinput replaces an existing schema', () => {
    setInput(SCHEMA);
    setInput('{"v":1,"fields":[]}');

    const rows = db.prepare('SELECT * FROM service_inputs').all() as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].schema).toBe('{"v":1,"fields":[]}');
  });

  it('an empty schema removes the row', () => {
    setInput(SCHEMA);
    setInput('');

    expect(db.prepare('SELECT 1 FROM service_inputs WHERE service_id = 1').get()).toBeUndefined();
  });

  it('ignores a setsvcinput with a bad service id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    handleEscrowAction(db, createAction('agentescrow', 'setsvcinput', { agent: 'alice', service_id: 'x', schema: SCHEMA }));

    expect((db.prepare('SELECT COUNT(*) as c FROM service_inputs').get() as any).c).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rmservice clears the listing form', () => {
    setInput(SCHEMA);

    handleEscrowAction(db, createAction('agentescrow', 'rmservice', { service_id: 1 }));

    expect(db.prepare('SELECT 1 FROM service_inputs WHERE service_id = 1').get()).toBeUndefined();
  });

  it('delisting a service keeps its form', () => {
    setInput(SCHEMA);

    handleEscrowAction(db, createAction('agentescrow', 'delistsvc', { agent: 'alice', service_id: 1 }));

    expect((db.prepare('SELECT schema FROM service_inputs WHERE service_id = 1').get() as any).schema).toBe(SCHEMA);
  });

  it('logs the action into the events table', () => {
    setInput(SCHEMA);

    const names = (db.prepare('SELECT action_name FROM events').all() as any[]).map((e) => e.action_name);
    expect(names).toContain('setsvcinput');
  });
});

/* ------------------------------------------------------------------ */
/*  input_schema on the catalogue queries                               */
/* ------------------------------------------------------------------ */

describe('input_schema in the services API', () => {
  it('is null for a listing without a form', () => {
    expect(queryService(db, 1)!.input_schema).toBeNull();
    expect(queryServices(db).services[0].input_schema).toBeNull();
  });

  it('is the schema string once declared', () => {
    setInput(SCHEMA);

    expect(queryService(db, 1)!.input_schema).toBe(SCHEMA);
    expect(queryServices(db).services[0].input_schema).toBe(SCHEMA);
  });

  it('leaves every other field of the row untouched', () => {
    setInput(SCHEMA);

    const svc = queryService(db, 1)! as any;
    expect(svc.id).toBe(1);
    expect(svc.title).toBe('On-chain digest');
    expect(svc.price).toBe(500000);
    expect(svc.featured_slot).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  svcinput — the buyer's answers as the first job message             */
/* ------------------------------------------------------------------ */

describe('svcinput handler', () => {
  const ANSWERS = '{"account":"paul123"}';

  /** Purchase transfer + svcinput, as the site sends them in one transaction. */
  function buyThenInput(dispatcher?: WebhookDispatcher, client = 'bob') {
    handleEscrowTransfer(
      db,
      createAction('eosio.token', 'transfer', {
        from: client,
        to: 'agentescrow',
        quantity: '50.0000 XPR',
        memo: 'buy:1',
      }),
      'agentescrow',
      dispatcher,
    );
    handleEscrowAction(
      db,
      createAction('agentescrow', 'svcinput', { client, text: ANSWERS }),
      dispatcher,
    );
  }

  it('attaches the answers to the job the buyer just funded', () => {
    buyThenInput();

    const msg = db.prepare('SELECT * FROM job_messages').get() as any;
    expect(msg.job_id).toBe(1);
    expect(msg.author).toBe('bob');
    expect(msg.text).toBe(ANSWERS);
    expect(queryJobMessages(db, 1).length).toBe(1);
  });

  it('picks the newest service purchase when the buyer has several', () => {
    handleEscrowTransfer(
      db,
      createAction('eosio.token', 'transfer', { from: 'bob', to: 'agentescrow', quantity: '50.0000 XPR', memo: 'buy:1' }),
      'agentescrow',
    );
    handleEscrowTransfer(
      db,
      createAction(
        'eosio.token',
        'transfer',
        { from: 'bob', to: 'agentescrow', quantity: '50.0000 XPR', memo: 'buy:1' },
        { timestamp: '2024-02-01T12:00:00.000Z', block_num: 300 },
      ),
      'agentescrow',
    );
    handleEscrowAction(db, createAction('agentescrow', 'svcinput', { client: 'bob', text: ANSWERS }));

    expect((db.prepare('SELECT job_id FROM job_messages').get() as any).job_id).toBe(2);
  });

  it('prefers the job id from the chain lastbuys row', async () => {
    // Purchase mirrored locally as job 1; the chain says the buy landed on job 88.
    mockRpc({
      lastbuys: [{ client: 'bob', job_id: 88, service_id: 1, created_at: 1 }],
      jobmsgs: [],
      jobs: [],
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    buyThenInput();
    await flushPendingCorrections();

    expect((db.prepare('SELECT job_id FROM job_messages').get() as any).job_id).toBe(88);
    warn.mockRestore();
  });

  it('keeps the mirrored job id when lastbuys is already consumed', async () => {
    mockRpc({ lastbuys: [], jobmsgs: [], jobs: [] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    buyThenInput();
    await flushPendingCorrections();

    expect((db.prepare('SELECT job_id FROM job_messages').get() as any).job_id).toBe(1);
    warn.mockRestore();
  });

  it('emits job.answer to the agent, like a client answer', async () => {
    const { dispatcher, events } = createSpyDispatcher(db);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    buyThenInput(dispatcher);
    await flushPendingCorrections();

    const answer = events.find((e) => e.type === 'job.answer')!;
    expect(answer).toBeTruthy();
    expect(answer.accounts).toEqual(['alice']);
    expect(answer.data).toMatchObject({ job_id: 1, author: 'bob', text: ANSWERS });

    const evt = db.prepare("SELECT * FROM events WHERE action_name = 'job.answer'").get() as any;
    expect(JSON.parse(evt.data)).toMatchObject({ job_id: 1, author: 'bob', text: ANSWERS });
    warn.mockRestore();
  });

  it('logs the chain action so the per-job timeline picks it up', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    buyThenInput();
    await flushPendingCorrections();

    const names = (db.prepare('SELECT action_name FROM events ORDER BY id').all() as any[]).map((e) => e.action_name);
    expect(names).toContain('svcinput');
    warn.mockRestore();
  });

  it('corrects the message id from the chain', async () => {
    mockRpc({
      lastbuys: [],
      jobmsgs: [{ id: 31, job_id: 1, author: 'bob', text: ANSWERS }],
      jobs: [],
    });

    buyThenInput();
    await flushPendingCorrections();

    expect((db.prepare('SELECT id FROM job_messages').get() as any).id).toBe(31);
  });

  it('does not insert a replayed svcinput twice', () => {
    handleEscrowTransfer(
      db,
      createAction('eosio.token', 'transfer', { from: 'bob', to: 'agentescrow', quantity: '50.0000 XPR', memo: 'buy:1' }),
      'agentescrow',
    );
    const action = createAction('agentescrow', 'svcinput', { client: 'bob', text: ANSWERS });
    handleEscrowAction(db, action);
    handleEscrowAction(db, action);

    expect((db.prepare('SELECT COUNT(*) as c FROM job_messages').get() as any).c).toBe(1);
  });

  it('warns and records nothing useful when the buyer has no purchase yet', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    handleEscrowAction(db, createAction('agentescrow', 'svcinput', { client: 'nobody', text: ANSWERS }));

    expect(warn).toHaveBeenCalled();
    const msg = db.prepare('SELECT * FROM job_messages').get() as any;
    expect(msg.job_id).toBe(0); // unattached until a chain lookup can place it
    warn.mockRestore();
  });

  it('ignores a svcinput with no client', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    handleEscrowAction(db, createAction('agentescrow', 'svcinput', { text: ANSWERS }));

    expect((db.prepare('SELECT COUNT(*) as c FROM job_messages').get() as any).c).toBe(0);
    warn.mockRestore();
  });

  it('follows the purchase job when its own id is corrected first', async () => {
    mockRpc({
      jobs: [{ id: 70, client: 'bob', job_hash: 'svc:1', title: 'On-chain digest' }],
      lastbuys: [],
      jobmsgs: [],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    buyThenInput();
    await flushPendingCorrections();

    expect((db.prepare('SELECT id FROM jobs').get() as any).id).toBe(70);
    expect((db.prepare('SELECT job_id FROM job_messages').get() as any).job_id).toBe(70);
    warn.mockRestore();
  });
});

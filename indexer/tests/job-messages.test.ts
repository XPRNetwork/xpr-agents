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
import { jobExists, jobMessageCount, queryJobMessages } from '../src/api/job-messages-query';
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
      authorization: [{ actor: data.agent || data.client || data.account || 'test', permission: 'active' }],
      data,
    },
    ...overrides,
  };
}

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

/** Stub the chain RPC used by the async ID-correction step, keyed by table. */
function mockRpc(rowsByTable: Record<string, any[]>) {
  const fetchSpy = vi.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    return { json: async () => ({ rows: rowsByTable[body.table] || [] }) } as any;
  });
  vi.stubGlobal('fetch', fetchSpy);
  setRpcEndpoint('http://rpc.test');
  return fetchSpy;
}

const QUESTION = 'Which brand colours should I use?';
const ANSWER = 'Navy and white, logo attached.';

let db: Database.Database;

/** Direct-hire job #1: client bob, agent alice, state FUNDED. */
function createJob(overrides: Record<string, any> = {}) {
  handleEscrowAction(
    db,
    createAction('agentescrow', 'createjob', {
      client: 'bob',
      agent: 'alice',
      title: 'Logo design',
      description: 'A logo in 3 concepts',
      deliverables: '["svg"]',
      amount: 500000,
      deadline: 1800000000,
      arbitrator: '',
      job_hash: '',
      ...overrides,
    }),
  );
  db.prepare('UPDATE jobs SET state = 1, funded_amount = amount').run();
  pendingCorrections.length = 0; // drop the createjob correction (no RPC in setup)
}

function ask(text = QUESTION, jobId = 1, dispatcher?: WebhookDispatcher) {
  handleEscrowAction(
    db,
    createAction('agentescrow', 'askclient', { agent: 'alice', job_id: jobId, text }),
    dispatcher,
  );
}

function answer(text = ANSWER, jobId = 1, dispatcher?: WebhookDispatcher) {
  handleEscrowAction(
    db,
    createAction('agentescrow', 'answer', { client: 'bob', job_id: jobId, text }),
    dispatcher,
  );
}

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
  createJob();
});

afterEach(() => {
  pendingCorrections.length = 0;
  setRpcEndpoint('');
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/*  Handlers                                                            */
/* ------------------------------------------------------------------ */

describe('Job message handlers', () => {
  it('askclient inserts a message authored by the agent', () => {
    ask();

    const msg = db.prepare('SELECT * FROM job_messages').get() as any;
    expect(msg.id).toBe(1);
    expect(msg.job_id).toBe(1);
    expect(msg.author).toBe('alice');
    expect(msg.text).toBe(QUESTION);
    expect(msg.created_at).toBe(Math.floor(new Date('2024-01-15T12:00:00.000Z').getTime() / 1000));
  });

  it('answer inserts a message authored by the client', () => {
    answer();

    const msg = db.prepare('SELECT * FROM job_messages').get() as any;
    expect(msg.author).toBe('bob');
    expect(msg.text).toBe(ANSWER);
  });

  it('keeps the thread in insertion order', () => {
    ask();
    answer();
    ask('One more thing — deadline is fine?');

    const rows = queryJobMessages(db, 1);
    expect(rows.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(rows.map((m) => m.author)).toEqual(['alice', 'bob', 'alice']);
  });

  it('keeps threads of different jobs apart', () => {
    createJob({ title: 'Second job', job_hash: 'x' });
    ask(QUESTION, 1);
    ask('Different job question', 2);

    expect(queryJobMessages(db, 1).map((m) => m.text)).toEqual([QUESTION]);
    expect(queryJobMessages(db, 2).map((m) => m.text)).toEqual(['Different job question']);
  });

  it('does not insert a replayed action twice', () => {
    const action = createAction('agentescrow', 'askclient', { agent: 'alice', job_id: 1, text: QUESTION });
    handleEscrowAction(db, action);
    handleEscrowAction(db, action);

    expect((db.prepare('SELECT COUNT(*) as c FROM job_messages').get() as { c: number }).c).toBe(1);
  });

  it('ignores a malformed message action', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    handleEscrowAction(db, createAction('agentescrow', 'askclient', { agent: 'alice', job_id: 'nope', text: 'x' }));

    expect((db.prepare('SELECT COUNT(*) as c FROM job_messages').get() as { c: number }).c).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('records a message on a job the mirror has not seen', () => {
    ask(QUESTION, 4242);

    const msg = db.prepare('SELECT * FROM job_messages WHERE job_id = 4242').get() as any;
    expect(msg.text).toBe(QUESTION);
  });
});

/* ------------------------------------------------------------------ */
/*  ID correction                                                       */
/* ------------------------------------------------------------------ */

describe('Job message ID correction', () => {
  it('replaces the synthetic ID with the real chain ID', async () => {
    mockRpc({ jobmsgs: [{ id: 55, job_id: 1, author: 'alice', text: QUESTION }] });

    ask();
    expect((db.prepare('SELECT id FROM job_messages').get() as any).id).toBe(1);

    await flushPendingCorrections();

    expect((db.prepare('SELECT id FROM job_messages').get() as any).id).toBe(55);
  });

  it('displaces an occupier and re-corrects it', async () => {
    mockRpc({
      jobmsgs: [
        { id: 9, job_id: 1, author: 'bob', text: ANSWER },
        { id: 8, job_id: 1, author: 'alice', text: QUESTION },
      ],
    });

    // Both rows land on synthetic IDs 1 and 2 first.
    ask();
    answer();
    await flushPendingCorrections();

    const rows = db.prepare('SELECT id, author FROM job_messages ORDER BY id').all() as any[];
    expect(rows.map((r) => r.id)).toEqual([8, 9]);
    expect(rows.map((r) => r.author)).toEqual(['alice', 'bob']);
  });

  it('keeps the synthetic ID when RPC is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { dispatcher, events } = createSpyDispatcher(db);

    ask(QUESTION, 1, dispatcher);
    await flushPendingCorrections();

    expect((db.prepare('SELECT id FROM job_messages').get() as any).id).toBe(1);
    expect(events[0].data.message_id).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps the synthetic ID when the row is not on chain yet', async () => {
    mockRpc({ jobmsgs: [{ id: 3, job_id: 99, author: 'someone', text: 'unrelated' }] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    ask();
    await flushPendingCorrections();

    expect((db.prepare('SELECT id FROM job_messages').get() as any).id).toBe(1);
    warn.mockRestore();
  });

  it('follows the job when the job ID itself is corrected', async () => {
    mockRpc({ jobs: [{ id: 70, client: 'carol', title: 'Second job', job_hash: 'h2' }] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Second job takes synthetic ID 2; its real chain ID is 70.
    handleEscrowAction(
      db,
      createAction('agentescrow', 'createjob', {
        client: 'carol',
        agent: 'alice',
        title: 'Second job',
        description: '',
        deliverables: '[]',
        amount: 1,
        deadline: 0,
        arbitrator: '',
        job_hash: 'h2',
      }),
    );
    ask(QUESTION, 2);
    expect((db.prepare('SELECT job_id FROM job_messages').get() as any).job_id).toBe(2);

    await flushPendingCorrections();

    expect((db.prepare("SELECT id FROM jobs WHERE title = 'Second job'").get() as any).id).toBe(70);
    expect((db.prepare('SELECT job_id FROM job_messages').get() as any).job_id).toBe(70);
    warn.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/*  Events and webhooks                                                 */
/* ------------------------------------------------------------------ */

describe('Job message events and webhooks', () => {
  it('logs the chain actions into the events table with the job id', () => {
    ask();
    answer();

    const names = (db.prepare('SELECT action_name FROM events ORDER BY id').all() as any[]).map(
      (e) => e.action_name,
    );
    expect(names).toContain('askclient');
    expect(names).toContain('answer');

    // Same predicate the /api/events?job_id= filter uses
    const perJob = db
      .prepare("SELECT action_name FROM events WHERE CAST(json_extract(data, '$.job_id') AS TEXT) = ? ORDER BY id ASC")
      .all('1') as any[];
    expect(perJob.map((e) => e.action_name)).toEqual(['askclient', 'answer']);
  });

  it('logs derived job.question / job.answer events', async () => {
    mockRpc({ jobmsgs: [{ id: 12, job_id: 1, author: 'alice', text: QUESTION }] });

    ask();
    await flushPendingCorrections();

    const evt = db.prepare("SELECT * FROM events WHERE action_name = 'job.question'").get() as any;
    expect(evt).toBeTruthy();
    expect(evt.contract).toBe('agentescrow');
    const data = JSON.parse(evt.data);
    expect(data).toMatchObject({ job_id: 1, message_id: 12, author: 'alice', text: QUESTION });
  });

  it('dispatches job.question to the client', async () => {
    const { dispatcher, events } = createSpyDispatcher(db);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    ask(QUESTION, 1, dispatcher);
    await flushPendingCorrections();

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('job.question');
    expect(events[0].accounts).toEqual(['bob']); // the client answers
    expect(events[0].data.author).toBe('alice');
    expect(events[0].data.text).toBe(QUESTION);
    warn.mockRestore();
  });

  it('dispatches job.answer to the agent', async () => {
    const { dispatcher, events } = createSpyDispatcher(db);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    answer(ANSWER, 1, dispatcher);
    await flushPendingCorrections();

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('job.answer');
    expect(events[0].accounts).toEqual(['alice']); // the agent acts on it
    expect(events[0].data.author).toBe('bob');
    warn.mockRestore();
  });

  it('dispatches with no recipient when the job is unknown', async () => {
    const { dispatcher, events } = createSpyDispatcher(db);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    ask(QUESTION, 4242, dispatcher);
    await flushPendingCorrections();

    expect(events[0].accounts).toEqual([]);
    warn.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/*  Buyer notes on the purchase memo                                    */
/* ------------------------------------------------------------------ */

describe('Buyer notes in the buy memo', () => {
  const LIST_SVC = {
    agent: 'alice',
    title: 'Logo design',
    description: 'A logo in 3 concepts',
    deliverables: '["svg","png"]',
    price: 500000,
    turnaround: 86400,
    category: 'image',
    sample_uri: '',
  };

  beforeEach(() => {
    handleEscrowAction(db, createAction('agentescrow', 'listsvc', LIST_SVC));
    pendingCorrections.length = 0;
  });

  function buy(memo: string) {
    handleEscrowTransfer(
      db,
      createAction(
        'eosio.token',
        'transfer',
        { from: 'bob', to: 'agentescrow', quantity: '50.0000 XPR', memo },
        { timestamp: '2024-02-01T12:00:00.000Z', block_num: 300 },
      ),
      'agentescrow',
    );
    return db.prepare("SELECT * FROM jobs WHERE job_hash = 'svc:1' ORDER BY id DESC").get() as any;
  }

  it('appends the notes to the job description', () => {
    const job = buy('buy:1:Make it navy blue, no gradients');

    expect(job.description).toBe('A logo in 3 concepts\n\nBuyer notes: Make it navy blue, no gradients');
    expect(job.job_hash).toBe('svc:1');
    expect(job.amount).toBe(500000);
    // The listing itself is untouched
    expect((db.prepare('SELECT description FROM services WHERE id = 1').get() as any).description).toBe(
      'A logo in 3 concepts',
    );
  });

  it('keeps notes containing further colons intact', () => {
    const job = buy('buy:1:Ref: https://example.com/brand — palette: navy');

    expect(job.description).toBe(
      'A logo in 3 concepts\n\nBuyer notes: Ref: https://example.com/brand — palette: navy',
    );
  });

  it('leaves a plain buy memo unchanged', () => {
    const job = buy('buy:1');

    expect(job.description).toBe('A logo in 3 concepts');
  });

  it('treats an empty note suffix as no notes', () => {
    const job = buy('buy:1:');

    expect(job.description).toBe('A logo in 3 concepts');
  });

  it('parses the service ID from the digits before the notes', () => {
    handleEscrowAction(db, createAction('agentescrow', 'listsvc', { ...LIST_SVC, title: 'Second listing' }));
    pendingCorrections.length = 0;

    handleEscrowTransfer(
      db,
      createTransfer('bob', 'agentescrow', '50.0000 XPR', 'buy:2:second one please'),
      'agentescrow',
    );

    const job = db.prepare("SELECT * FROM jobs WHERE job_hash = 'svc:2'").get() as any;
    expect(job).toBeTruthy();
    expect(job.title).toBe('Second listing');
    expect(job.description).toBe('A logo in 3 concepts\n\nBuyer notes: second one please');
  });

  it('ignores a memo whose ID part is not numeric', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    handleEscrowTransfer(db, createTransfer('bob', 'agentescrow', '50.0000 XPR', 'buy:1x:notes'), 'agentescrow');

    expect((db.prepare("SELECT COUNT(*) as c FROM jobs WHERE job_hash = 'svc:1'").get() as { c: number }).c).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/*  Cleanup cascades                                                    */
/* ------------------------------------------------------------------ */

describe('Job message cleanup', () => {
  it('removejob deletes the job thread', () => {
    ask();
    answer();
    createJob({ title: 'Other job', job_hash: 'other' });
    ask('Other thread', 2);

    handleEscrowAction(db, createAction('agentescrow', 'removejob', { job_id: 1 }));

    expect(queryJobMessages(db, 1)).toEqual([]);
    expect(queryJobMessages(db, 2).length).toBe(1);
  });

  it('cleanjobs deletes threads of the jobs it archives', () => {
    ask();
    answer();

    // Terminal + old enough to be swept
    db.prepare('UPDATE jobs SET state = 6, updated_at = ? WHERE id = 1').run(1000);

    handleEscrowAction(
      db,
      createAction('agentescrow', 'cleanjobs', { max_age: 7776000, max_delete: 100 }),
    );

    expect((db.prepare('SELECT archived FROM jobs WHERE id = 1').get() as any).archived).toBe(1);
    expect(queryJobMessages(db, 1)).toEqual([]);
  });

  it('cleanjobs leaves threads of live jobs alone', () => {
    ask();

    handleEscrowAction(
      db,
      createAction('agentescrow', 'cleanjobs', { max_age: 7776000, max_delete: 100 }),
    );

    expect(queryJobMessages(db, 1).length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  API query helpers                                                   */
/* ------------------------------------------------------------------ */

describe('Job messages query helpers', () => {
  it('queryJobMessages returns the thread oldest first', () => {
    ask();
    answer();

    // Out-of-order IDs must still come back sorted
    db.prepare('UPDATE job_messages SET id = 30 WHERE id = 1').run();

    const rows = queryJobMessages(db, 1);
    expect(rows.map((m) => m.id)).toEqual([2, 30]);
    expect(rows[0].author).toBe('bob');
    expect(Object.keys(rows[0]).sort()).toEqual(['author', 'created_at', 'id', 'job_id', 'text']);
  });

  it('queryJobMessages returns an empty thread for a job with no messages', () => {
    expect(queryJobMessages(db, 1)).toEqual([]);
  });

  it('jobMessageCount counts only that job', () => {
    ask();
    answer();
    createJob({ title: 'Other job', job_hash: 'other' });
    ask('Other thread', 2);

    expect(jobMessageCount(db, 1)).toBe(2);
    expect(jobMessageCount(db, 2)).toBe(1);
    expect(jobMessageCount(db, 3)).toBe(0);
  });

  it('jobExists distinguishes a missing job (the 404 case)', () => {
    expect(jobExists(db, 1)).toBe(true);
    expect(jobExists(db, 999)).toBe(false);
  });
});

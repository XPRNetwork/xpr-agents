import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import type { Server } from 'http';
import { initDatabase } from '../src/db/schema';
import { createRoutes } from '../src/api/routes';
import { queryServices } from '../src/api/services-query';
import { queryJobMessages, jobMessageCount, jobExists } from '../src/api/job-messages-query';
import {
  JOBS_SPEC,
  SERVICES_SPEC,
  JOB_MESSAGES_SPEC,
  pruneStaleTempRows,
  resolveDisplacedRow,
  safeCorrect,
} from '../src/handlers/id-correction';

/**
 * Regression cover for the mainnet phantom row: job id -62504464 (client
 * paul123) was a displaced temp row from safeCorrect whose re-correction never
 * completed, while the real job sat at its correct id. It surfaced in
 * GET /api/jobs/open.
 */

const NOW = Math.floor(Date.now() / 1000);
const OLD = NOW - 3600; // an hour ago: past the 10-minute sweep cutoff

let db: Database.Database;
let logSpy: ReturnType<typeof vi.spyOn>;

function insertJob(id: number, over: Record<string, any> = {}) {
  const j = {
    client: 'paul123',
    agent: '',
    title: 'XPR Network weekly on-chain digest',
    description: '',
    deliverables: '[]',
    amount: 0,
    state: 0,
    created_at: OLD,
    updated_at: OLD,
    job_hash: '',
    ...over,
  };
  db.prepare(`
    INSERT INTO jobs (id, client, agent, title, description, deliverables, amount, symbol, funded_amount, released_amount, state, deadline, arbitrator, job_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'XPR', 0, 0, ?, 0, '', ?, ?, ?)
  `).run(id, j.client, j.agent, j.title, j.description, j.deliverables, j.amount, j.state, j.job_hash, j.created_at, j.updated_at);
}

beforeEach(() => {
  db = initDatabase(':memory:');
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

/* ------------------------------------------------------------------ */
/*  Stale temp-row sweep                                                */
/* ------------------------------------------------------------------ */

describe('pruneStaleTempRows', () => {
  it('removes an old negative-id job and keeps the real one', () => {
    insertJob(-62504464);
    insertJob(61);

    const sweep = pruneStaleTempRows(db);

    expect(sweep.total).toBe(1);
    expect(sweep.deleted.jobs).toBe(1);
    expect(db.prepare('SELECT id FROM jobs').all()).toEqual([{ id: 61 }]);
  });

  it('logs a line per removal', () => {
    insertJob(-62504464);

    pruneStaleTempRows(db);

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('Swept stale temp row jobs id=-62504464'))).toBe(true);
  });

  it('leaves a freshly displaced row alone (a correction may still be in flight)', () => {
    insertJob(-999, { created_at: NOW, updated_at: NOW });

    const sweep = pruneStaleTempRows(db);

    expect(sweep.total).toBe(0);
    expect(db.prepare('SELECT COUNT(*) as c FROM jobs').get()).toEqual({ c: 1 });
  });

  it('honours a custom max age', () => {
    insertJob(-999, { created_at: NOW - 30, updated_at: NOW - 30 });

    expect(pruneStaleTempRows(db, 600).total).toBe(0);
    expect(pruneStaleTempRows(db, 10).total).toBe(1);
  });

  it('cascades to rows referencing the swept job', () => {
    insertJob(-5);
    db.prepare("INSERT INTO bids (id, job_id, agent, amount, timeline, proposal, created_at) VALUES (7, -5, 'alice', 1, 0, '', ?)").run(OLD);
    db.prepare("INSERT INTO milestones (id, job_id, title, amount, milestone_order, state) VALUES (3, -5, 'M1', 1, 0, 0)").run();
    db.prepare("INSERT INTO job_messages (id, job_id, author, text, created_at) VALUES (2, -5, 'bob', 'hi', ?)").run(OLD);
    db.prepare("INSERT INTO job_evidence (job_id, evidence_uri) VALUES (-5, 'ipfs://x')").run();

    pruneStaleTempRows(db);

    expect(db.prepare('SELECT COUNT(*) as c FROM jobs').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) as c FROM bids').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) as c FROM milestones').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) as c FROM job_messages').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) as c FROM job_evidence').get()).toEqual({ c: 0 });
  });

  it('sweeps every corrected table and counts them separately', () => {
    insertJob(1);
    insertJob(-1, { title: 'Ghost' });
    db.prepare("INSERT INTO bids (id, job_id, agent, amount, timeline, proposal, created_at) VALUES (-2, 1, 'alice', 1, 0, '', ?)").run(OLD);
    db.prepare("INSERT INTO milestones (id, job_id, title, amount, milestone_order, state, submitted_at) VALUES (-3, 1, 'M1', 1, 0, 0, ?)").run(OLD);
    db.prepare("INSERT INTO escrow_disputes (id, job_id, raised_by, reason, created_at) VALUES (-4, 1, 'bob', 'x', ?)").run(OLD);
    db.prepare("INSERT INTO services (id, agent, title, price, active, created_at, updated_at) VALUES (-5, 'alice', 'Logo', 1, 1, ?, ?)").run(OLD, OLD);
    db.prepare("INSERT INTO job_messages (id, job_id, author, text, created_at) VALUES (-6, 1, 'bob', 'hi', ?)").run(OLD);

    const sweep = pruneStaleTempRows(db);

    expect(sweep.deleted).toEqual({
      jobs: 1,
      bids: 1,
      milestones: 1,
      escrow_disputes: 1,
      services: 1,
      job_messages: 1,
    });
    expect(sweep.total).toBe(6);
  });

  it('takes a swept service listing form with it', () => {
    db.prepare("INSERT INTO services (id, agent, title, price, active, created_at, updated_at) VALUES (-5, 'alice', 'Logo', 1, 1, ?, ?)").run(OLD, OLD);
    db.prepare("INSERT INTO service_inputs (service_id, schema, updated_at) VALUES (-5, '{}', ?)").run(OLD);

    pruneStaleTempRows(db);

    expect(db.prepare('SELECT COUNT(*) as c FROM service_inputs').get()).toEqual({ c: 0 });
  });

  it('is a no-op on a clean database', () => {
    insertJob(61);
    expect(pruneStaleTempRows(db)).toEqual({ deleted: {}, total: 0 });
  });
});

/* ------------------------------------------------------------------ */
/*  Displaced-row resolution                                            */
/* ------------------------------------------------------------------ */

describe('resolveDisplacedRow', () => {
  it('deletes the displaced row when the chain has no id for it', () => {
    insertJob(-42);

    expect(resolveDisplacedRow(db, JOBS_SPEC, -42, null)).toBe('deleted');
    expect(db.prepare('SELECT COUNT(*) as c FROM jobs').get()).toEqual({ c: 0 });
  });

  it('deletes the displaced row when the same record already sits at a real id', () => {
    insertJob(61); // the real, correctly-IDed job
    insertJob(-62504464); // its displaced twin (same client + title + created_at)

    expect(resolveDisplacedRow(db, JOBS_SPEC, -62504464, 61)).toBe('deleted');
    expect(db.prepare('SELECT id FROM jobs').all()).toEqual([{ id: 61 }]);
  });

  it('moves the displaced row when it is a distinct record', () => {
    insertJob(-42, { title: 'Another job' });

    expect(resolveDisplacedRow(db, JOBS_SPEC, -42, 90)).toBe('moved');
    expect(db.prepare('SELECT id, title FROM jobs').all()).toEqual([{ id: 90, title: 'Another job' }]);
  });

  it('drags foreign keys along when it moves', () => {
    insertJob(-42, { title: 'Another job' });
    db.prepare("INSERT INTO job_messages (id, job_id, author, text, created_at) VALUES (1, -42, 'bob', 'hi', ?)").run(OLD);

    resolveDisplacedRow(db, JOBS_SPEC, -42, 90);

    expect((db.prepare('SELECT job_id FROM job_messages').get() as any).job_id).toBe(90);
  });

  it('is a no-op when the displaced row is already gone', () => {
    expect(resolveDisplacedRow(db, JOBS_SPEC, -42, 90)).toBe('noop');
  });

  it('deletes a displaced duplicate service listing', () => {
    db.prepare("INSERT INTO services (id, agent, title, price, active, created_at, updated_at) VALUES (4, 'alice', 'Logo', 1, 1, ?, ?)").run(OLD, OLD);
    db.prepare("INSERT INTO services (id, agent, title, price, active, created_at, updated_at) VALUES (-7, 'alice', 'Logo', 1, 1, ?, ?)").run(OLD, OLD);

    expect(resolveDisplacedRow(db, SERVICES_SPEC, -7, 4)).toBe('deleted');
    expect(db.prepare('SELECT id FROM services').all()).toEqual([{ id: 4 }]);
  });

  it('deletes a displaced duplicate job message', () => {
    db.prepare("INSERT INTO job_messages (id, job_id, author, text, created_at) VALUES (3, 1, 'bob', 'hi', ?)").run(OLD);
    db.prepare("INSERT INTO job_messages (id, job_id, author, text, created_at) VALUES (-9, 1, 'bob', 'hi', ?)").run(OLD);

    expect(resolveDisplacedRow(db, JOB_MESSAGES_SPEC, -9, 3)).toBe('deleted');
    expect(db.prepare('SELECT id FROM job_messages').all()).toEqual([{ id: 3 }]);
  });

  it('closes the loop with safeCorrect: displace, fail the lookup, delete', () => {
    insertJob(1, { title: 'First' });
    insertJob(2, { title: 'Second' });

    // Correct job 2 -> 1: job 1 gets displaced to a negative slot...
    let displaced: number | null = null;
    safeCorrect(db, JOBS_SPEC, 2, 1, (displacedId) => {
      displaced = displacedId;
    });
    expect(displaced).toBeLessThan(0);

    // ...and its own lookup comes back empty, so it must not survive.
    resolveDisplacedRow(db, JOBS_SPEC, displaced!, null);

    expect(db.prepare('SELECT id, title FROM jobs').all()).toEqual([{ id: 1, title: 'Second' }]);
  });
});

/* ------------------------------------------------------------------ */
/*  Public list endpoints never show a temp row                         */
/* ------------------------------------------------------------------ */

describe('Negative ids are excluded from public queries', () => {
  it('queryServices skips a displaced listing', () => {
    db.prepare("INSERT INTO services (id, agent, title, price, active, created_at, updated_at) VALUES (-5, 'alice', 'Ghost', 1, 1, ?, ?)").run(OLD, OLD);
    db.prepare("INSERT INTO services (id, agent, title, price, active, created_at, updated_at) VALUES (5, 'alice', 'Real', 1, 1, ?, ?)").run(OLD, OLD);

    const result = queryServices(db);
    expect(result.total).toBe(1);
    expect(result.services.map((s) => s.title)).toEqual(['Real']);
  });

  it('job message helpers skip displaced rows', () => {
    insertJob(1);
    db.prepare("INSERT INTO job_messages (id, job_id, author, text, created_at) VALUES (-3, 1, 'bob', 'ghost', ?)").run(OLD);
    db.prepare("INSERT INTO job_messages (id, job_id, author, text, created_at) VALUES (3, 1, 'bob', 'real', ?)").run(OLD);

    expect(queryJobMessages(db, 1).map((m) => m.text)).toEqual(['real']);
    expect(jobMessageCount(db, 1)).toBe(1);
  });

  it('jobExists is false for a displaced job', () => {
    insertJob(-1);
    expect(jobExists(db, -1)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  HTTP surface                                                        */
/* ------------------------------------------------------------------ */

describe('API', () => {
  let server: Server;
  let base: string;

  async function listen(token?: string) {
    if (token) process.env.ADMIN_API_TOKEN = token;
    else delete process.env.ADMIN_API_TOKEN;

    const app = express();
    app.use(express.json());
    app.use('/api', createRoutes(db));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address() as any;
    base = `http://127.0.0.1:${addr.port}/api`;
  }

  afterEach(async () => {
    delete process.env.ADMIN_API_TOKEN;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /jobs and /jobs/open hide displaced rows', async () => {
    insertJob(-62504464);
    insertJob(61);
    await listen();

    const all = await (await fetch(`${base}/jobs`)).json() as any;
    expect(all.jobs.map((j: any) => j.id)).toEqual([61]);

    const open = await (await fetch(`${base}/jobs/open`)).json() as any;
    expect(open.jobs.map((j: any) => j.id)).toEqual([61]);
  });

  it('GET /jobs/:id/bids and /agents/:account/bids hide displaced rows', async () => {
    insertJob(1);
    db.prepare("INSERT INTO bids (id, job_id, agent, amount, timeline, proposal, created_at) VALUES (-2, 1, 'alice', 1, 0, 'ghost', ?)").run(OLD);
    db.prepare("INSERT INTO bids (id, job_id, agent, amount, timeline, proposal, created_at) VALUES (2, 1, 'alice', 1, 0, 'real', ?)").run(OLD);
    await listen();

    const byJob = await (await fetch(`${base}/jobs/1/bids`)).json() as any;
    expect(byJob.bids.map((b: any) => b.proposal)).toEqual(['real']);

    const byAgent = await (await fetch(`${base}/agents/alice/bids`)).json() as any;
    expect(byAgent.bids.map((b: any) => b.proposal)).toEqual(['real']);
  });

  it('POST /admin/prune-temp-rows sweeps and reports counts', async () => {
    insertJob(-62504464);
    insertJob(61);
    await listen('s3cret');

    const res = await fetch(`${base}/admin/prune-temp-rows`, {
      method: 'POST',
      headers: { Authorization: 'Bearer s3cret', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      max_age_sec: 600,
      total: 1,
      deleted: { jobs: 1 },
    });
    expect(db.prepare('SELECT id FROM jobs').all()).toEqual([{ id: 61 }]);
  });

  it('POST /admin/prune-temp-rows accepts a custom max_age_sec', async () => {
    insertJob(-1, { created_at: NOW - 30, updated_at: NOW - 30 });
    await listen('s3cret');

    const res = await fetch(`${base}/admin/prune-temp-rows`, {
      method: 'POST',
      headers: { Authorization: 'Bearer s3cret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_age_sec: 10 }),
    });

    expect((await res.json() as any).total).toBe(1);
  });

  it('POST /admin/prune-temp-rows rejects a bad token', async () => {
    insertJob(-1);
    await listen('s3cret');

    const res = await fetch(`${base}/admin/prune-temp-rows`, {
      method: 'POST',
      headers: { Authorization: 'Bearer nope' },
    });

    expect(res.status).toBe(401);
    expect(db.prepare('SELECT COUNT(*) as c FROM jobs').get()).toEqual({ c: 1 });
  });

  it('POST /admin/prune-temp-rows is 503 when no admin token is configured', async () => {
    await listen();

    const res = await fetch(`${base}/admin/prune-temp-rows`, { method: 'POST' });

    expect(res.status).toBe(503);
  });
});

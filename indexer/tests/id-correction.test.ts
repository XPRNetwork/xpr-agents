import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  safeCorrect,
  moveId,
  flushPendingCorrections,
  pendingCorrections,
  type RetargetSpec,
} from '../src/handlers/id-correction';

/**
 * Tests for the collision-safe ID correction logic.
 *
 * Background: prior behaviour crashed with `UNIQUE constraint failed: jobs.id`
 * when a synthetic ID needed to move into a slot already occupied by another
 * (also-mis-IDed) record. The new safeCorrect handles this by displacing the
 * occupier to a unique negative temp ID first.
 */

function setupJobsTable(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY,
      title TEXT,
      client TEXT,
      job_hash TEXT
    );
    CREATE TABLE bids (
      id INTEGER PRIMARY KEY,
      job_id INTEGER,
      agent TEXT
    );
    CREATE TABLE milestones (
      id INTEGER PRIMARY KEY,
      job_id INTEGER,
      title TEXT
    );
    CREATE TABLE escrow_disputes (
      id INTEGER PRIMARY KEY,
      job_id INTEGER,
      raised_by TEXT
    );
    CREATE TABLE job_evidence (
      job_id INTEGER PRIMARY KEY,
      evidence_uri TEXT
    );
  `);
  return db;
}

const JOBS_SPEC: RetargetSpec = {
  primaryTable: 'jobs',
  fkRefs: [
    { table: 'bids', col: 'job_id' },
    { table: 'milestones', col: 'job_id' },
    { table: 'escrow_disputes', col: 'job_id' },
    { table: 'job_evidence', col: 'job_id' },
  ],
};

beforeEach(() => {
  // Clear any stale corrections between tests
  pendingCorrections.length = 0;
});

describe('moveId', () => {
  it('moves a primary row id and updates all FKs in one transaction', () => {
    const db = setupJobsTable();
    db.prepare("INSERT INTO jobs VALUES (50, 'A', 'paul', 'h1')").run();
    db.prepare("INSERT INTO bids VALUES (1, 50, 'agent-a')").run();
    db.prepare("INSERT INTO bids VALUES (2, 50, 'agent-b')").run();
    db.prepare("INSERT INTO milestones VALUES (1, 50, 'm1')").run();

    moveId(db, JOBS_SPEC, 50, 44);

    expect(db.prepare('SELECT id FROM jobs').get()).toEqual({ id: 44 });
    expect(db.prepare('SELECT COUNT(*) as c FROM bids WHERE job_id = 44').get()).toEqual({ c: 2 });
    expect(db.prepare('SELECT COUNT(*) as c FROM milestones WHERE job_id = 44').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) as c FROM bids WHERE job_id = 50').get()).toEqual({ c: 0 });
  });
});

describe('safeCorrect', () => {
  it('moves tempId → realId when destination slot is free', () => {
    const db = setupJobsTable();
    db.prepare("INSERT INTO jobs VALUES (50, 'A', 'paul', 'h1')").run();

    const displaced = safeCorrect(db, JOBS_SPEC, 50, 44);

    expect(displaced).toBeNull();
    expect(db.prepare('SELECT title FROM jobs WHERE id = 44').get()).toEqual({ title: 'A' });
    expect(db.prepare('SELECT 1 FROM jobs WHERE id = 50').get()).toBeUndefined();
  });

  it('displaces the occupier to a unique negative ID when destination is taken', () => {
    const db = setupJobsTable();
    // Two jobs with mis-IDs: row at id=44 was mis-IDed, our row at id=50 needs to move there
    db.prepare("INSERT INTO jobs VALUES (44, 'OLD-mis-IDed', 'alice', 'old')").run();
    db.prepare("INSERT INTO jobs VALUES (50, 'OUR-job', 'paul', 'new')").run();
    db.prepare("INSERT INTO bids VALUES (1, 44, 'a-bidder')").run();
    db.prepare("INSERT INTO bids VALUES (2, 50, 'p-bidder')").run();

    const displaced = safeCorrect(db, JOBS_SPEC, 50, 44);

    expect(displaced).not.toBeNull();
    expect(displaced).toBeLessThan(0);

    // Our job is now at 44
    const ourRow = db.prepare('SELECT title FROM jobs WHERE id = 44').get() as { title: string };
    expect(ourRow.title).toBe('OUR-job');

    // The displaced row is at the negative ID
    const displacedRow = db.prepare('SELECT title FROM jobs WHERE id = ?').get(displaced) as { title: string };
    expect(displacedRow.title).toBe('OLD-mis-IDed');

    // FKs follow:
    expect(db.prepare('SELECT agent FROM bids WHERE job_id = 44').get()).toEqual({ agent: 'p-bidder' });
    expect(db.prepare('SELECT agent FROM bids WHERE job_id = ?').get(displaced)).toEqual({ agent: 'a-bidder' });

    // No row at 50 anymore
    expect(db.prepare('SELECT 1 FROM jobs WHERE id = 50').get()).toBeUndefined();
  });

  it('calls onDisplaced with the moved row metadata', () => {
    const db = setupJobsTable();
    db.prepare("INSERT INTO jobs VALUES (44, 'OLD', 'alice', 'old-hash')").run();
    db.prepare("INSERT INTO jobs VALUES (50, 'OUR', 'paul', 'new-hash')").run();

    const calls: Array<{ id: number; row: any }> = [];
    safeCorrect(db, JOBS_SPEC, 50, 44, (id, row) => {
      calls.push({ id, row });
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].id).toBeLessThan(0);
    expect(calls[0].row.title).toBe('OLD');
    expect(calls[0].row.client).toBe('alice');
    expect(calls[0].row.job_hash).toBe('old-hash');
    expect(calls[0].row.id).toBe(calls[0].id);
  });

  it('is a no-op when realId === tempId', () => {
    const db = setupJobsTable();
    db.prepare("INSERT INTO jobs VALUES (44, 'A', 'paul', 'h1')").run();
    expect(safeCorrect(db, JOBS_SPEC, 44, 44)).toBeNull();
    expect(db.prepare('SELECT title FROM jobs WHERE id = 44').get()).toEqual({ title: 'A' });
  });

  it('produces unique displaced IDs across multiple back-to-back collisions', () => {
    const db = setupJobsTable();
    // Set up TWO conflicts that need displacing
    db.prepare("INSERT INTO jobs VALUES (44, 'A', 'p', 'h')").run();
    db.prepare("INSERT INTO jobs VALUES (45, 'B', 'p', 'h')").run();
    db.prepare("INSERT INTO jobs VALUES (50, 'C', 'p', 'h')").run();
    db.prepare("INSERT INTO jobs VALUES (51, 'D', 'p', 'h')").run();

    const displaced1 = safeCorrect(db, JOBS_SPEC, 50, 44);
    const displaced2 = safeCorrect(db, JOBS_SPEC, 51, 45);

    expect(displaced1).not.toBeNull();
    expect(displaced2).not.toBeNull();
    expect(displaced1).not.toBe(displaced2);

    // All 4 rows still exist (none lost)
    expect(db.prepare('SELECT COUNT(*) as c FROM jobs').get()).toEqual({ c: 4 });
  });
});

describe('flushPendingCorrections', () => {
  it('runs all queued corrections in order', async () => {
    const order: number[] = [];
    pendingCorrections.push(async () => { order.push(1); });
    pendingCorrections.push(async () => { order.push(2); });
    pendingCorrections.push(async () => { order.push(3); });

    await flushPendingCorrections();

    expect(order).toEqual([1, 2, 3]);
    expect(pendingCorrections).toHaveLength(0);
  });

  it('continues processing the queue after a single correction fails', async () => {
    const order: number[] = [];
    pendingCorrections.push(async () => { order.push(1); });
    pendingCorrections.push(async () => {
      order.push(2);
      throw new Error('boom');
    });
    pendingCorrections.push(async () => { order.push(3); });

    await flushPendingCorrections();

    // All three ran — failure didn't abort the batch (this is the regression
    // this test guards against; previously a thrown error would short-circuit
    // the while loop and silently lose every subsequent correction).
    expect(order).toEqual([1, 2, 3]);
  });

  it('drains corrections that get pushed during the flush itself', async () => {
    const order: number[] = [];
    pendingCorrections.push(async () => {
      order.push(1);
      pendingCorrections.push(async () => { order.push(2); });
    });

    await flushPendingCorrections();

    expect(order).toEqual([1, 2]);
    expect(pendingCorrections).toHaveLength(0);
  });
});

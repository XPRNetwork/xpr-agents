import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../src/db/schema';
import { handleFeedbackAction } from '../src/handlers/feedback';
import { handleEscrowAction } from '../src/handlers/escrow';
import { handleAgentAction } from '../src/handlers/agent';
import { StreamAction } from '../src/stream';

/**
 * Audit round 2 (codex #14/#15) indexer identity regressions.
 */
let seq = 0;
function act(account: string, name: string, data: Record<string, any>, timestamp = '2024-01-15T12:00:00.000Z'): StreamAction {
  return {
    block_num: 100,
    global_sequence: ++seq,
    action_ordinal: 1,
    timestamp,
    trx_id: 'trx',
    act: { account, name, authorization: [{ actor: 'x', permission: 'active' }], data },
  } as StreamAction;
}

describe('indexer identity (audit round 2)', () => {
  let db: Database.Database;
  beforeEach(() => { db = initDatabase(':memory:'); });

  describe('#14 feedback dispute id mirrors availablePrimaryKey (starts at 0)', () => {
    it('assigns the first dispute id 0, increments, and resolve() finds the right feedback', () => {
      // Feedback rows FK to the agents table, so register alice first.
      handleAgentAction(db, act('agentcore', 'register', { account: 'alice', name: 'A', description: 'd', endpoint: 'https://a.test', protocol: 'https', capabilities: '["x"]' }));
      // Two feedbacks for alice.
      handleFeedbackAction(db, act('agentfeed', 'submit', { agent: 'alice', reviewer: 'r1', score: 5, tags: '', job_hash: 'h0', evidence_uri: '', amount_paid: 0 }));
      handleFeedbackAction(db, act('agentfeed', 'submit', { agent: 'alice', reviewer: 'r2', score: 1, tags: '', job_hash: 'h1', evidence_uri: '', amount_paid: 0 }));
      const fbIds = (db.prepare('SELECT id FROM feedback ORDER BY id').all() as any[]).map(r => r.id);

      // Dispute the SECOND feedback (chain dispute id must be 0 for the first-ever dispute).
      handleFeedbackAction(db, act('agentfeed', 'dispute', { feedback_id: fbIds[1], disputer: 'alice', reason: 'x', evidence_uri: '' }));
      const d0 = db.prepare('SELECT id, feedback_id FROM feedback_disputes ORDER BY id').all() as any[];
      expect(d0.length).to.equal(1);
      expect(Number(d0[0].id)).to.equal(0);                 // FIX: was 1 (off by one)
      expect(Number(d0[0].feedback_id)).to.equal(fbIds[1]);

      // A second dispute gets id 1.
      handleFeedbackAction(db, act('agentfeed', 'dispute', { feedback_id: fbIds[0], disputer: 'alice', reason: 'y', evidence_uri: '' }));
      const ids = (db.prepare('SELECT id FROM feedback_disputes ORDER BY id').all() as any[]).map(r => Number(r.id));
      expect(ids).to.deep.equal([0, 1]);

      // resolve(dispute_id 0, upheld) marks the SECOND feedback resolved — not the first.
      handleFeedbackAction(db, act('agentfeed', 'resolve', { dispute_id: 0, upheld: true }));
      const fb1 = db.prepare('SELECT resolved FROM feedback WHERE id = ?').get(fbIds[1]) as any;
      const fb0 = db.prepare('SELECT resolved FROM feedback WHERE id = ?').get(fbIds[0]) as any;
      expect(Number(fb1.resolved)).to.equal(1);
      expect(Number(fb0.resolved)).to.equal(0);
    });
  });

  describe('#15 createjob dedup keeps distinct same-title jobs', () => {
    const job = (over: Record<string, any> = {}) => ({
      client: 'alice', agent: 'bot', title: 'Logo', description: 'd', deliverables: '[]',
      amount: 1000000, symbol: 'XPR', deadline: 0, arbitrator: '', job_hash: '', ...over,
    });

    it('keeps two distinct jobs (same client/title/empty-hash, different created_at) and dedups a true replay', () => {
      // Two genuinely-different jobs created in different blocks (different timestamps).
      handleEscrowAction(db, act('agentescrow', 'createjob', job(), '2024-01-15T12:00:00.000Z'));
      handleEscrowAction(db, act('agentescrow', 'createjob', job({ agent: 'bot2', amount: 2000000 }), '2024-01-15T12:00:05.000Z'));
      expect((db.prepare('SELECT COUNT(*) c FROM jobs').get() as any).c).to.equal(2); // FIX: was 1 (second dropped)

      // A true replay of the FIRST job (identical fields incl. created_at) is deduped.
      handleEscrowAction(db, act('agentescrow', 'createjob', job(), '2024-01-15T12:00:00.000Z'));
      expect((db.prepare('SELECT COUNT(*) c FROM jobs').get() as any).c).to.equal(2);
    });
  });

  describe('#15 listsvc dedup keeps distinct same-title listings', () => {
    const svc = (over: Record<string, any> = {}) => ({
      agent: 'bot', title: 'Design', description: 'd', deliverables: '[]',
      price: 500000, turnaround: 3600, category: 'art', sample_uri: '', ...over,
    });

    it('keeps two listings with the same agent/title but different created_at', () => {
      handleEscrowAction(db, act('agentescrow', 'listsvc', svc(), '2024-01-15T12:00:00.000Z'));
      handleEscrowAction(db, act('agentescrow', 'listsvc', svc({ price: 900000 }), '2024-01-15T12:00:07.000Z'));
      expect((db.prepare('SELECT COUNT(*) c FROM services').get() as any).c).to.equal(2);
      // True replay (same created_at) is deduped.
      handleEscrowAction(db, act('agentescrow', 'listsvc', svc(), '2024-01-15T12:00:00.000Z'));
      expect((db.prepare('SELECT COUNT(*) c FROM services').get() as any).c).to.equal(2);
    });
  });
});

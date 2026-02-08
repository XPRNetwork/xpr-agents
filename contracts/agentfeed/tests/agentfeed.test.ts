import { expect } from 'chai';
import { Blockchain, protonAssert, expectToThrow, nameToBigInt } from '@proton/vert';
import { TimePointSec } from '@greymass/eosio';

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                          */
/* ------------------------------------------------------------------ */

const blockchain = new Blockchain();

// The agentfeed contract reads from agentcore's agents table via cross-contract table read.
const agentcore = blockchain.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const agentfeed = blockchain.createContract('agentfeed', 'assembly/target/agentfeed.contract');

const [owner, alice, bob, carol, reviewer1, reviewer2] = blockchain.createAccounts(
  'owner', 'alice', 'bob', 'carol', 'reviewer1', 'reviewer2'
);

/* helpers */
const getConfig = () => {
  return agentfeed.tables.config(nameToBigInt('agentfeed')).getTableRows()[0];
};

const getFeedbackRows = () => {
  return agentfeed.tables.feedback(nameToBigInt('agentfeed')).getTableRows();
};

const getAgentScore = (agent: string) => {
  return agentfeed.tables.agentscores(nameToBigInt('agentfeed')).getTableRow(nameToBigInt(agent));
};

const getRecalcState = (agent: string) => {
  return agentfeed.tables.recalcstate(nameToBigInt('agentfeed')).getTableRow(nameToBigInt(agent));
};

/* Setup helpers */
const initContracts = async () => {
  await agentcore.actions.init(['owner', 0, 100000, 'agentfeed', '', '']).send('agentcore@active');
  await agentfeed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
};

const registerAgent = async (name: string) => {
  await agentcore.actions.register([
    name, 'Test Agent', 'A test agent', 'https://api.test.com', 'https', '["chat"]'
  ]).send(`${name}@active`);
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('agentfeed', () => {

  beforeEach(() => {
    blockchain.resetTables();
  });

  /* ==================== Initialization ==================== */

  describe('init', () => {
    it('should initialize the contract', async () => {
      await agentfeed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
      const cfg = getConfig();
      expect(cfg.owner).to.equal('owner');
      expect(cfg.core_contract).to.equal('agentcore');
      expect(cfg.min_score).to.equal(1);
      expect(cfg.max_score).to.equal(5);
    });

    it('should reject re-initialization', async () => {
      await agentfeed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
      await expectToThrow(
        agentfeed.actions.init(['bob', 'agentcore']).send('agentfeed@active'),
        'eosio_assert: Contract already initialized.'
      );
    });

    it('should require contract auth', async () => {
      await expectToThrow(
        agentfeed.actions.init(['owner', 'agentcore']).send('alice@active'),
        'missing required authority agentfeed'
      );
    });
  });

  /* ==================== Submit Feedback ==================== */

  describe('submit', () => {
    beforeEach(async () => {
      await initContracts();
      await registerAgent('alice');
    });

    it('should submit feedback for an agent', async () => {
      await agentfeed.actions.submit([
        'bob', 'alice', 4, 'quality,fast', 'hash123', 'ipfs://evidence', 10000
      ]).send('bob@active');

      const rows = getFeedbackRows();
      expect(rows.length).to.equal(1);
      expect(rows[0].agent).to.equal('alice');
      expect(rows[0].reviewer).to.equal('bob');
      expect(rows[0].score).to.equal(4);
    });

    it('should submit multiple feedbacks', async () => {
      await agentfeed.actions.submit([
        'bob', 'alice', 4, 'quality', 'hash1', 'ipfs://ev1', 0
      ]).send('bob@active');
      await agentfeed.actions.submit([
        'carol', 'alice', 5, 'excellent', 'hash2', 'ipfs://ev2', 0
      ]).send('carol@active');

      const rows = getFeedbackRows();
      expect(rows.length).to.equal(2);
    });

    it('should reject self-review', async () => {
      await expectToThrow(
        agentfeed.actions.submit([
          'alice', 'alice', 4, 'quality', 'hash123', 'ipfs://evidence', 0
        ]).send('alice@active'),
        protonAssert('Cannot review yourself')
      );
    });

    it('should reject out-of-range score (too low)', async () => {
      await expectToThrow(
        agentfeed.actions.submit([
          'bob', 'alice', 0, 'quality', 'hash123', 'ipfs://evidence', 0
        ]).send('bob@active'),
        protonAssert('Score out of range')
      );
    });

    it('should reject out-of-range score (too high)', async () => {
      await expectToThrow(
        agentfeed.actions.submit([
          'bob', 'alice', 6, 'quality', 'hash123', 'ipfs://evidence', 0
        ]).send('bob@active'),
        protonAssert('Score out of range')
      );
    });

    it('should reject feedback for non-existent agent', async () => {
      await expectToThrow(
        agentfeed.actions.submit([
          'bob', 'carol', 4, 'quality', 'hash123', 'ipfs://evidence', 0
        ]).send('bob@active'),
        protonAssert('Agent not registered in agentcore')
      );
    });

    it('should reject feedback for inactive agent', async () => {
      await agentcore.actions.setstatus(['alice', false]).send('alice@active');
      await expectToThrow(
        agentfeed.actions.submit([
          'bob', 'alice', 4, 'quality', 'hash123', 'ipfs://evidence', 0
        ]).send('bob@active'),
        protonAssert('Agent is not active')
      );
    });

    it('should reject when paused', async () => {
      // setconfig: core_contract, min_score, max_score, dispute_window, decay_period, decay_floor, paused, feedback_fee
      await agentfeed.actions.setconfig(['agentcore', 1, 5, 86400, 3600, 50, true, 0]).send('owner@active');
      await expectToThrow(
        agentfeed.actions.submit([
          'bob', 'alice', 4, 'quality', 'hash123', 'ipfs://evidence', 0
        ]).send('bob@active'),
        protonAssert('Contract is paused')
      );
    });

    it('should require reviewer auth', async () => {
      await expectToThrow(
        agentfeed.actions.submit([
          'bob', 'alice', 4, 'quality', 'hash123', 'ipfs://evidence', 0
        ]).send('carol@active'),
        'missing required authority bob'
      );
    });

    it('should update agent score after feedback', async () => {
      await agentfeed.actions.submit([
        'bob', 'alice', 4, 'quality', 'hash123', 'ipfs://evidence', 0
      ]).send('bob@active');

      const score = getAgentScore('alice');
      expect(score).to.not.be.undefined;
      expect(score.feedback_count).to.equal(1);
    });
  });

  /* ==================== Dispute ==================== */

  describe('dispute', () => {
    beforeEach(async () => {
      await initContracts();
      await registerAgent('alice');
      await agentfeed.actions.submit([
        'bob', 'alice', 4, 'quality', 'hash123', 'ipfs://evidence', 0
      ]).send('bob@active');
    });

    it('should create a dispute from the reviewed agent', async () => {
      await agentfeed.actions.dispute([
        'alice', 0, 'Inaccurate feedback', 'ipfs://dispute-evidence'
      ]).send('alice@active');
      const rows = getFeedbackRows();
      expect(rows.length).to.equal(1);
    });

    it('should create a dispute from the reviewer', async () => {
      await agentfeed.actions.dispute([
        'bob', 0, 'I want to correct my review', 'ipfs://correction'
      ]).send('bob@active');
    });

    it('should reject dispute from unrelated party', async () => {
      await expectToThrow(
        agentfeed.actions.dispute([
          'carol', 0, 'Inaccurate feedback', 'ipfs://dispute-evidence'
        ]).send('carol@active'),
        protonAssert('Only agent or reviewer can dispute')
      );
    });
  });

  /* ==================== setowner (governance) ==================== */

  describe('setowner', () => {
    beforeEach(async () => {
      await agentfeed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
    });

    it('should transfer contract ownership', async () => {
      await agentfeed.actions.setowner(['bob']).send('owner@active');
      const cfg = getConfig();
      expect(cfg.owner).to.equal('bob');
    });

    it('should reject from non-owner', async () => {
      await expectToThrow(
        agentfeed.actions.setowner(['bob']).send('alice@active'),
        'missing required authority owner'
      );
    });

    it('new owner can use admin actions', async () => {
      await agentfeed.actions.setowner(['bob']).send('owner@active');
      await agentfeed.actions.setconfig(['agentcore', 1, 5, 86400, 3600, 50, false, 0]).send('bob@active');
      const cfg = getConfig();
      expect(cfg.dispute_window).to.equal(86400);
    });
  });

  /* ==================== setconfig ==================== */

  describe('setconfig', () => {
    beforeEach(async () => {
      await agentfeed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
    });

    it('should update config', async () => {
      // core_contract, min_score, max_score, dispute_window, decay_period, decay_floor, paused, feedback_fee
      await agentfeed.actions.setconfig(['agentcore', 1, 10, 172800, 7200, 30, false, 0]).send('owner@active');
      const cfg = getConfig();
      expect(cfg.dispute_window).to.equal(172800);
      expect(cfg.max_score).to.equal(10);
      expect(cfg.decay_period).to.equal(7200);
    });

    it('should pause the contract', async () => {
      await agentfeed.actions.setconfig(['agentcore', 1, 5, 86400, 3600, 50, true, 0]).send('owner@active');
      const cfg = getConfig();
      expect(cfg.paused).to.equal(true);
    });

    it('should reject decay_period below minimum', async () => {
      await expectToThrow(
        agentfeed.actions.setconfig(['agentcore', 1, 5, 86400, 0, 50, false, 0]).send('owner@active'),
        protonAssert('Decay period must be at least 3600 seconds (1 hour)')
      );
    });

    it('should reject from non-owner', async () => {
      await expectToThrow(
        agentfeed.actions.setconfig(['agentcore', 1, 5, 86400, 3600, 50, false, 0]).send('alice@active'),
        'missing required authority owner'
      );
    });
  });

  /* ==================== Paginated Recalculation ==================== */

  describe('recalculation', () => {
    beforeEach(async () => {
      await initContracts();
      await registerAgent('alice');
      blockchain.setTime(TimePointSec.from(1700000000));
    });

    it('should recalculate score in single batch', async () => {
      // Submit 2 feedbacks
      await agentfeed.actions.submit(['bob', 'alice', 5, 'great', 'h1', '', 0]).send('bob@active');
      blockchain.addTime(TimePointSec.from(86401)); // advance past rate limit
      await agentfeed.actions.submit(['carol', 'alice', 3, 'ok', 'h2', '', 0]).send('carol@active');

      // Recalculate in one batch
      await agentfeed.actions.recalc(['alice', 0, 100]).send('alice@active');

      // Recalc state should be cleaned up (complete)
      const recalcState = getRecalcState('alice');
      expect(recalcState).to.be.undefined;

      // Score should be updated
      const score = getAgentScore('alice');
      expect(score).to.not.be.undefined;
      expect(score.feedback_count).to.equal(2);
    });

    it('should recalculate across multiple batches', async () => {
      // Submit 2 feedbacks
      await agentfeed.actions.submit(['bob', 'alice', 5, 'great', 'h1', '', 0]).send('bob@active');
      blockchain.addTime(TimePointSec.from(86401));
      await agentfeed.actions.submit(['carol', 'alice', 4, 'good', 'h2', '', 0]).send('carol@active');

      // First batch: process 1 feedback
      await agentfeed.actions.recalc(['alice', 0, 1]).send('alice@active');

      // Recalc state should exist with next_offset=1
      let recalcState = getRecalcState('alice');
      expect(recalcState).to.not.be.undefined;
      expect(recalcState.next_offset).to.equal(1);

      // Second batch: process remaining
      await agentfeed.actions.recalc(['alice', 1, 1]).send('alice@active');

      // Recalc state should be cleaned up
      recalcState = getRecalcState('alice');
      expect(recalcState).to.be.undefined;

      // Final score should include both feedbacks
      const score = getAgentScore('alice');
      expect(score.feedback_count).to.equal(2);
    });

    it('should reject wrong offset during pagination', async () => {
      await agentfeed.actions.submit(['bob', 'alice', 5, 'great', 'h1', '', 0]).send('bob@active');
      blockchain.addTime(TimePointSec.from(86401));
      await agentfeed.actions.submit(['carol', 'alice', 4, 'good', 'h2', '', 0]).send('carol@active');

      // Start recalculation
      await agentfeed.actions.recalc(['alice', 0, 1]).send('alice@active');

      // Try wrong offset (should be 1, not 5)
      try {
        await agentfeed.actions.recalc(['alice', 5, 1]).send('alice@active');
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('Invalid offset');
      }
    });

    it('should reject continuation without starting', async () => {
      await expectToThrow(
        agentfeed.actions.recalc(['alice', 5, 10]).send('alice@active'),
        protonAssert('No recalculation in progress. Start with offset=0')
      );
    });

    it('should reject limit over 100', async () => {
      await expectToThrow(
        agentfeed.actions.recalc(['alice', 0, 101]).send('alice@active'),
        protonAssert('Limit must be 1-100')
      );
    });

    it('should cancel an in-progress recalculation', async () => {
      await agentfeed.actions.submit(['bob', 'alice', 5, 'great', 'h1', '', 0]).send('bob@active');
      blockchain.addTime(TimePointSec.from(86401));
      await agentfeed.actions.submit(['carol', 'alice', 4, 'good', 'h2', '', 0]).send('carol@active');

      // Start recalculation
      await agentfeed.actions.recalc(['alice', 0, 1]).send('alice@active');
      expect(getRecalcState('alice')).to.not.be.undefined;

      // Cancel it
      await agentfeed.actions.cancelrecalc(['alice']).send('alice@active');
      expect(getRecalcState('alice')).to.be.undefined;
    });

    it('should reject cancel when no recalc in progress', async () => {
      await expectToThrow(
        agentfeed.actions.cancelrecalc(['alice']).send('alice@active'),
        protonAssert('No recalculation in progress for this agent')
      );
    });

    it('should block feedback during active recalculation', async () => {
      await agentfeed.actions.submit(['bob', 'alice', 5, 'great', 'h1', '', 0]).send('bob@active');
      blockchain.addTime(TimePointSec.from(86401));
      await agentfeed.actions.submit(['carol', 'alice', 4, 'good', 'h2', '', 0]).send('carol@active');

      // Start recalculation (partial)
      await agentfeed.actions.recalc(['alice', 0, 1]).send('alice@active');

      // Try to submit feedback during recalc - should fail
      // Note: reviewer1 has no prior rate limit for alice, so no time advance needed
      try {
        await agentfeed.actions.submit(['reviewer1', 'alice', 3, 'ok', 'h3', '', 0]).send('reviewer1@active');
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('Cannot submit feedback while recalculation is in progress');
      }
    });

    it('should allow owner to trigger recalculation', async () => {
      await agentfeed.actions.submit(['bob', 'alice', 5, 'great', 'h1', '', 0]).send('bob@active');
      await agentfeed.actions.recalc(['alice', 0, 100]).send('owner@active');
      const score = getAgentScore('alice');
      expect(score.feedback_count).to.equal(1);
    });

    it('should reject recalculation from unauthorized account', async () => {
      await agentfeed.actions.submit(['bob', 'alice', 5, 'great', 'h1', '', 0]).send('bob@active');
      await expectToThrow(
        agentfeed.actions.recalc(['alice', 0, 100]).send('carol@active'),
        protonAssert('Only agent or contract owner can trigger recalculation')
      );
    });
  });

  /* ==================== Score Calculation ==================== */

  describe('score calculation', () => {
    beforeEach(async () => {
      await initContracts();
      await registerAgent('alice');
      blockchain.setTime(TimePointSec.from(1700000000));
    });

    it('should calculate correct avg_score for single feedback', async () => {
      // Score 4/5, KYC level 0 (no eosio.proton table in test env)
      // Weight = 1 + 0 = 1; weightedScore = 4 * 1 = 4; normalizedWeight = 1 * 5 = 5
      // avg_score = (4 * 10000) / 5 = 8000 (80.00%)
      await agentfeed.actions.submit(['bob', 'alice', 4, 'good', 'h1', '', 0]).send('bob@active');

      const score = getAgentScore('alice');
      expect(score.total_score).to.equal(4);
      expect(score.total_weight).to.equal(5);
      expect(score.avg_score).to.equal(8000);
    });

    it('should calculate correct avg_score for multiple feedbacks', async () => {
      // First: score=5, weight=1 → ws=5, nw=5
      await agentfeed.actions.submit(['bob', 'alice', 5, 'great', 'h1', '', 0]).send('bob@active');
      blockchain.addTime(TimePointSec.from(86401));
      // Second: score=3, weight=1 → ws=3, nw=5
      await agentfeed.actions.submit(['carol', 'alice', 3, 'ok', 'h2', '', 0]).send('carol@active');

      // total_score = 5+3 = 8, total_weight = 5+5 = 10
      // avg_score = (8 * 10000) / 10 = 8000 (80.00%)
      const score = getAgentScore('alice');
      expect(score.total_score).to.equal(8);
      expect(score.total_weight).to.equal(10);
      expect(score.feedback_count).to.equal(2);
      expect(score.avg_score).to.equal(8000);
    });

    it('should handle perfect score (5/5)', async () => {
      await agentfeed.actions.submit(['bob', 'alice', 5, 'perfect', 'h1', '', 0]).send('bob@active');
      const score = getAgentScore('alice');
      // 5 * 1 * 10000 / (1 * 5) = 10000 (100.00%)
      expect(score.avg_score).to.equal(10000);
    });

    it('should handle minimum score (1/5)', async () => {
      await agentfeed.actions.submit(['bob', 'alice', 1, 'bad', 'h1', '', 0]).send('bob@active');
      const score = getAgentScore('alice');
      // 1 * 1 * 10000 / (1 * 5) = 2000 (20.00%)
      expect(score.avg_score).to.equal(2000);
    });

    it('should subtract score on upheld dispute', async () => {
      // Submit feedback
      await agentfeed.actions.submit(['bob', 'alice', 5, 'great', 'h1', '', 0]).send('bob@active');
      blockchain.addTime(TimePointSec.from(86401));
      await agentfeed.actions.submit(['carol', 'alice', 3, 'ok', 'h2', '', 0]).send('carol@active');

      // Dispute the first feedback
      await agentfeed.actions.dispute(['alice', 0, 'Inaccurate', 'ipfs://proof']).send('alice@active');

      // Resolve dispute - upheld (removes first feedback)
      await agentfeed.actions.resolve(['owner', 0, true, 'Verified inaccurate']).send('owner@active');

      // Only carol's feedback should remain in score
      const score = getAgentScore('alice');
      expect(score.feedback_count).to.equal(1);
      expect(score.total_score).to.equal(3); // carol's score=3, weight=1
      expect(score.total_weight).to.equal(5);
    });
  });

  /* ==================== Rate Limiting ==================== */

  describe('rate limiting', () => {
    beforeEach(async () => {
      await initContracts();
      await registerAgent('alice');
      blockchain.setTime(TimePointSec.from(1700000000));
    });

    it('should reject feedback within cooldown period', async () => {
      await agentfeed.actions.submit(['bob', 'alice', 4, 'good', 'h1', '', 0]).send('bob@active');

      // Try immediate second feedback from same reviewer for same agent
      try {
        await agentfeed.actions.submit(['bob', 'alice', 5, 'great', 'h2', '', 0]).send('bob@active');
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('Rate limit exceeded');
      }
    });

    it('should allow feedback after cooldown period', async () => {
      await agentfeed.actions.submit(['bob', 'alice', 4, 'good', 'h1', '', 0]).send('bob@active');

      // Advance past 24-hour cooldown
      blockchain.addTime(TimePointSec.from(86401));

      // Should succeed now
      await agentfeed.actions.submit(['bob', 'alice', 5, 'great', 'h2', '', 0]).send('bob@active');

      const rows = getFeedbackRows();
      expect(rows.length).to.equal(2);
    });

    it('should allow different reviewers for same agent simultaneously', async () => {
      await agentfeed.actions.submit(['bob', 'alice', 4, 'good', 'h1', '', 0]).send('bob@active');

      // Different reviewer should not be rate limited
      await agentfeed.actions.submit(['carol', 'alice', 5, 'great', 'h2', '', 0]).send('carol@active');

      const rows = getFeedbackRows();
      expect(rows.length).to.equal(2);
    });
  });

  /* ==================== Feedback Cleanup ==================== */

  describe('cleanup', () => {
    beforeEach(async () => {
      await initContracts();
      await registerAgent('alice');
      blockchain.setTime(TimePointSec.from(1700000000));
    });

    it('should clean old feedback', async () => {
      // Submit feedback
      await agentfeed.actions.submit(['bob', 'alice', 4, 'good', 'h1', '', 0]).send('bob@active');

      // Advance past 90 days
      blockchain.addTime(TimePointSec.from(7776001));

      // Clean feedback older than 90 days
      await agentfeed.actions.cleanfback(['alice', 7776000, 10]).send('bob@active');

      const rows = getFeedbackRows();
      expect(rows.length).to.equal(0);
    });

    it('should reject cleanup with max_age below minimum', async () => {
      try {
        await agentfeed.actions.cleanfback(['alice', 100, 10]).send('bob@active');
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('Max age must be at least 90 days');
      }
    });

    it('should clean expired recalc states', async () => {
      await agentfeed.actions.submit(['bob', 'alice', 4, 'good', 'h1', '', 0]).send('bob@active');
      blockchain.addTime(TimePointSec.from(86401));
      await agentfeed.actions.submit(['carol', 'alice', 3, 'ok', 'h2', '', 0]).send('carol@active');

      // Start a recalc (partial)
      await agentfeed.actions.recalc(['alice', 0, 1]).send('alice@active');
      expect(getRecalcState('alice')).to.not.be.undefined;

      // Advance past 1-hour expiry
      blockchain.addTime(TimePointSec.from(3601));

      // Anyone can clean expired states
      await agentfeed.actions.cleanrecalc([10]).send('bob@active');
      expect(getRecalcState('alice')).to.be.undefined;
    });
  });
});

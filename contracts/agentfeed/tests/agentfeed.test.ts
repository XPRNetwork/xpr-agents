import { expect } from 'chai';
import { Blockchain, protonAssert, expectToThrow, nameToBigInt } from '@proton/vert';

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

    it('should allow re-initialization (overwrites config)', async () => {
      await agentfeed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
      await agentfeed.actions.init(['bob', 'agentcore']).send('agentfeed@active');
      const cfg = getConfig();
      expect(cfg.owner).to.equal('bob');
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
});

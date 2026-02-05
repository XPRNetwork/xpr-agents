import { expect } from 'chai';
import { Blockchain, protonAssert, expectToThrow, mintTokens, nameToBigInt } from '@proton/vert';

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                          */
/* ------------------------------------------------------------------ */

const blockchain = new Blockchain();

// agentescrow reads from agentcore's agents table and agentfeed's scores
const agentcore = blockchain.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const agentfeed = blockchain.createContract('agentfeed', '../agentfeed/assembly/target/agentfeed.contract');
const agentescrow = blockchain.createContract('agentescrow', 'assembly/target/agentescrow.contract', true);

// eosio.token for payments and staking — DO NOT mint to agentescrow (triggers transfer handler)
const eosioToken = blockchain.createContract('eosio.token', 'node_modules/proton-tsc/external/eosio.token/eosio.token');

const [owner, client, agent1, arbitrator1, arbitrator2] = blockchain.createAccounts(
  'owner', 'client', 'agent1', 'arbitrator1', 'arbitrator2'
);

/* helpers */
const getConfig = () => {
  return agentescrow.tables.config(nameToBigInt('agentescrow')).getTableRows()[0];
};

const getJob = (id: number) => {
  return agentescrow.tables.jobs(nameToBigInt('agentescrow')).getTableRow(BigInt(id));
};

const getArbitrator = (name: string) => {
  return agentescrow.tables.arbitrators(nameToBigInt('agentescrow')).getTableRow(nameToBigInt(name));
};

const getDispute = (id: number) => {
  return agentescrow.tables.disputes(nameToBigInt('agentescrow')).getTableRow(BigInt(id));
};

const getMilestone = (id: number) => {
  return agentescrow.tables.milestones(nameToBigInt('agentescrow')).getTableRow(BigInt(id));
};

/* Setup helpers */
const initAll = async () => {
  // Create XPR token — do NOT mint to agentescrow (transfer handler rejects bad memos)
  // Mint 10000.0000 XPR each (min_arbitrator_stake is 1000.0000 XPR = 10000000)
  await mintTokens(eosioToken, 'XPR', 4, 1000000000, 100000000, [owner, client, agent1, arbitrator1, arbitrator2]);

  // Init agentcore
  await agentcore.actions.init(['owner', 0, 100000, 'agentfeed', '', 'agentescrow']).send('agentcore@active');

  // Init agentfeed
  await agentfeed.actions.init(['owner', 'agentcore']).send('agentfeed@active');

  // Init agentescrow
  await agentescrow.actions.init(['owner', 'agentcore', 'agentfeed', 200]).send('agentescrow@active');

  // Register an agent
  await agentcore.actions.register([
    'agent1', 'Test Agent', 'A test agent', 'https://api.test.com', 'https', '["chat"]'
  ]).send('agent1@active');
};

const registerArbitrator = async (name: string, fee: number = 200) => {
  await agentescrow.actions.regarb([name, fee]).send(`${name}@active`);
  // Stake tokens with 'arbstake' memo (min_arbitrator_stake = 1000.0000 XPR)
  await eosioToken.actions.transfer([name, 'agentescrow', '1000.0000 XPR', 'arbstake']).send(`${name}@active`);
  // Activate
  await agentescrow.actions.activatearb([name]).send(`${name}@active`);
};

const createAndFundJob = async () => {
  const deadline = Math.floor(Date.now() / 1000) + 86400 * 30; // 30 days
  await agentescrow.actions.createjob([
    'client', 'agent1', 'Test Job', 'Test description', '["deliverable1"]',
    1000000, '4,XPR', deadline, 'arbitrator1', 'jobhash123'
  ]).send('client@active');

  // Fund the job with 'fund:0' memo
  await eosioToken.actions.transfer([
    'client', 'agentescrow', '100.0000 XPR', 'fund:0'
  ]).send('client@active');
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('agentescrow', () => {

  beforeEach(() => {
    blockchain.resetTables();
  });

  /* ==================== Initialization ==================== */

  describe('init', () => {
    it('should initialize the contract', async () => {
      await agentescrow.actions.init(['owner', 'agentcore', 'agentfeed', 200]).send('agentescrow@active');
      const cfg = getConfig();
      expect(cfg.owner).to.equal('owner');
      expect(cfg.platform_fee).to.equal(200);
    });

    it('should allow re-initialization (overwrites config)', async () => {
      await agentescrow.actions.init(['owner', 'agentcore', 'agentfeed', 200]).send('agentescrow@active');
      await agentescrow.actions.init(['client', 'agentcore', 'agentfeed', 500]).send('agentescrow@active');
      const cfg = getConfig();
      expect(cfg.owner).to.equal('client');
      expect(cfg.platform_fee).to.equal(500);
    });

    it('should require contract auth', async () => {
      await expectToThrow(
        agentescrow.actions.init(['owner', 'agentcore', 'agentfeed', 200]).send('client@active'),
        'missing required authority agentescrow'
      );
    });
  });

  /* ==================== Arbitrator Registration ==================== */

  describe('regarb', () => {
    beforeEach(async () => {
      await initAll();
    });

    it('should register an arbitrator', async () => {
      await agentescrow.actions.regarb(['arbitrator1', 200]).send('arbitrator1@active');
      const arb = getArbitrator('arbitrator1');
      expect(arb).to.not.be.undefined;
      expect(arb.fee_percent).to.equal(200);
      expect(arb.active).to.equal(false);
    });

    it('should update fee on re-registration', async () => {
      await agentescrow.actions.regarb(['arbitrator1', 200]).send('arbitrator1@active');
      // regarb updates existing arbitrator instead of rejecting
      await agentescrow.actions.regarb(['arbitrator1', 300]).send('arbitrator1@active');
      const arb = getArbitrator('arbitrator1');
      expect(arb.fee_percent).to.equal(300);
    });

    it('should require auth', async () => {
      await expectToThrow(
        agentescrow.actions.regarb(['arbitrator1', 200]).send('client@active'),
        'missing required authority arbitrator1'
      );
    });

    it('should accept stake and activate', async () => {
      await registerArbitrator('arbitrator1');
      const arb = getArbitrator('arbitrator1');
      expect(arb.stake).to.equal(10000000);
      expect(arb.active).to.equal(true);
    });
  });

  /* ==================== Job Lifecycle ==================== */

  describe('job lifecycle', () => {
    beforeEach(async () => {
      await initAll();
      await registerArbitrator('arbitrator1');
    });

    it('should create a job', async () => {
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Test Job', 'Test description', '["deliverable1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'jobhash123'
      ]).send('client@active');

      const job = getJob(0);
      expect(job).to.not.be.undefined;
      expect(job.client).to.equal('client');
      expect(job.agent).to.equal('agent1');
      expect(job.state).to.equal(0); // CREATED
      expect(job.amount).to.equal(1000000);
    });

    it('should fund a job', async () => {
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Test Job', 'Test description', '["deliverable1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'jobhash123'
      ]).send('client@active');

      await eosioToken.actions.transfer([
        'client', 'agentescrow', '100.0000 XPR', 'fund:0'
      ]).send('client@active');

      const job = getJob(0);
      expect(job.funded_amount).to.equal(1000000);
      expect(job.state).to.equal(1); // FUNDED
    });

    it('should accept a funded job', async () => {
      await createAndFundJob();
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      const job = getJob(0);
      expect(job.state).to.equal(2); // ACCEPTED
    });

    it('should start an accepted job', async () => {
      await createAndFundJob();
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      const job = getJob(0);
      expect(job.state).to.equal(3); // ACTIVE
    });

    it('should deliver an active job', async () => {
      await createAndFundJob();
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://deliverables']).send('agent1@active');
      const job = getJob(0);
      expect(job.state).to.equal(4); // DELIVERED
    });

    it.skip('should approve a delivered job (inline token transfer triggers db access violation in vert)', async () => {
      await createAndFundJob();
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://deliverables']).send('agent1@active');
      await agentescrow.actions.approve(['client', 0]).send('client@active');
      const job = getJob(0);
      expect(job.state).to.equal(6); // COMPLETED
    });

    it('should reject accepting a non-funded job', async () => {
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Test Job', 'Test description', '["deliverable1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'jobhash123'
      ]).send('client@active');

      await expectToThrow(
        agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active'),
        protonAssert('Job must be funded to accept')
      );
    });

    it('should reject wrong agent accepting', async () => {
      await createAndFundJob();
      await expectToThrow(
        agentescrow.actions.acceptjob(['client', 0]).send('client@active'),
        protonAssert('Only assigned agent can accept')
      );
    });

    it('should cancel a created job', async () => {
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Test Job', 'Test description', '["deliverable1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'jobhash123'
      ]).send('client@active');

      await agentescrow.actions.cancel(['client', 0]).send('client@active');
      const job = getJob(0);
      expect(job.state).to.equal(7); // REFUNDED
    });
  });

  /* ==================== Milestones ==================== */

  describe('milestones', () => {
    beforeEach(async () => {
      await initAll();
      await registerArbitrator('arbitrator1');
    });

    it('should add a milestone to unfunded job', async () => {
      // Milestones can only be added to CREATED (unfunded) jobs
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Test Job', 'Test description', '["deliverable1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'jobhash123'
      ]).send('client@active');

      await agentescrow.actions.addmilestone([
        'client', 0, 'Phase 1', 'First phase', 500000, 1
      ]).send('client@active');

      const ms = getMilestone(0);
      expect(ms).to.not.be.undefined;
      expect(ms.title).to.equal('Phase 1');
      expect(ms.amount).to.equal(500000);
      expect(ms.state).to.equal(0); // pending
    });

    it('should reject milestone from non-client', async () => {
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Test Job', 'Test description', '["deliverable1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'jobhash123'
      ]).send('client@active');

      await expectToThrow(
        agentescrow.actions.addmilestone([
          'agent1', 0, 'Phase 1', 'First phase', 500000, 1
        ]).send('agent1@active'),
        protonAssert('Only client can add milestones')
      );
    });
  });

  /* ==================== Disputes ==================== */

  describe('disputes', () => {
    beforeEach(async () => {
      await initAll();
      await registerArbitrator('arbitrator1');
      await createAndFundJob();
      // Progress to DELIVERED state
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://deliverables']).send('agent1@active');
    });

    it('should raise a dispute', async () => {
      await agentescrow.actions.dispute([
        'client', 0, 'Low quality deliverables', 'ipfs://evidence'
      ]).send('client@active');

      const job = getJob(0);
      expect(job.state).to.equal(5); // DISPUTED
    });

    it.skip('should arbitrate a dispute (inline token transfer db access violation)', async () => {
      await agentescrow.actions.dispute([
        'client', 0, 'Low quality deliverables', 'ipfs://evidence'
      ]).send('client@active');

      // client_percent is 0-100 (not basis points)
      await agentescrow.actions.arbitrate([
        'arbitrator1', 0, 70, 'Partial delivery'
      ]).send('arbitrator1@active');

      const arb = getArbitrator('arbitrator1');
      expect(arb.total_cases).to.equal(1);
      expect(arb.successful_cases).to.equal(1);
    });

    it.skip('should track active_disputes counter (inline token transfer db access violation)', async () => {
      await agentescrow.actions.dispute([
        'client', 0, 'Low quality', 'ipfs://evidence'
      ]).send('client@active');

      const arbBefore = getArbitrator('arbitrator1');
      expect(arbBefore.active_disputes).to.equal(1);

      await agentescrow.actions.arbitrate([
        'arbitrator1', 0, 50, 'Split decision'
      ]).send('arbitrator1@active');

      const arbAfter = getArbitrator('arbitrator1');
      expect(arbAfter.active_disputes).to.equal(0);
    });

    it('should reject arbitration from wrong arbitrator', async () => {
      await agentescrow.actions.dispute([
        'client', 0, 'Low quality', 'ipfs://evidence'
      ]).send('client@active');

      await registerArbitrator('arbitrator2', 300);
      await expectToThrow(
        agentescrow.actions.arbitrate([
          'arbitrator2', 0, 50, 'Split'
        ]).send('arbitrator2@active'),
        protonAssert('Not authorized to arbitrate this job')
      );
    });
  });

  /* ==================== Arbitrator Unstaking ==================== */

  describe('arbitrator lifecycle', () => {
    beforeEach(async () => {
      await initAll();
      await registerArbitrator('arbitrator1');
    });

    it('should deactivate an arbitrator', async () => {
      await agentescrow.actions.deactarb(['arbitrator1']).send('arbitrator1@active');
      const arb = getArbitrator('arbitrator1');
      expect(arb.active).to.equal(false);
    });

    it('should reactivate an arbitrator', async () => {
      await agentescrow.actions.deactarb(['arbitrator1']).send('arbitrator1@active');
      await agentescrow.actions.activatearb(['arbitrator1']).send('arbitrator1@active');
      const arb = getArbitrator('arbitrator1');
      expect(arb.active).to.equal(true);
    });

    it('should request unstake', async () => {
      await agentescrow.actions.deactarb(['arbitrator1']).send('arbitrator1@active');
      await agentescrow.actions.unstakearb(['arbitrator1', 500000]).send('arbitrator1@active');
      const unstake = agentescrow.tables.arbunstakes(nameToBigInt('agentescrow')).getTableRow(nameToBigInt('arbitrator1'));
      expect(unstake).to.not.be.undefined;
      expect(unstake.amount).to.equal(500000);
    });

    it('should reject unstake with active disputes', async () => {
      await createAndFundJob();
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://deliverables']).send('agent1@active');
      await agentescrow.actions.dispute(['client', 0, 'Bad work', 'ipfs://ev']).send('client@active');

      await agentescrow.actions.deactarb(['arbitrator1']).send('arbitrator1@active');
      await expectToThrow(
        agentescrow.actions.unstakearb(['arbitrator1', 500000]).send('arbitrator1@active'),
        protonAssert('Cannot unstake while assigned to pending disputes')
      );
    });
  });

  /* ==================== setowner (governance) ==================== */

  describe('setowner', () => {
    beforeEach(async () => {
      await agentescrow.actions.init(['owner', 'agentcore', 'agentfeed', 200]).send('agentescrow@active');
    });

    it('should transfer contract ownership', async () => {
      await agentescrow.actions.setowner(['client']).send('owner@active');
      const cfg = getConfig();
      expect(cfg.owner).to.equal('client');
    });

    it('should reject from non-owner', async () => {
      await expectToThrow(
        agentescrow.actions.setowner(['client']).send('agent1@active'),
        'missing required authority owner'
      );
    });
  });

  /* ==================== setconfig ==================== */

  describe('setconfig', () => {
    beforeEach(async () => {
      await agentescrow.actions.init(['owner', 'agentcore', 'agentfeed', 200]).send('agentescrow@active');
    });

    it('should update config', async () => {
      // platform_fee, min_job_amount, default_deadline_days, dispute_window, paused
      await agentescrow.actions.setconfig([500, 10000, 30, 604800, false]).send('owner@active');
      const cfg = getConfig();
      expect(cfg.platform_fee).to.equal(500);
      expect(cfg.min_job_amount).to.equal(10000);
    });

    it('should pause the contract', async () => {
      await agentescrow.actions.setconfig([200, 10000, 30, 604800, true]).send('owner@active');
      const cfg = getConfig();
      expect(cfg.paused).to.equal(true);
    });

    it('should reject zero min_job_amount', async () => {
      await expectToThrow(
        agentescrow.actions.setconfig([200, 0, 30, 604800, false]).send('owner@active'),
        protonAssert('Minimum job amount must be positive')
      );
    });
  });
});

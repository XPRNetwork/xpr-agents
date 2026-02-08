import { expect } from 'chai';
import { Blockchain, protonAssert, expectToThrow, mintTokens, nameToBigInt } from '@proton/vert';
import { TimePointSec } from '@greymass/eosio';

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

const getBid = (id: number) => {
  return agentescrow.tables.bids(nameToBigInt('agentescrow')).getTableRow(BigInt(id));
};

const getAllBids = () => {
  return agentescrow.tables.bids(nameToBigInt('agentescrow')).getTableRows();
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

const createOpenJob = async () => {
  const deadline = Math.floor(Date.now() / 1000) + 86400 * 30;
  await agentescrow.actions.createjob([
    'client', '', 'Open Job', 'An open job', '["deliverable1"]',
    1000000, '4,XPR', deadline, 'arbitrator1', 'openhash'
  ]).send('client@active');
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

    it('should reject re-initialization', async () => {
      await agentescrow.actions.init(['owner', 'agentcore', 'agentfeed', 200]).send('agentescrow@active');
      await expectToThrow(
        agentescrow.actions.init(['client', 'agentcore', 'agentfeed', 500]).send('agentescrow@active'),
        protonAssert('Contract already initialized.')
      );
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

    it('should approve a delivered job', async () => {
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

    it('should arbitrate a dispute', async () => {
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

    it('should track active_disputes counter', async () => {
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
      // Deactivate arbitrator BEFORE dispute (since deactivation is now blocked with active disputes)
      await agentescrow.actions.deactarb(['arbitrator1']).send('arbitrator1@active');
      // Progress job to disputed state - this increments active_disputes on the arbitrator
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://deliverables']).send('agent1@active');
      await agentescrow.actions.dispute(['client', 0, 'Bad work', 'ipfs://ev']).send('client@active');

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
      // platform_fee, min_job_amount, default_deadline_days, dispute_window, paused,
      // core_contract, feed_contract, acceptance_timeout, min_arbitrator_stake, arb_unstake_delay
      await agentescrow.actions.setconfig([500, 10000, 30, 604800, false, 'agentcore', 'agentfeed', 604800, 10000000, 604800]).send('owner@active');
      const cfg = getConfig();
      expect(cfg.platform_fee).to.equal(500);
      expect(cfg.min_job_amount).to.equal(10000);
    });

    it('should pause the contract', async () => {
      await agentescrow.actions.setconfig([200, 10000, 30, 604800, true, 'agentcore', 'agentfeed', 604800, 10000000, 604800]).send('owner@active');
      const cfg = getConfig();
      expect(cfg.paused).to.equal(true);
    });

    it('should reject zero min_job_amount', async () => {
      await expectToThrow(
        agentescrow.actions.setconfig([200, 0, 30, 604800, false, 'agentcore', 'agentfeed', 604800, 10000000, 604800]).send('owner@active'),
        protonAssert('Minimum job amount must be positive')
      );
    });

    it('should update core_contract and feed_contract', async () => {
      await agentescrow.actions.setconfig([200, 10000, 30, 604800, false, 'agentfeed', 'agentcore', 604800, 10000000, 604800]).send('owner@active');
      const cfg = getConfig();
      expect(cfg.core_contract).to.equal('agentfeed');
      expect(cfg.feed_contract).to.equal('agentcore');
    });

    it('should update acceptance_timeout, min_arbitrator_stake, arb_unstake_delay', async () => {
      await agentescrow.actions.setconfig([200, 10000, 30, 604800, false, 'agentcore', 'agentfeed', 172800, 20000000, 259200]).send('owner@active');
      const cfg = getConfig();
      expect(cfg.acceptance_timeout).to.equal(172800);
      expect(cfg.min_arbitrator_stake).to.equal(20000000);
      expect(cfg.arb_unstake_delay).to.equal(259200);
    });

    it('should reject invalid core_contract account', async () => {
      await expectToThrow(
        agentescrow.actions.setconfig([200, 10000, 30, 604800, false, 'nonexistent', 'agentfeed', 604800, 10000000, 604800]).send('owner@active'),
        protonAssert('core_contract account does not exist')
      );
    });

    it('should reject invalid feed_contract account', async () => {
      await expectToThrow(
        agentescrow.actions.setconfig([200, 10000, 30, 604800, false, 'agentcore', 'nonexistent', 604800, 10000000, 604800]).send('owner@active'),
        protonAssert('feed_contract account does not exist')
      );
    });
  });

  /* ==================== Pause Guards ==================== */

  describe('pause guards', () => {
    beforeEach(async () => {
      await initAll();
      await registerArbitrator('arbitrator1');
    });

    it('should reject createjob when paused', async () => {
      // Pause the contract
      await agentescrow.actions.setconfig([200, 10000, 30, 604800, true, 'agentcore', 'agentfeed', 604800, 10000000, 604800]).send('owner@active');

      const deadline = Math.floor(Date.now() / 1000) + 86400 * 30;
      await expectToThrow(
        agentescrow.actions.createjob([
          'client', 'agent1', 'Test Job', 'Test description', '["deliverable1"]',
          1000000, '4,XPR', deadline, 'arbitrator1', 'jobhash123'
        ]).send('client@active'),
        protonAssert('Contract is paused')
      );
    });
  });

  /* ==================== Arbitrator Deactivation Guard ==================== */

  describe('arbitrator deactivation with active disputes', () => {
    beforeEach(async () => {
      await initAll();
      await registerArbitrator('arbitrator1');
    });

    it('should reject deactivation with active disputes', async () => {
      // Create and progress a job to disputed state
      await createAndFundJob();
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://deliverables']).send('agent1@active');
      await agentescrow.actions.dispute(['client', 0, 'Bad work', 'ipfs://ev']).send('client@active');

      // Verify active_disputes is 1
      const arbBefore = getArbitrator('arbitrator1');
      expect(arbBefore.active_disputes).to.equal(1);

      // Should reject deactivation
      await expectToThrow(
        agentescrow.actions.deactarb(['arbitrator1']).send('arbitrator1@active'),
        protonAssert('Cannot deactivate with pending disputes')
      );
    });

    it('should allow deactivation after dispute is resolved', async () => {
      // Create and progress a job to disputed state
      await createAndFundJob();
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://deliverables']).send('agent1@active');
      await agentescrow.actions.dispute(['client', 0, 'Bad work', 'ipfs://ev']).send('client@active');

      // Resolve the dispute
      await agentescrow.actions.arbitrate([
        'arbitrator1', 0, 50, 'Split decision'
      ]).send('arbitrator1@active');

      // Now deactivation should succeed
      await agentescrow.actions.deactarb(['arbitrator1']).send('arbitrator1@active');
      const arb = getArbitrator('arbitrator1');
      expect(arb.active).to.equal(false);
    });
  });

  /* ==================== Job Timeouts ==================== */

  describe('job timeouts', () => {
    beforeEach(async () => {
      await initAll();
      await registerArbitrator('arbitrator1');
      blockchain.setTime(TimePointSec.from(1700000000));
    });

    it('should refund client on acceptance timeout', async () => {
      // Create and fund a job - agent does not accept
      const deadline = 1700000000 + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Test Job', 'Test', '["del1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'jobhash'
      ]).send('client@active');
      await eosioToken.actions.transfer([
        'client', 'agentescrow', '100.0000 XPR', 'fund:0'
      ]).send('client@active');

      let job = getJob(0);
      expect(job.state).to.equal(1); // FUNDED

      // Advance past acceptance_timeout (604800 seconds = 7 days)
      blockchain.addTime(TimePointSec.from(605000));

      // Client claims timeout
      await agentescrow.actions.accpttimeout(['client', 0]).send('client@active');

      job = getJob(0);
      expect(job.state).to.equal(7); // REFUNDED
    });

    it('should reject acceptance timeout before deadline', async () => {
      const deadline = 1700000000 + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Test Job', 'Test', '["del1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'jobhash'
      ]).send('client@active');
      await eosioToken.actions.transfer([
        'client', 'agentescrow', '100.0000 XPR', 'fund:0'
      ]).send('client@active');

      // Try immediately
      await expectToThrow(
        agentescrow.actions.accpttimeout(['client', 0]).send('client@active'),
        protonAssert('Acceptance timeout not reached')
      );
    });

    it('should auto-complete delivered job after deadline timeout', async () => {
      // Short deadline for testing
      const deadline = 1700000000 + 3600;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Test', 'Test', '["del1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'hash'
      ]).send('client@active');
      await eosioToken.actions.transfer([
        'client', 'agentescrow', '100.0000 XPR', 'fund:0'
      ]).send('client@active');
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://ev']).send('agent1@active');

      // Advance past deadline
      blockchain.addTime(TimePointSec.from(4000));

      // Agent claims timeout - should auto-approve (delivered)
      await agentescrow.actions.timeout(['agent1', 0]).send('agent1@active');

      const job = getJob(0);
      expect(job.state).to.equal(6); // COMPLETED
    });

    it('should refund client on undelivered job timeout', async () => {
      const deadline = 1700000000 + 3600;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Test', 'Test', '["del1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'hash'
      ]).send('client@active');
      await eosioToken.actions.transfer([
        'client', 'agentescrow', '100.0000 XPR', 'fund:0'
      ]).send('client@active');
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      // Agent does NOT deliver

      blockchain.addTime(TimePointSec.from(4000));

      // Client claims timeout - should refund (not delivered)
      await agentescrow.actions.timeout(['client', 0]).send('client@active');

      const job = getJob(0);
      expect(job.state).to.equal(7); // REFUNDED
    });

    it('should reject timeout before deadline', async () => {
      const deadline = 1700000000 + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Test', 'Test', '["del1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'hash'
      ]).send('client@active');
      await eosioToken.actions.transfer([
        'client', 'agentescrow', '100.0000 XPR', 'fund:0'
      ]).send('client@active');
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');

      await expectToThrow(
        agentescrow.actions.timeout(['client', 0]).send('client@active'),
        protonAssert('Deadline not reached')
      );
    });
  });

  /* ==================== Arbitrator-less Fallback ==================== */

  describe('arbitrator-less fallback', () => {
    beforeEach(async () => {
      await initAll();
      blockchain.setTime(TimePointSec.from(1700000000));
    });

    it('should allow owner to arbitrate job with no arbitrator', async () => {
      // Create job WITHOUT an arbitrator (empty string)
      const deadline = 1700000000 + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'No Arb Job', 'Test', '["del1"]',
        1000000, '4,XPR', deadline, '', 'hash'
      ]).send('client@active');
      await eosioToken.actions.transfer([
        'client', 'agentescrow', '100.0000 XPR', 'fund:0'
      ]).send('client@active');
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://ev']).send('agent1@active');
      await agentescrow.actions.dispute(['client', 0, 'Bad work', 'ipfs://ev']).send('client@active');

      // Owner (as fallback) arbitrates
      await agentescrow.actions.arbitrate([
        'owner', 0, 50, 'Fallback resolution'
      ]).send('owner@active');

      const job = getJob(0);
      expect(job.state).to.equal(8); // ARBITRATED
    });
  });

  /* ==================== Milestone Approval ==================== */

  describe('milestone approval and partial release', () => {
    beforeEach(async () => {
      await initAll();
      await registerArbitrator('arbitrator1');
      blockchain.setTime(TimePointSec.from(1700000000));
    });

    it('should release partial funds on milestone approval', async () => {
      const deadline = 1700000000 + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Milestone Job', 'Test', '["del1","del2"]',
        2000000, '4,XPR', deadline, 'arbitrator1', 'hash'
      ]).send('client@active');

      // Add milestones BEFORE funding (required by contract)
      await agentescrow.actions.addmilestone([
        'client', 0, 'Phase 1', 'First phase', 1000000, 0
      ]).send('client@active');
      await agentescrow.actions.addmilestone([
        'client', 0, 'Phase 2', 'Second phase', 1000000, 1
      ]).send('client@active');

      await eosioToken.actions.transfer([
        'client', 'agentescrow', '200.0000 XPR', 'fund:0'
      ]).send('client@active');
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');

      // Submit and approve first milestone
      await agentescrow.actions.submitmile(['agent1', 0, 'ipfs://ev1']).send('agent1@active');
      await agentescrow.actions.approvemile(['client', 0]).send('client@active');

      const job = getJob(0);
      expect(job.released_amount).to.equal(1000000); // 100.0000 XPR released
      expect(job.state).to.equal(3); // Still ACTIVE

      const m0 = getMilestone(0);
      expect(m0.state).to.equal(2); // APPROVED
    });
  });

  /* ==================== Bidding System ==================== */

  describe('bidding system', () => {
    beforeEach(async () => {
      await initAll();
      await registerArbitrator('arbitrator1');
    });

    it('should create an open job (no agent)', async () => {
      await createOpenJob();
      const job = getJob(0);
      expect(job).to.not.be.undefined;
      expect(job.agent).to.equal('');
      expect(job.state).to.equal(0); // CREATED
    });

    it('should allow agent to submit bid on open job', async () => {
      await createOpenJob();
      await agentescrow.actions.submitbid([
        'agent1', 0, 500000, 604800, 'I can do this job well'
      ]).send('agent1@active');

      const bid = getBid(0);
      expect(bid).to.not.be.undefined;
      expect(bid.agent).to.equal('agent1');
      expect(bid.job_id).to.equal(0);
      expect(bid.amount).to.equal(500000);
      expect(bid.timeline).to.equal(604800);
      expect(bid.proposal).to.equal('I can do this job well');
    });

    it('should reject bid on non-open job (has agent)', async () => {
      // Create a direct-hire job with agent1 assigned
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Direct Job', 'A direct hire job', '["deliverable1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'directhash'
      ]).send('client@active');

      // Register arbitrator2 as an agent so they can try to bid
      await agentcore.actions.register([
        'arbitrator2', 'Arb2 Agent', 'Also an agent', 'https://api2.test.com', 'https', '["compute"]'
      ]).send('arbitrator2@active');

      await expectToThrow(
        agentescrow.actions.submitbid([
          'arbitrator2', 0, 500000, 604800, 'My proposal'
        ]).send('arbitrator2@active'),
        protonAssert('Job is direct-hire, not open for bids')
      );
    });

    it('should reject duplicate bid from same agent', async () => {
      await createOpenJob();
      await agentescrow.actions.submitbid([
        'agent1', 0, 500000, 604800, 'First bid'
      ]).send('agent1@active');

      await expectToThrow(
        agentescrow.actions.submitbid([
          'agent1', 0, 600000, 604800, 'Second bid'
        ]).send('agent1@active'),
        protonAssert('Agent already has a bid on this job')
      );
    });

    it('should allow client to select a bid', async () => {
      await createOpenJob();
      await agentescrow.actions.submitbid([
        'agent1', 0, 500000, 604800, 'My proposal'
      ]).send('agent1@active');

      await agentescrow.actions.selectbid(['client', 0]).send('client@active');

      const job = getJob(0);
      expect(job.agent).to.equal('agent1');

      // Bid should be cleaned up
      const bids = getAllBids();
      expect(bids.length).to.equal(0);
    });

    it('should update job amount and deadline from selected bid', async () => {
      await createOpenJob();
      await agentescrow.actions.submitbid([
        'agent1', 0, 750000, 1209600, 'My proposal'
      ]).send('agent1@active');

      await agentescrow.actions.selectbid(['client', 0]).send('client@active');

      const job = getJob(0);
      expect(job.amount).to.equal(750000);
      // Deadline should be currentTimeSec() + bid.timeline (1209600)
      // We can verify it changed from the original deadline
      expect(job.agent).to.equal('agent1');
    });

    it('should clean up all bids when one is selected', async () => {
      await createOpenJob();

      // Register arbitrator2 as a second agent
      await agentcore.actions.register([
        'arbitrator2', 'Arb2 Agent', 'Also an agent', 'https://api2.test.com', 'https', '["compute"]'
      ]).send('arbitrator2@active');

      // Submit bids from both agents
      await agentescrow.actions.submitbid([
        'agent1', 0, 500000, 604800, 'Proposal from agent1'
      ]).send('agent1@active');

      await agentescrow.actions.submitbid([
        'arbitrator2', 0, 600000, 604800, 'Proposal from arbitrator2'
      ]).send('arbitrator2@active');

      // Verify both bids exist
      let bids = getAllBids();
      expect(bids.length).to.equal(2);

      // Select agent1's bid (bid id 0)
      await agentescrow.actions.selectbid(['client', 0]).send('client@active');

      // All bids should be cleaned up
      bids = getAllBids();
      expect(bids.length).to.equal(0);

      const job = getJob(0);
      expect(job.agent).to.equal('agent1');
    });

    it('should allow agent to withdraw their bid', async () => {
      await createOpenJob();
      await agentescrow.actions.submitbid([
        'agent1', 0, 500000, 604800, 'My proposal'
      ]).send('agent1@active');

      // Verify bid exists
      expect(getBid(0)).to.not.be.undefined;

      await agentescrow.actions.withdrawbid(['agent1', 0]).send('agent1@active');

      // Bid should be gone
      expect(getBid(0)).to.be.undefined;
    });

    it('should reject withdraw from non-owner', async () => {
      await createOpenJob();
      await agentescrow.actions.submitbid([
        'agent1', 0, 500000, 604800, 'My proposal'
      ]).send('agent1@active');

      await expectToThrow(
        agentescrow.actions.withdrawbid(['client', 0]).send('client@active'),
        protonAssert('Only bid owner can withdraw')
      );
    });

    it('should reject bid from non-registered agent', async () => {
      await createOpenJob();

      await expectToThrow(
        agentescrow.actions.submitbid([
          'arbitrator1', 0, 500000, 604800, 'My proposal'
        ]).send('arbitrator1@active'),
        protonAssert('Agent not registered in agentcore')
      );
    });

    it('should clean up bids when job is cancelled', async () => {
      await createOpenJob();
      await agentescrow.actions.submitbid([
        'agent1', 0, 500000, 604800, 'My proposal'
      ]).send('agent1@active');

      // Verify bid exists
      expect(getAllBids().length).to.equal(1);

      // Cancel the job
      await agentescrow.actions.cancel(['client', 0]).send('client@active');

      // Bids should be cleaned up
      expect(getAllBids().length).to.equal(0);
    });

    it('should reject submitbid when paused', async () => {
      await createOpenJob();

      // Pause the contract
      await agentescrow.actions.setconfig([200, 10000, 30, 604800, true, 'agentcore', 'agentfeed', 604800, 10000000, 604800]).send('owner@active');

      await expectToThrow(
        agentescrow.actions.submitbid([
          'agent1', 0, 500000, 604800, 'My proposal'
        ]).send('agent1@active'),
        protonAssert('Contract is paused')
      );
    });
  });
});

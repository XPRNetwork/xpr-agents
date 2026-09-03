import { expect } from 'chai';
import { Blockchain, protonAssert, expectToThrow, mintTokens, nameToBigInt } from '@proton/vert';
import { TimePointSec, Transaction, Serializer, Name as EosName, PermissionLevel } from '@greymass/eosio';

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

const getAllJobs = () => {
  return agentescrow.tables.jobs(nameToBigInt('agentescrow')).getTableRows();
};

const getAllMilestones = () => {
  return agentescrow.tables.milestones(nameToBigInt('agentescrow')).getTableRows();
};

const getAllDisputes = () => {
  return agentescrow.tables.disputes(nameToBigInt('agentescrow')).getTableRows();
};

const getJobEvidence = (jobId: number) => {
  return agentescrow.tables.jobevidence(nameToBigInt('agentescrow')).getTableRow(BigInt(jobId));
};

const getJobMessage = (id: number) => {
  return agentescrow.tables.jobmsgs(nameToBigInt('agentescrow')).getTableRow(BigInt(id));
};

const getAllJobMessages = () => {
  return agentescrow.tables.jobmsgs(nameToBigInt('agentescrow')).getTableRows();
};

const getServiceInput = (serviceId: number) => {
  return agentescrow.tables.svcinputs(nameToBigInt('agentescrow')).getTableRow(BigInt(serviceId));
};

const getLastBuy = (client: string) => {
  return agentescrow.tables.lastbuys(nameToBigInt('agentescrow')).getTableRow(nameToBigInt(client));
};

/* Build one transaction out of several actions, so a buy transfer and the
 * svcinput that answers its form are signed together (as the site does). */
const encodeAction = (contract: any, name: string, data: any[], auth: string) => {
  const resolved = contract.abi.resolveType(name);
  const object: any = {};
  data.forEach((arg, i) => { object[resolved.fields[i].name] = arg; });
  return {
    account: contract.name,
    name: EosName.from(name),
    data: Serializer.encode({ abi: contract.abi, type: name, object }).array,
    authorization: [PermissionLevel.from(auth)],
  };
};

const sendTransaction = async (actions: any[]) => {
  await blockchain.applyTransaction(Transaction.from({
    actions,
    expiration: 0,
    ref_block_num: 0,
    ref_block_prefix: 0,
  } as any));
};

const getService = (id: number) => {
  return agentescrow.tables.services(nameToBigInt('agentescrow')).getTableRow(BigInt(id));
};

const getAllServices = () => {
  return agentescrow.tables.services(nameToBigInt('agentescrow')).getTableRows();
};

const getSvcDeposit = (agent: string) => {
  return agentescrow.tables.svcdeposits(nameToBigInt('agentescrow')).getTableRow(nameToBigInt(agent));
};

const getSvcConfig = () => {
  return agentescrow.tables.svcconfig(nameToBigInt('agentescrow')).getTableRows()[0];
};

const getBalance = (account: string) => {
  const rows = eosioToken.tables.accounts(nameToBigInt(account)).getTableRows();
  return rows.length > 0 ? rows[0].balance : '0.0000 XPR';
};

/* XPR balance as a number, for before/after comparisons */
const getXprBalance = (account: string) => parseFloat(getBalance(account).split(' ')[0]);

/* Register a second agent in agentcore */
const registerAgent = async (name: string) => {
  await agentcore.actions.register([
    name, 'Second Agent', 'Another test agent', 'https://api2.test.com', 'https', '["chat"]'
  ]).send(`${name}@active`);
};

/* Give an agent an owner by writing agentcore's row directly — the real claim
 * flow needs the eosio.proton KYC tables, which this blockchain does not stub. */
const setAgentOwner = (agentName: string, ownerName: string) => {
  const scope = nameToBigInt('agentcore');
  const row: any = agentcore.tables.agents(scope).getTableRow(nameToBigInt(agentName));
  agentcore.tables.agents(scope).set(
    nameToBigInt(agentName),
    'agentcore' as any,
    Object.assign({}, row, { owner: ownerName })
  );
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

      // Advance past deadline — still inside the client's 3-day dispute window
      blockchain.addTime(TimePointSec.from(4000));
      await expectToThrow(
        agentescrow.actions.timeout(['agent1', 0]).send('agent1@active'),
        protonAssert('Client dispute window still open')
      );

      // Once the dispute window has closed the agent can auto-approve
      blockchain.addTime(TimePointSec.from(259200));
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

  /* ------------------------------------------------------------------ */
  /*  removejob (admin cleanup)                                          */
  /* ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------ */
  /*  re-delivery + revise                                               */
  /* ------------------------------------------------------------------ */
  describe('re-delivery and revise', () => {
    beforeEach(async () => {
      blockchain.setTime(TimePointSec.from(1700000000));
      await initAll();
      await registerArbitrator('arbitrator1');
      await createAndFundJob();
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://v1']).send('agent1@active');
    });

    it('should let the agent re-deliver while DELIVERED and restart the dispute window', async () => {
      const before = getJob(0);
      blockchain.addTime(TimePointSec.from(3600));
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://v2']).send('agent1@active');
      const job = getJob(0);
      expect(job.state).to.equal(4);
      expect(job.updated_at).to.be.greaterThan(before.updated_at);
      expect(getJobEvidence(0).evidence_uri).to.equal('ipfs://v2');
    });

    it('should reject re-delivery from someone other than the agent', async () => {
      await expectToThrow(
        agentescrow.actions.deliver(['client', 0, 'ipfs://v2']).send('client@active'),
        protonAssert('Only assigned agent can deliver')
      );
    });

    it('should let the client send a delivery back for revision', async () => {
      await agentescrow.actions.revise(['client', 0, 'PNG is missing the legend']).send('client@active');
      const job = getJob(0);
      expect(job.state).to.equal(3); // INPROGRESS
      // agent can deliver again
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://v2']).send('agent1@active');
      expect(getJob(0).state).to.equal(4);
      expect(getJobEvidence(0).evidence_uri).to.equal('ipfs://v2');
    });

    it('should reject revise once the dispute window has passed', async () => {
      // Move to just before the 30-day deadline, then revise
      blockchain.addTime(TimePointSec.from(86400 * 30 - 600));
      // Dispute window (3 days) has passed since delivery — revise is no longer allowed
      await expectToThrow(
        agentescrow.actions.revise(['client', 0, 'late change']).send('client@active'),
        protonAssert('Dispute window has passed - approve or dispute instead')
      );
    });

    it('should bump a near deadline on revise', async () => {
      // deliver again so the window is fresh, then jump close to the deadline in one step
      const job0 = getJob(0);
      const deadline = Number(job0.deadline);
      const now = Number(job0.updated_at);
      // advance to deadline - 1h (still inside 3d window? no: 30d > 3d). Use a fresh delivery instead:
      blockchain.addTime(TimePointSec.from(deadline - now - 3600));
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://v2']).send('agent1@active');
      await agentescrow.actions.revise(['client', 0, 'one more change']).send('client@active');
      const job = getJob(0);
      expect(job.state).to.equal(3);
      expect(Number(job.deadline)).to.be.greaterThanOrEqual(Number(job.updated_at) + 259200);
    });

    it('should reject revise from non-client', async () => {
      await expectToThrow(
        agentescrow.actions.revise(['agent1', 0, 'notes']).send('agent1@active'),
        protonAssert('Only client can request revisions')
      );
    });

    it('should reject revise when job is not delivered', async () => {
      await agentescrow.actions.revise(['client', 0, 'notes']).send('client@active');
      await expectToThrow(
        agentescrow.actions.revise(['client', 0, 'notes again']).send('client@active'),
        protonAssert('Job must be delivered')
      );
    });

    it('should reject empty revision notes', async () => {
      await expectToThrow(
        agentescrow.actions.revise(['client', 0, '']).send('client@active'),
        protonAssert('Notes must be 1-512 characters')
      );
    });

    it('should block the agent timeout claim while the dispute window is open', async () => {
      // Jump past the deadline but re-deliver first so the window is fresh
      const job0 = getJob(0);
      blockchain.addTime(TimePointSec.from(Number(job0.deadline) - Number(job0.updated_at) - 60));
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://v2']).send('agent1@active');
      blockchain.addTime(TimePointSec.from(120)); // now past deadline, inside window
      await expectToThrow(
        agentescrow.actions.timeout(['agent1', 0]).send('agent1@active'),
        protonAssert('Client dispute window still open')
      );
      blockchain.addTime(TimePointSec.from(259200));
      await agentescrow.actions.timeout(['agent1', 0]).send('agent1@active');
      expect(getJob(0).state).to.equal(6);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  review hardening: funding, bids, owner checks, removejob           */
  /* ------------------------------------------------------------------ */
  describe('review hardening', () => {
    beforeEach(async () => {
      blockchain.setTime(TimePointSec.from(1700000000));
      await initAll();
      await registerArbitrator('arbitrator1');
    });

    it('should reject funding an open job before a bid is selected', async () => {
      await createOpenJob();
      await expectToThrow(
        eosioToken.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'fund:0']).send('client@active'),
        protonAssert('Select a bid before funding an open job')
      );
    });

    it('should reject bids below the minimum job amount', async () => {
      await createOpenJob();
      await expectToThrow(
        agentescrow.actions.submitbid(['agent1', 0, 5000, 604800, 'cheap']).send('agent1@active'),
        protonAssert('Bid amount below minimum job amount')
      );
    });

    it('should reject bid timelines outside 1h..1y', async () => {
      await createOpenJob();
      await expectToThrow(
        agentescrow.actions.submitbid(['agent1', 0, 500000, 60, 'fast']).send('agent1@active'),
        protonAssert('Timeline must be at least 1 hour')
      );
      await expectToThrow(
        agentescrow.actions.submitbid(['agent1', 0, 500000, 31536001, 'slow']).send('agent1@active'),
        protonAssert('Timeline must be at most 1 year')
      );
    });

    it('should reject a bid amount below the milestone total', async () => {
      await createOpenJob();
      await agentescrow.actions.addmilestone(['client', 0, 'M1', 'first half', 600000, 0]).send('client@active');
      await agentescrow.actions.submitbid(['agent1', 0, 500000, 604800, 'under the milestone']).send('agent1@active');
      await expectToThrow(
        agentescrow.actions.selectbid(['client', 0]).send('client@active'),
        protonAssert('Bid amount below milestone total')
      );
    });

    it('should release the arbitrator dispute slot when an admin removes a disputed job', async () => {
      await createAndFundJob();
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://d']).send('agent1@active');
      await agentescrow.actions.dispute(['client', 0, 'bad', 'ipfs://e']).send('client@active');
      expect(getArbitrator('arbitrator1').active_disputes).to.equal(1);
      await agentescrow.actions.removejob([0]).send('owner@active');
      expect(getArbitrator('arbitrator1').active_disputes).to.equal(0);
    });
  });

  describe('removejob', () => {
    beforeEach(async () => {
      await initAll();
      await registerArbitrator('arbitrator1');
    });

    const completeJob = async () => {
      await createAndFundJob();
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://evidence']).send('agent1@active');
      await agentescrow.actions.approve(['client', 0]).send('client@active');
    };

    const cancelJob = async () => {
      await createAndFundJob();
      await agentescrow.actions.cancel(['client', 0]).send('client@active');
    };

    it('should remove a completed job (state 6)', async () => {
      await completeJob();
      expect(getJob(0)).to.not.be.undefined;
      expect(getJob(0).state).to.equal(6);

      await agentescrow.actions.removejob([0]).send('owner@active');
      expect(getJob(0)).to.be.undefined;
    });

    it('should remove a refunded job (state 7)', async () => {
      await cancelJob();
      expect(getJob(0)).to.not.be.undefined;
      expect(getJob(0).state).to.equal(7);

      await agentescrow.actions.removejob([0]).send('owner@active');
      expect(getJob(0)).to.be.undefined;
    });

    it('should remove an arbitrated job (state 8)', async () => {
      await createAndFundJob();
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.dispute(['client', 0, 'Bad work', 'ipfs://proof']).send('client@active');
      await agentescrow.actions.arbitrate(['arbitrator1', 0, 100, 'Client wins']).send('arbitrator1@active');
      expect(getJob(0).state).to.equal(8);

      await agentescrow.actions.removejob([0]).send('owner@active');
      expect(getJob(0)).to.be.undefined;
    });

    it('should reject non-owner auth', async () => {
      await completeJob();

      await expectToThrow(
        agentescrow.actions.removejob([0]).send('client@active'),
        'missing required authority owner'
      );
    });

    it('should remove unfunded job (state 0)', async () => {
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Test Job', 'Test description', '["deliverable1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'hash'
      ]).send('client@active');
      expect(getJob(0)).to.not.be.undefined;

      await agentescrow.actions.removejob([0]).send('owner@active');
      expect(getJob(0)).to.be.undefined;
    });

    it('should remove funded job and refund client (state 1)', async () => {
      await createAndFundJob();
      expect(getJob(0).state).to.equal(1);

      await agentescrow.actions.removejob([0]).send('owner@active');
      expect(getJob(0)).to.be.undefined;
    });

    it('should remove in-progress job and refund client (state 3)', async () => {
      await createAndFundJob();
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      expect(getJob(0).state).to.equal(3);

      await agentescrow.actions.removejob([0]).send('owner@active');
      expect(getJob(0)).to.be.undefined;
    });

    it('should reject non-existent job', async () => {
      await expectToThrow(
        agentescrow.actions.removejob([999]).send('owner@active'),
        protonAssert('Job not found')
      );
    });

    it('should clean up milestones', async () => {
      // Create unfunded job, add milestones, then cancel
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Test Job', 'Test description', '["deliverable1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'hash'
      ]).send('client@active');
      await agentescrow.actions.addmilestone(['client', 0, 'M1', 'First milestone', 500000, 1]).send('client@active');
      await agentescrow.actions.addmilestone(['client', 0, 'M2', 'Second milestone', 500000, 2]).send('client@active');
      expect(getAllMilestones().length).to.equal(2);

      // Cancel (state 0 → 7), cancel cleans milestones too
      await agentescrow.actions.cancel(['client', 0]).send('client@active');

      await agentescrow.actions.removejob([0]).send('owner@active');
      expect(getJob(0)).to.be.undefined;
      expect(getAllMilestones().length).to.equal(0);
    });

    it('should clean up job evidence', async () => {
      await completeJob();
      // completeJob calls deliver which stores evidence
      expect(getJobEvidence(0)).to.not.be.undefined;

      await agentescrow.actions.removejob([0]).send('owner@active');
      expect(getJob(0)).to.be.undefined;
      expect(getJobEvidence(0)).to.be.undefined;
    });

    it('should clean up disputes', async () => {
      await createAndFundJob();
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.dispute(['client', 0, 'Bad work', 'ipfs://proof']).send('client@active');
      await agentescrow.actions.arbitrate(['arbitrator1', 0, 100, 'Client wins']).send('arbitrator1@active');
      expect(getAllDisputes().length).to.equal(1);

      await agentescrow.actions.removejob([0]).send('owner@active');
      expect(getJob(0)).to.be.undefined;
      expect(getAllDisputes().length).to.equal(0);
    });
  });

  /* ==================== Cleanup (owner only) ==================== */

  describe('cleanup auth', () => {
    beforeEach(async () => {
      await initAll();
    });

    it('should reject cleanjobs from a non-owner', async () => {
      await expectToThrow(
        agentescrow.actions.cleanjobs([7776000, 10]).send('agent1@active'),
        'missing required authority owner'
      );
    });

    it('should reject cleandisps from a non-owner', async () => {
      await expectToThrow(
        agentescrow.actions.cleandisps([7776000, 10]).send('client@active'),
        'missing required authority owner'
      );
    });

    it('should reject max_age above maximum (u64 wrap on now - max_age)', async () => {
      await expectToThrow(
        agentescrow.actions.cleanjobs(['18446744073709551615', 10]).send('owner@active'),
        'eosio_assert: Max age must be at most 10 years (315360000 seconds)'
      );
      await expectToThrow(
        agentescrow.actions.cleandisps(['18446744073709551615', 10]).send('owner@active'),
        'eosio_assert: Max age must be at most 10 years (315360000 seconds)'
      );
    });

    it('should allow cleanjobs from the owner', async () => {
      await agentescrow.actions.cleanjobs([7776000, 10]).send('owner@active');
    });
  });

  /* ==================== Job messages ==================== */

  describe('job messages', () => {
    const PAUSE_CONFIG = [200, 10000, 30, 604800, true, 'agentcore', 'agentfeed', 604800, 10000000, 604800];

    beforeEach(async () => {
      blockchain.setTime(TimePointSec.from(1700000000));
      await initAll();
      await registerArbitrator('arbitrator1');
      await createAndFundJob(); // job 0, state 1 (FUNDED), client=client, agent=agent1
    });

    it('should let the assigned agent ask the client', async () => {
      await agentescrow.actions.askclient([
        'agent1', 0, 'Which file format do you want?'
      ]).send('agent1@active');

      const msg = getJobMessage(0);
      expect(msg).to.not.be.undefined;
      expect(msg.job_id).to.equal(0);
      expect(msg.author).to.equal('agent1');
      expect(msg.text).to.equal('Which file format do you want?');
      expect(msg.created_at).to.equal(1700000000);
    });

    it('should let the client answer', async () => {
      await agentescrow.actions.askclient(['agent1', 0, 'SVG or PNG?']).send('agent1@active');
      await agentescrow.actions.answer(['client', 0, 'SVG please']).send('client@active');

      expect(getAllJobMessages().length).to.equal(2);
      const reply = getJobMessage(1);
      expect(reply.job_id).to.equal(0);
      expect(reply.author).to.equal('client');
      expect(reply.text).to.equal('SVG please');
    });

    it('should allow messages in ACCEPTED and INPROGRESS', async () => {
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      expect(getJob(0).state).to.equal(2);
      await agentescrow.actions.askclient(['agent1', 0, 'Question in accepted']).send('agent1@active');

      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      expect(getJob(0).state).to.equal(3);
      await agentescrow.actions.answer(['client', 0, 'Answer in progress']).send('client@active');

      expect(getAllJobMessages().length).to.equal(2);
    });

    it('should reject a question from someone who is not the assigned agent', async () => {
      await expectToThrow(
        agentescrow.actions.askclient(['client', 0, 'Not my job']).send('client@active'),
        protonAssert('Only the assigned agent can ask')
      );
    });

    it('should reject an answer from someone who is not the client', async () => {
      await expectToThrow(
        agentescrow.actions.answer(['agent1', 0, 'Not my job']).send('agent1@active'),
        protonAssert('Only the client can answer')
      );
    });

    it('should require the caller authority', async () => {
      await expectToThrow(
        agentescrow.actions.askclient(['agent1', 0, 'Spoofed']).send('client@active'),
        'missing required authority agent1'
      );
      await expectToThrow(
        agentescrow.actions.answer(['client', 0, 'Spoofed']).send('agent1@active'),
        'missing required authority client'
      );
    });

    it('should reject an unknown job', async () => {
      await expectToThrow(
        agentescrow.actions.askclient(['agent1', 99, 'Hello?']).send('agent1@active'),
        protonAssert('Job not found')
      );
    });

    it('should reject messages on a delivered job', async () => {
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://QmDone']).send('agent1@active');
      expect(getJob(0).state).to.equal(4);

      await expectToThrow(
        agentescrow.actions.askclient(['agent1', 0, 'One more thing']).send('agent1@active'),
        protonAssert('Job must be funded, accepted or in progress')
      );
      await expectToThrow(
        agentescrow.actions.answer(['client', 0, 'One more thing']).send('client@active'),
        protonAssert('Job must be funded, accepted or in progress')
      );
    });

    it('should reject messages on a completed job', async () => {
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://QmDone']).send('agent1@active');
      await agentescrow.actions.approve(['client', 0]).send('client@active');
      expect(getJob(0).state).to.equal(6);

      await expectToThrow(
        agentescrow.actions.askclient(['agent1', 0, 'Anything else?']).send('agent1@active'),
        protonAssert('Job must be funded, accepted or in progress')
      );
      await expectToThrow(
        agentescrow.actions.answer(['client', 0, 'Anything else?']).send('client@active'),
        protonAssert('Job must be funded, accepted or in progress')
      );
    });

    it('should reject messages on a job that was created but never funded (state 0)', async () => {
      const deadline = 1700000000 + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Unfunded', 'Not funded yet', '["d1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'unfundedhash'
      ]).send('client@active');
      expect(getJob(1).state).to.equal(0);

      await expectToThrow(
        agentescrow.actions.askclient(['agent1', 1, 'Too early']).send('agent1@active'),
        protonAssert('Job must be funded, accepted or in progress')
      );
    });

    it('should reject messages when the contract is paused', async () => {
      await agentescrow.actions.setconfig(PAUSE_CONFIG).send('owner@active');

      await expectToThrow(
        agentescrow.actions.askclient(['agent1', 0, 'Hello?']).send('agent1@active'),
        protonAssert('Contract is paused')
      );
      await expectToThrow(
        agentescrow.actions.answer(['client', 0, 'Hello?']).send('client@active'),
        protonAssert('Contract is paused')
      );
    });

    it('should reject empty text', async () => {
      await expectToThrow(
        agentescrow.actions.askclient(['agent1', 0, '']).send('agent1@active'),
        protonAssert('Message must be 1-512 characters')
      );
      await expectToThrow(
        agentescrow.actions.answer(['client', 0, '']).send('client@active'),
        protonAssert('Message must be 1-512 characters')
      );
    });

    it('should accept 512 characters and reject 513', async () => {
      await agentescrow.actions.askclient(['agent1', 0, 'q'.repeat(512)]).send('agent1@active');
      expect(getJobMessage(0).text.length).to.equal(512);

      await expectToThrow(
        agentescrow.actions.answer(['client', 0, 'a'.repeat(513)]).send('client@active'),
        protonAssert('Message must be 1-512 characters')
      );
    });

    it('should cap a job at 20 messages', async () => {
      for (let i = 0; i < 10; i++) {
        await agentescrow.actions.askclient(['agent1', 0, `q${i}`]).send('agent1@active');
        await agentescrow.actions.answer(['client', 0, `a${i}`]).send('client@active');
      }
      expect(getAllJobMessages().length).to.equal(20);

      await expectToThrow(
        agentescrow.actions.askclient(['agent1', 0, 'one too many']).send('agent1@active'),
        protonAssert('Job message limit reached')
      );
      await expectToThrow(
        agentescrow.actions.answer(['client', 0, 'one too many']).send('client@active'),
        protonAssert('Job message limit reached')
      );
      expect(getAllJobMessages().length).to.equal(20);
    });

    it('should count messages per job, not globally', async () => {
      // A second funded job keeps its own quota
      const deadline = 1700000000 + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Job two', 'Second job', '["d1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'jobhash2'
      ]).send('client@active');
      await eosioToken.actions.transfer([
        'client', 'agentescrow', '100.0000 XPR', 'fund:1'
      ]).send('client@active');

      await agentescrow.actions.askclient(['agent1', 0, 'about job 0']).send('agent1@active');
      await agentescrow.actions.askclient(['agent1', 1, 'about job 1']).send('agent1@active');

      const rows = getAllJobMessages();
      expect(rows.length).to.equal(2);
      expect(rows[0].job_id).to.equal(0);
      expect(rows[1].job_id).to.equal(1);
    });

    it('should delete a job\'s messages on removejob', async () => {
      await agentescrow.actions.askclient(['agent1', 0, 'Which format?']).send('agent1@active');
      await agentescrow.actions.answer(['client', 0, 'SVG']).send('client@active');
      expect(getAllJobMessages().length).to.equal(2);

      await agentescrow.actions.removejob([0]).send('owner@active');

      expect(getJob(0)).to.be.undefined;
      expect(getAllJobMessages().length).to.equal(0);
    });

    it('should keep other jobs messages on removejob', async () => {
      const deadline = 1700000000 + 86400 * 30;
      await agentescrow.actions.createjob([
        'client', 'agent1', 'Job two', 'Second job', '["d1"]',
        1000000, '4,XPR', deadline, 'arbitrator1', 'jobhash2'
      ]).send('client@active');
      await eosioToken.actions.transfer([
        'client', 'agentescrow', '100.0000 XPR', 'fund:1'
      ]).send('client@active');

      await agentescrow.actions.askclient(['agent1', 0, 'about job 0']).send('agent1@active');
      await agentescrow.actions.askclient(['agent1', 1, 'about job 1']).send('agent1@active');

      await agentescrow.actions.removejob([0]).send('owner@active');

      const rows = getAllJobMessages();
      expect(rows.length).to.equal(1);
      expect(rows[0].job_id).to.equal(1);
      expect(rows[0].text).to.equal('about job 1');
    });

    it('should leave messages in place on approve (history)', async () => {
      await agentescrow.actions.askclient(['agent1', 0, 'Which format?']).send('agent1@active');
      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://QmDone']).send('agent1@active');
      await agentescrow.actions.approve(['client', 0]).send('client@active');

      expect(getAllJobMessages().length).to.equal(1);
    });

    it('should delete a job\'s messages on cleanjobs', async () => {
      await agentescrow.actions.askclient(['agent1', 0, 'Which format?']).send('agent1@active');
      await agentescrow.actions.answer(['client', 0, 'SVG']).send('client@active');

      await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', 0, 'ipfs://QmDone']).send('agent1@active');
      await agentescrow.actions.approve(['client', 0]).send('client@active');
      expect(getJob(0).state).to.equal(6);
      expect(getAllJobMessages().length).to.equal(2);

      // Age the job past the 90-day minimum
      blockchain.addTime(TimePointSec.from(7776000 + 3600));
      await agentescrow.actions.cleanjobs([7776000, 10]).send('owner@active');

      expect(getJob(0)).to.be.undefined;
      expect(getAllJobMessages().length).to.equal(0);
    });
  });

  /* ==================== Services market ==================== */

  describe('services market', () => {
    const SVC = {
      agent: 'agent1',
      title: 'Logo design',
      description: 'A hand-crafted logo delivered as SVG and PNG',
      deliverables: '["logo.svg","logo.png"]',
      price: 1000000,      // 100.0000 XPR
      turnaround: 86400,   // 1 day
      category: 'image',
      sample_uri: 'ipfs://QmSample',
    };

    const svcArgs = (o: any = {}) => {
      const s: any = Object.assign({}, SVC, o);
      return [s.agent, s.title, s.description, s.deliverables, s.price, s.turnaround, s.category, s.sample_uri];
    };

    /* Pay the listing fee deposit (default 5.0000 XPR) */
    const payListingFee = async (agent: string = 'agent1', amount: string = '5.0000 XPR') => {
      await eosioToken.actions.transfer([agent, 'agentescrow', amount, `svcfee:${agent}`]).send(`${agent}@active`);
    };

    const listSvc = async (o: any = {}) => {
      const s: any = Object.assign({}, SVC, o);
      if (o.skipFee !== true) await payListingFee(s.agent);
      await agentescrow.actions.listsvc(svcArgs(o)).send(`${s.agent}@active`);
    };

    /* Give agent1 one completed job so its listings can be featured */
    const completeOneJob = async () => {
      await eosioToken.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'buy:0']).send('client@active');
      const jobId = getAllJobs().length - 1;
      await agentescrow.actions.acceptjob(['agent1', jobId]).send('agent1@active');
      await agentescrow.actions.startjob(['agent1', jobId]).send('agent1@active');
      await agentescrow.actions.deliver(['agent1', jobId, 'ipfs://QmDone']).send('agent1@active');
      await agentescrow.actions.approve(['client', jobId]).send('client@active');
    };

    const updateArgs = (id: number, o: any = {}) => {
      const s: any = Object.assign({}, SVC, o);
      return [s.agent, id, s.title, s.description, s.deliverables, s.price, s.turnaround, s.category, s.sample_uri];
    };

    beforeEach(async () => {
      blockchain.setTime(TimePointSec.from(1700000000));
      await initAll();
    });

    /* ---------------- listsvc ---------------- */

    describe('listsvc', () => {
      it('should list a service', async () => {
        await listSvc();

        const svc = getService(0);
        expect(svc).to.not.be.undefined;
        expect(svc.agent).to.equal('agent1');
        expect(svc.title).to.equal('Logo design');
        expect(svc.description).to.equal('A hand-crafted logo delivered as SVG and PNG');
        expect(svc.deliverables).to.equal('["logo.svg","logo.png"]');
        expect(svc.price).to.equal(1000000);
        expect(svc.turnaround).to.equal(86400);
        expect(svc.category).to.equal('image');
        expect(svc.sample_uri).to.equal('ipfs://QmSample');
        expect(svc.active).to.equal(true);
        expect(svc.sales).to.equal(0);
        expect(svc.created_at).to.be.greaterThan(0);
        expect(svc.updated_at).to.equal(svc.created_at);
      });

      it('should allow an empty category and sample_uri', async () => {
        await listSvc({ category: '', sample_uri: '' });
        const svc = getService(0);
        expect(svc.category).to.equal('');
        expect(svc.sample_uri).to.equal('');
      });

      it('should require the agent authority', async () => {
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs()).send('client@active'),
          'missing required authority agent1'
        );
      });

      it('should reject an unregistered agent', async () => {
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs({ agent: 'client' })).send('client@active'),
          protonAssert('Agent not registered in agentcore')
        );
      });

      it('should reject an inactive agent', async () => {
        await agentcore.actions.setstatus(['agent1', false]).send('agent1@active');
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs()).send('agent1@active'),
          protonAssert('Agent is not active')
        );
      });

      it('should reject listsvc when paused', async () => {
        await agentescrow.actions.setconfig([200, 10000, 30, 604800, true, 'agentcore', 'agentfeed', 604800, 10000000, 604800]).send('owner@active');
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs()).send('agent1@active'),
          protonAssert('Contract is paused')
        );
      });

      it('should reject an empty title', async () => {
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs({ title: '' })).send('agent1@active'),
          protonAssert('Title must be 1-128 characters')
        );
      });

      it('should reject a title over 128 characters', async () => {
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs({ title: 'x'.repeat(129) })).send('agent1@active'),
          protonAssert('Title must be 1-128 characters')
        );
      });

      it('should reject an empty description', async () => {
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs({ description: '' })).send('agent1@active'),
          protonAssert('Description must be 1-2048 characters')
        );
      });

      it('should reject a description over 2048 characters', async () => {
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs({ description: 'x'.repeat(2049) })).send('agent1@active'),
          protonAssert('Description must be 1-2048 characters')
        );
      });

      it('should reject empty deliverables', async () => {
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs({ deliverables: '' })).send('agent1@active'),
          protonAssert('Deliverables must be 1-2048 characters')
        );
      });

      it('should reject deliverables over 2048 characters', async () => {
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs({ deliverables: 'x'.repeat(2049) })).send('agent1@active'),
          protonAssert('Deliverables must be 1-2048 characters')
        );
      });

      it('should reject a price below the minimum job amount', async () => {
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs({ price: 9999 })).send('agent1@active'),
          protonAssert('Price below minimum job amount')
        );
      });

      it('should accept a price exactly at the minimum job amount', async () => {
        await listSvc({ price: 10000 });
        expect(getService(0).price).to.equal(10000);
      });

      it('should reject a turnaround below 1 hour', async () => {
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs({ turnaround: 3599 })).send('agent1@active'),
          protonAssert('Turnaround must be at least 1 hour')
        );
      });

      it('should reject a turnaround above 1 year', async () => {
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs({ turnaround: 31536001 })).send('agent1@active'),
          protonAssert('Turnaround must be at most 1 year')
        );
      });

      it('should accept turnarounds at both bounds', async () => {
        await listSvc({ turnaround: 3600 });
        await listSvc({ turnaround: 31536000 });
        expect(getService(0).turnaround).to.equal(3600);
        expect(getService(1).turnaround).to.equal(31536000);
      });

      it('should reject a category over 32 characters', async () => {
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs({ category: 'a'.repeat(33) })).send('agent1@active'),
          protonAssert('Category must be <= 32 characters')
        );
      });

      it('should reject a category that is not a lower-case slug', async () => {
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs({ category: 'Image' })).send('agent1@active'),
          protonAssert('Category must be a lower-case slug')
        );
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs({ category: 'image art' })).send('agent1@active'),
          protonAssert('Category must be a lower-case slug')
        );
      });

      it('should reject a sample_uri over 2048 characters', async () => {
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs({ sample_uri: 'x'.repeat(2049) })).send('agent1@active'),
          protonAssert('Sample URI must be <= 2048 characters')
        );
      });

      it('should reject an 11th active listing', async () => {
        for (let i = 0; i < 10; i++) {
          await listSvc({ title: `Service ${i}` });
        }
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs({ title: 'Service 10' })).send('agent1@active'),
          protonAssert('Agent already has 10 active services')
        );
      });
    });

    /* ---------------- updatesvc ---------------- */

    describe('updatesvc', () => {
      it('should update a listing without touching active or sales', async () => {
        await listSvc();
        await eosioToken.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'buy:0']).send('client@active');

        await agentescrow.actions.updatesvc(updateArgs(0, {
          title: 'Logo design v2',
          description: 'Now with a brand sheet',
          deliverables: '["logo.svg"]',
          price: 2000000,
          turnaround: 172800,
          category: 'design',
          sample_uri: 'ipfs://QmNew',
        })).send('agent1@active');

        const svc = getService(0);
        expect(svc.title).to.equal('Logo design v2');
        expect(svc.description).to.equal('Now with a brand sheet');
        expect(svc.deliverables).to.equal('["logo.svg"]');
        expect(svc.price).to.equal(2000000);
        expect(svc.turnaround).to.equal(172800);
        expect(svc.category).to.equal('design');
        expect(svc.sample_uri).to.equal('ipfs://QmNew');
        expect(svc.active).to.equal(true);
        expect(svc.sales).to.equal(1);
      });

      it('should reject a missing service', async () => {
        await expectToThrow(
          agentescrow.actions.updatesvc(updateArgs(99)).send('agent1@active'),
          protonAssert('Service not found')
        );
      });

      it('should reject an update from another agent', async () => {
        await listSvc();
        await registerAgent('arbitrator2');
        await expectToThrow(
          agentescrow.actions.updatesvc(updateArgs(0, { agent: 'arbitrator2' })).send('arbitrator2@active'),
          protonAssert('Only the listing agent can update')
        );
      });

      it('should require the agent authority', async () => {
        await listSvc();
        await expectToThrow(
          agentescrow.actions.updatesvc(updateArgs(0)).send('client@active'),
          'missing required authority agent1'
        );
      });

      it('should apply the same bounds as listsvc', async () => {
        await listSvc();
        await expectToThrow(
          agentescrow.actions.updatesvc(updateArgs(0, { title: '' })).send('agent1@active'),
          protonAssert('Title must be 1-128 characters')
        );
        await expectToThrow(
          agentescrow.actions.updatesvc(updateArgs(0, { price: 9999 })).send('agent1@active'),
          protonAssert('Price below minimum job amount')
        );
        await expectToThrow(
          agentescrow.actions.updatesvc(updateArgs(0, { turnaround: 3599 })).send('agent1@active'),
          protonAssert('Turnaround must be at least 1 hour')
        );
        await expectToThrow(
          agentescrow.actions.updatesvc(updateArgs(0, { category: 'NFT' })).send('agent1@active'),
          protonAssert('Category must be a lower-case slug')
        );
      });

      it('should reject updatesvc when paused', async () => {
        await listSvc();
        await agentescrow.actions.setconfig([200, 10000, 30, 604800, true, 'agentcore', 'agentfeed', 604800, 10000000, 604800]).send('owner@active');
        await expectToThrow(
          agentescrow.actions.updatesvc(updateArgs(0)).send('agent1@active'),
          protonAssert('Contract is paused')
        );
      });
    });

    /* ---------------- delistsvc / relistsvc ---------------- */

    describe('delistsvc and relistsvc', () => {
      it('should delist and relist a service, keeping the row', async () => {
        await listSvc();

        await agentescrow.actions.delistsvc(['agent1', 0]).send('agent1@active');
        expect(getService(0).active).to.equal(false);
        expect(getAllServices().length).to.equal(1);

        await agentescrow.actions.relistsvc(['agent1', 0]).send('agent1@active');
        expect(getService(0).active).to.equal(true);
      });

      it('should reject delist from another agent', async () => {
        await listSvc();
        await registerAgent('arbitrator2');
        await expectToThrow(
          agentescrow.actions.delistsvc(['arbitrator2', 0]).send('arbitrator2@active'),
          protonAssert('Only the listing agent can delist')
        );
      });

      it('should reject relist from another agent', async () => {
        await listSvc();
        await agentescrow.actions.delistsvc(['agent1', 0]).send('agent1@active');
        await registerAgent('arbitrator2');
        await expectToThrow(
          agentescrow.actions.relistsvc(['arbitrator2', 0]).send('arbitrator2@active'),
          protonAssert('Only the listing agent can relist')
        );
      });

      it('should reject delist/relist of a missing service', async () => {
        await expectToThrow(
          agentescrow.actions.delistsvc(['agent1', 99]).send('agent1@active'),
          protonAssert('Service not found')
        );
        await expectToThrow(
          agentescrow.actions.relistsvc(['agent1', 99]).send('agent1@active'),
          protonAssert('Service not found')
        );
      });

      it('should require the agent authority', async () => {
        await listSvc();
        await expectToThrow(
          agentescrow.actions.delistsvc(['agent1', 0]).send('client@active'),
          'missing required authority agent1'
        );
      });

      it('should reject relistsvc when paused', async () => {
        await listSvc();
        await agentescrow.actions.delistsvc(['agent1', 0]).send('agent1@active');
        await agentescrow.actions.setconfig([200, 10000, 30, 604800, true, 'agentcore', 'agentfeed', 604800, 10000000, 604800]).send('owner@active');
        await expectToThrow(
          agentescrow.actions.relistsvc(['agent1', 0]).send('agent1@active'),
          protonAssert('Contract is paused')
        );
      });
    });

    /* ---------------- rmservice (admin) ---------------- */

    describe('rmservice', () => {
      it('should let the owner remove a listing', async () => {
        await listSvc();
        await agentescrow.actions.rmservice([0]).send('owner@active');
        expect(getService(0)).to.be.undefined;
        expect(getAllServices().length).to.equal(0);
      });

      it('should reject a non-owner', async () => {
        await listSvc();
        await expectToThrow(
          agentescrow.actions.rmservice([0]).send('agent1@active'),
          'missing required authority owner'
        );
      });

      it('should reject a missing service', async () => {
        await expectToThrow(
          agentescrow.actions.rmservice([99]).send('owner@active'),
          protonAssert('Service not found')
        );
      });
    });

    /* ---------------- buy:<service_id> ---------------- */

    describe('buy', () => {
      it('should create a funded direct-hire job on purchase', async () => {
        await listSvc();

        await eosioToken.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'buy:0']).send('client@active');

        const job = getJob(0);
        expect(job).to.not.be.undefined;
        expect(job.client).to.equal('client');
        expect(job.agent).to.equal('agent1');
        expect(job.title).to.equal('Logo design');
        expect(job.description).to.equal('A hand-crafted logo delivered as SVG and PNG');
        expect(job.deliverables).to.equal('["logo.svg","logo.png"]');
        expect(job.amount).to.equal(1000000);
        expect(job.symbol).to.equal('XPR');
        expect(job.funded_amount).to.equal(1000000);
        expect(job.released_amount).to.equal(0);
        expect(job.state).to.equal(1); // FUNDED
        expect(job.arbitrator).to.equal('');
        expect(job.job_hash).to.equal('svc:0');
        expect(job.updated_at).to.equal(job.created_at);
        expect(job.deadline).to.equal(job.created_at + 86400);

        expect(getService(0).sales).to.equal(1);
      });

      it('should append buyer notes to the job description', async () => {
        await listSvc();

        await eosioToken.actions.transfer([
          'client', 'agentescrow', '100.0000 XPR', 'buy:0:Please use our brand blue'
        ]).send('client@active');

        const job = getJob(0);
        expect(job.description).to.equal(
          'A hand-crafted logo delivered as SVG and PNG\n\nBuyer notes: Please use our brand blue'
        );

        // Every other field is exactly what a plain purchase produces
        expect(job.client).to.equal('client');
        expect(job.agent).to.equal('agent1');
        expect(job.title).to.equal('Logo design');
        expect(job.deliverables).to.equal('["logo.svg","logo.png"]');
        expect(job.amount).to.equal(1000000);
        expect(job.symbol).to.equal('XPR');
        expect(job.funded_amount).to.equal(1000000);
        expect(job.released_amount).to.equal(0);
        expect(job.state).to.equal(1);
        expect(job.arbitrator).to.equal('');
        expect(job.job_hash).to.equal('svc:0');
        expect(job.deadline).to.equal(job.created_at + 86400);

        // The listing itself is untouched
        expect(getService(0).description).to.equal('A hand-crafted logo delivered as SVG and PNG');
        expect(getService(0).sales).to.equal(1);
      });

      it('should keep colons inside the buyer notes', async () => {
        await listSvc();

        await eosioToken.actions.transfer([
          'client', 'agentescrow', '100.0000 XPR', 'buy:0:ref: AB:12 — see https://x.test/a:b'
        ]).send('client@active');

        expect(getJob(0).description).to.equal(
          'A hand-crafted logo delivered as SVG and PNG\n\nBuyer notes: ref: AB:12 — see https://x.test/a:b'
        );
      });

      it('should leave the description unchanged for an empty note suffix', async () => {
        await listSvc();

        await eosioToken.actions.transfer([
          'client', 'agentescrow', '100.0000 XPR', 'buy:0:'
        ]).send('client@active');

        expect(getJob(0).description).to.equal('A hand-crafted logo delivered as SVG and PNG');
      });

      it('should accept notes of exactly 200 characters', async () => {
        await listSvc();
        const notes = 'n'.repeat(200);

        await eosioToken.actions.transfer([
          'client', 'agentescrow', '100.0000 XPR', `buy:0:${notes}`
        ]).send('client@active');

        expect(getJob(0).description).to.equal(
          `A hand-crafted logo delivered as SVG and PNG\n\nBuyer notes: ${notes}`
        );
      });

      it('should reject notes over 200 characters', async () => {
        await listSvc();
        const notes = 'n'.repeat(201);

        await expectToThrow(
          eosioToken.actions.transfer([
            'client', 'agentescrow', '100.0000 XPR', `buy:0:${notes}`
          ]).send('client@active'),
          protonAssert('Buyer notes must be <= 200 characters')
        );
        expect(getAllJobs().length).to.equal(0);
      });

      it('should still validate the service id when notes are present', async () => {
        await listSvc();

        await expectToThrow(
          eosioToken.actions.transfer([
            'client', 'agentescrow', '100.0000 XPR', 'buy::hello'
          ]).send('client@active'),
          protonAssert('Invalid service ID format')
        );
        await expectToThrow(
          eosioToken.actions.transfer([
            'client', 'agentescrow', '100.0000 XPR', 'buy:abc:hello'
          ]).send('client@active'),
          protonAssert('Service ID must be numeric')
        );
      });

      it('should use the next jobs primary key', async () => {
        await registerArbitrator('arbitrator1');
        await createAndFundJob(); // job 0
        await listSvc();

        await eosioToken.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'buy:0']).send('client@active');

        expect(getJob(1).job_hash).to.equal('svc:0');
        expect(getAllJobs().length).to.equal(2);
      });

      it('should accept the exact price with no refund', async () => {
        await listSvc();
        const before = getXprBalance('client');

        await eosioToken.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'buy:0']).send('client@active');

        // The full 100 XPR stays in escrow
        expect(getXprBalance('client')).to.equal(before - 100);
      });

      it('should refund the excess over the price', async () => {
        await listSvc();
        const before = getXprBalance('client');

        await eosioToken.actions.transfer(['client', 'agentescrow', '150.0000 XPR', 'buy:0']).send('client@active');

        // 50 XPR of the 150 comes straight back
        expect(getXprBalance('client')).to.equal(before - 100);
        expect(getJob(0).funded_amount).to.equal(1000000);
        expect(getJob(0).amount).to.equal(1000000);
      });

      it('should reject a payment below the price', async () => {
        await listSvc();
        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '99.9999 XPR', 'buy:0']).send('client@active'),
          protonAssert('Insufficient payment')
        );
      });

      it('should reject an unknown service', async () => {
        await listSvc();
        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'buy:99']).send('client@active'),
          protonAssert('Service not found')
        );
      });

      it('should reject a delisted service', async () => {
        await listSvc();
        await agentescrow.actions.delistsvc(['agent1', 0]).send('agent1@active');
        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'buy:0']).send('client@active'),
          protonAssert('Service is not active')
        );
      });

      it('should reject the selling agent buying its own service', async () => {
        await listSvc();
        await expectToThrow(
          eosioToken.actions.transfer(['agent1', 'agentescrow', '100.0000 XPR', 'buy:0']).send('agent1@active'),
          protonAssert('Cannot buy your own service')
        );
      });

      it("should reject the agent's owner buying the service", async () => {
        await listSvc();
        setAgentOwner('agent1', 'client');
        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'buy:0']).send('client@active'),
          protonAssert('Client cannot hire an agent they own')
        );
      });

      it('should reject a purchase once the agent is inactive', async () => {
        await listSvc();
        await agentcore.actions.setstatus(['agent1', false]).send('agent1@active');
        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'buy:0']).send('client@active'),
          protonAssert('Agent is not active')
        );
      });

      it('should reject a malformed memo', async () => {
        await listSvc();
        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'buy:']).send('client@active'),
          protonAssert('Invalid service ID format')
        );
        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'buy:abc']).send('client@active'),
          protonAssert('Service ID must be numeric')
        );
        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'buy 0']).send('client@active'),
          protonAssert("Invalid memo. Use 'fund:JOB_ID', 'buy:SERVICE_ID', 'svcfee:AGENT', 'boost:SERVICE_ID' or 'arbstake'")
        );
      });

      it('should reject a purchase when paused', async () => {
        await listSvc();
        await agentescrow.actions.setconfig([200, 10000, 30, 604800, true, 'agentcore', 'agentfeed', 604800, 10000000, 604800]).send('owner@active');
        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'buy:0']).send('client@active'),
          protonAssert('Contract is paused')
        );
      });

      it('should run the normal job lifecycle on a purchased job', async () => {
        await listSvc();
        await eosioToken.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'buy:0']).send('client@active');

        await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
        expect(getJob(0).state).to.equal(2); // ACCEPTED
        await agentescrow.actions.startjob(['agent1', 0]).send('agent1@active');
        await agentescrow.actions.deliver(['agent1', 0, 'ipfs://QmDelivered']).send('agent1@active');
        await agentescrow.actions.approve(['client', 0]).send('client@active');

        const job = getJob(0);
        expect(job.state).to.equal(6); // COMPLETED
        expect(job.released_amount).to.equal(1000000);
      });

      it('should count each purchase in sales', async () => {
        await listSvc();
        await eosioToken.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'buy:0']).send('client@active');
        await eosioToken.actions.transfer(['arbitrator1', 'agentescrow', '100.0000 XPR', 'buy:0']).send('arbitrator1@active');

        expect(getService(0).sales).to.equal(2);
        expect(getAllJobs().length).to.equal(2);
        expect(getJob(1).client).to.equal('arbitrator1');
      });
    });

    /* ---------------- svcconfig ---------------- */

    /* ---------------- setsvcinput / svcinput ---------------- */

    describe('service input forms', () => {
      const SCHEMA = '{"v":1,"fields":[{"key":"account","label":"XPR account","type":"account","required":true}]}';
      const ANSWERS = '{"account":"paul","focus":"defi"}';
      const PAUSE_CONFIG = [200, 10000, 30, 604800, true, 'agentcore', 'agentfeed', 604800, 10000000, 604800];

      describe('setsvcinput', () => {
        it('should store a schema for the listing', async () => {
          await listSvc();

          await agentescrow.actions.setsvcinput(['agent1', 0, SCHEMA]).send('agent1@active');

          const row = getServiceInput(0);
          expect(row).to.not.be.undefined;
          expect(row.service_id).to.equal(0);
          expect(row.schema).to.equal(SCHEMA);
          expect(row.updated_at).to.equal(1700000000);
        });

        it('should replace an existing schema', async () => {
          await listSvc();
          await agentescrow.actions.setsvcinput(['agent1', 0, SCHEMA]).send('agent1@active');

          blockchain.addTime(TimePointSec.from(60));
          const next = '{"v":1,"fields":[{"key":"url","label":"Link","type":"url"}]}';
          await agentescrow.actions.setsvcinput(['agent1', 0, next]).send('agent1@active');

          const row = getServiceInput(0);
          expect(row.schema).to.equal(next);
          expect(row.updated_at).to.equal(1700000060);
        });

        it('should remove the row for an empty schema', async () => {
          await listSvc();
          await agentescrow.actions.setsvcinput(['agent1', 0, SCHEMA]).send('agent1@active');
          expect(getServiceInput(0)).to.not.be.undefined;

          await agentescrow.actions.setsvcinput(['agent1', 0, '']).send('agent1@active');
          expect(getServiceInput(0)).to.be.undefined;
        });

        it('should accept an empty schema when there is no row', async () => {
          await listSvc();
          await agentescrow.actions.setsvcinput(['agent1', 0, '']).send('agent1@active');
          expect(getServiceInput(0)).to.be.undefined;
        });

        it('should reject an agent that does not own the listing', async () => {
          await listSvc();

          await expectToThrow(
            agentescrow.actions.setsvcinput(['client', 0, SCHEMA]).send('client@active'),
            protonAssert('Only the listing agent can set inputs')
          );
          expect(getServiceInput(0)).to.be.undefined;
        });

        it('should require the agent authority', async () => {
          await listSvc();

          await expectToThrow(
            agentescrow.actions.setsvcinput(['agent1', 0, SCHEMA]).send('client@active'),
            'missing required authority agent1'
          );
        });

        it('should reject an unknown listing', async () => {
          await expectToThrow(
            agentescrow.actions.setsvcinput(['agent1', 99, SCHEMA]).send('agent1@active'),
            protonAssert('Service not found')
          );
        });

        it('should accept 2048 characters and reject 2049', async () => {
          await listSvc();

          await agentescrow.actions.setsvcinput(['agent1', 0, 's'.repeat(2048)]).send('agent1@active');
          expect(getServiceInput(0).schema.length).to.equal(2048);

          await expectToThrow(
            agentescrow.actions.setsvcinput(['agent1', 0, 's'.repeat(2049)]).send('agent1@active'),
            protonAssert('Schema must be <= 2048 characters')
          );
          expect(getServiceInput(0).schema.length).to.equal(2048);
        });

        it('should reject when the contract is paused', async () => {
          await listSvc();
          await agentescrow.actions.setconfig(PAUSE_CONFIG).send('owner@active');

          await expectToThrow(
            agentescrow.actions.setsvcinput(['agent1', 0, SCHEMA]).send('agent1@active'),
            protonAssert('Contract is paused')
          );
        });

        it('should be removed with the listing on rmservice', async () => {
          await listSvc();
          await agentescrow.actions.setsvcinput(['agent1', 0, SCHEMA]).send('agent1@active');
          expect(getServiceInput(0)).to.not.be.undefined;

          await agentescrow.actions.rmservice([0]).send('owner@active');

          expect(getService(0)).to.be.undefined;
          expect(getServiceInput(0)).to.be.undefined;
        });

        it('should keep another listing schema on rmservice', async () => {
          await listSvc();
          await listSvc({ title: 'Second listing' });
          await agentescrow.actions.setsvcinput(['agent1', 0, SCHEMA]).send('agent1@active');
          await agentescrow.actions.setsvcinput(['agent1', 1, SCHEMA]).send('agent1@active');

          await agentescrow.actions.rmservice([0]).send('owner@active');

          expect(getServiceInput(0)).to.be.undefined;
          expect(getServiceInput(1)).to.not.be.undefined;
        });
      });

      describe('svcinput', () => {
        /* transfer(buy:0) + svcinput in one transaction, the way the site sends it */
        const buyWithInput = async (memo: string, answers: string) => {
          await sendTransaction([
            encodeAction(eosioToken, 'transfer', ['client', 'agentescrow', '100.0000 XPR', memo], 'client@active'),
            encodeAction(agentescrow, 'svcinput', ['client', answers], 'client@active'),
          ]);
        };

        beforeEach(async () => {
          await listSvc();
          await agentescrow.actions.setsvcinput(['agent1', 0, SCHEMA]).send('agent1@active');
        });

        it('should record the buy and the answers in one transaction', async () => {
          await buyWithInput('buy:0', ANSWERS);

          const job = getJob(0);
          expect(job.state).to.equal(1);
          expect(job.description).to.equal('A hand-crafted logo delivered as SVG and PNG');

          const rows = getAllJobMessages();
          expect(rows.length).to.equal(1);
          expect(rows[0].job_id).to.equal(0);
          expect(rows[0].author).to.equal('client');
          expect(rows[0].text).to.equal(ANSWERS);
          expect(rows[0].created_at).to.equal(1700000000);

          // Single use: the pointer is consumed
          expect(getLastBuy('client')).to.be.undefined;
        });

        it('should upsert lastbuys on every purchase', async () => {
          await eosioToken.actions.transfer([
            'client', 'agentescrow', '100.0000 XPR', 'buy:0'
          ]).send('client@active');

          let last = getLastBuy('client');
          expect(last).to.not.be.undefined;
          expect(last.job_id).to.equal(0);
          expect(last.service_id).to.equal(0);
          expect(last.created_at).to.equal(1700000000);

          await listSvc({ title: 'Second listing' });
          blockchain.addTime(TimePointSec.from(30));
          await eosioToken.actions.transfer([
            'client', 'agentescrow', '100.0000 XPR', 'buy:1'
          ]).send('client@active');

          last = getLastBuy('client');
          expect(last.job_id).to.equal(1);
          expect(last.service_id).to.equal(1);
          expect(last.created_at).to.equal(1700000030);
        });

        it('should work as a separate action inside the window', async () => {
          await eosioToken.actions.transfer([
            'client', 'agentescrow', '100.0000 XPR', 'buy:0'
          ]).send('client@active');
          blockchain.addTime(TimePointSec.from(600));

          await agentescrow.actions.svcinput(['client', ANSWERS]).send('client@active');

          expect(getAllJobMessages().length).to.equal(1);
          expect(getLastBuy('client')).to.be.undefined;
        });

        it('should reject after the 600 second window', async () => {
          await eosioToken.actions.transfer([
            'client', 'agentescrow', '100.0000 XPR', 'buy:0'
          ]).send('client@active');
          blockchain.addTime(TimePointSec.from(601));

          await expectToThrow(
            agentescrow.actions.svcinput(['client', ANSWERS]).send('client@active'),
            protonAssert('Purchase input window closed')
          );
          expect(getAllJobMessages().length).to.equal(0);
        });

        it('should reject when there is no recent purchase', async () => {
          await expectToThrow(
            agentescrow.actions.svcinput(['client', ANSWERS]).send('client@active'),
            protonAssert('No recent purchase')
          );
        });

        it('should reject a second use of the same purchase', async () => {
          await buyWithInput('buy:0', ANSWERS);

          await expectToThrow(
            agentescrow.actions.svcinput(['client', 'try again']).send('client@active'),
            protonAssert('No recent purchase')
          );
          expect(getAllJobMessages().length).to.equal(1);
        });

        it('should reject once the job has moved past FUNDED', async () => {
          await eosioToken.actions.transfer([
            'client', 'agentescrow', '100.0000 XPR', 'buy:0'
          ]).send('client@active');
          await agentescrow.actions.acceptjob(['agent1', 0]).send('agent1@active');
          expect(getJob(0).state).to.equal(2);

          await expectToThrow(
            agentescrow.actions.svcinput(['client', ANSWERS]).send('client@active'),
            protonAssert('Purchase input window closed')
          );
          expect(getAllJobMessages().length).to.equal(0);
        });

        it('should require the client authority', async () => {
          await eosioToken.actions.transfer([
            'client', 'agentescrow', '100.0000 XPR', 'buy:0'
          ]).send('client@active');

          await expectToThrow(
            agentescrow.actions.svcinput(['client', ANSWERS]).send('agent1@active'),
            'missing required authority client'
          );
        });

        it('should apply the same 1-512 text bounds as answer', async () => {
          await eosioToken.actions.transfer([
            'client', 'agentescrow', '100.0000 XPR', 'buy:0'
          ]).send('client@active');

          await expectToThrow(
            agentescrow.actions.svcinput(['client', '']).send('client@active'),
            protonAssert('Message must be 1-512 characters')
          );
          await expectToThrow(
            agentescrow.actions.svcinput(['client', 'a'.repeat(513)]).send('client@active'),
            protonAssert('Message must be 1-512 characters')
          );

          await agentescrow.actions.svcinput(['client', 'a'.repeat(512)]).send('client@active');
          expect(getAllJobMessages().length).to.equal(1);
        });

        it('should count toward the 20 message cap', async () => {
          await buyWithInput('buy:0', ANSWERS);
          expect(getAllJobMessages().length).to.equal(1);

          // 19 more fills the quota
          for (let i = 0; i < 19; i++) {
            if (i % 2 === 0) {
              await agentescrow.actions.askclient(['agent1', 0, `q${i}`]).send('agent1@active');
            } else {
              await agentescrow.actions.answer(['client', 0, `a${i}`]).send('client@active');
            }
          }
          expect(getAllJobMessages().length).to.equal(20);

          await expectToThrow(
            agentescrow.actions.askclient(['agent1', 0, 'one too many']).send('agent1@active'),
            protonAssert('Job message limit reached')
          );
        });

        it('should still accept a plain buy with notes and no input action', async () => {
          await eosioToken.actions.transfer([
            'client', 'agentescrow', '100.0000 XPR', 'buy:0:use our brand blue'
          ]).send('client@active');

          expect(getJob(0).description).to.equal(
            'A hand-crafted logo delivered as SVG and PNG\n\nBuyer notes: use our brand blue'
          );
          expect(getAllJobMessages().length).to.equal(0);
          expect(getLastBuy('client')).to.not.be.undefined;
        });
      });
    });

    describe('setsvcconfig', () => {
      it('should seed the defaults on init', async () => {
        const cfg = getSvcConfig();
        expect(cfg.service_fee).to.equal(50000);   // 5.0000 XPR
        expect(cfg.boost_min).to.equal(10000);     // 1.0000 XPR
        expect(cfg.boost_rate).to.equal(10000);    // 1.0000 XPR per day
      });

      it('should let the owner change the settings', async () => {
        await agentescrow.actions.setsvcconfig([100000, 20000, 20000]).send('owner@active');
        const cfg = getSvcConfig();
        expect(cfg.service_fee).to.equal(100000);
        expect(cfg.boost_min).to.equal(20000);
        expect(cfg.boost_rate).to.equal(20000);
      });

      it('should reject a non-owner', async () => {
        await expectToThrow(
          agentescrow.actions.setsvcconfig([0, 10000, 10000]).send('agent1@active'),
          'missing required authority owner'
        );
      });

      it('should reject a zero boost minimum', async () => {
        await expectToThrow(
          agentescrow.actions.setsvcconfig([50000, 0, 10000]).send('owner@active'),
          protonAssert('Boost minimum must be positive')
        );
      });

      it('should reject a zero boost rate', async () => {
        await expectToThrow(
          agentescrow.actions.setsvcconfig([50000, 10000, 0]).send('owner@active'),
          protonAssert('Boost rate must be positive')
        );
      });

      it('should reject a boost minimum that buys less than a day', async () => {
        await expectToThrow(
          agentescrow.actions.setsvcconfig([50000, 10000, 20000]).send('owner@active'),
          protonAssert('Boost minimum must buy at least one day')
        );
      });
    });

    /* ---------------- listing fee ---------------- */

    describe('listing fee', () => {
      it('should reject a listing with no deposit', async () => {
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs()).send('agent1@active'),
          protonAssert("Listing fee not paid. Send XPR with memo 'svcfee:agent1'")
        );
      });

      it('should reject an underpaid deposit', async () => {
        await payListingFee('agent1', '4.0000 XPR');
        await expectToThrow(
          agentescrow.actions.listsvc(svcArgs()).send('agent1@active'),
          protonAssert('Insufficient listing fee. Required: 5 XPR')
        );
      });

      it('should clear the deposit when it exactly covers the fee', async () => {
        await payListingFee();
        expect(getSvcDeposit('agent1').amount).to.equal(50000);

        await agentescrow.actions.listsvc(svcArgs()).send('agent1@active');

        expect(getSvcDeposit('agent1')).to.be.undefined;
        expect(getService(0)).to.not.be.undefined;
      });

      it('should consume exactly the fee and leave the remainder', async () => {
        await payListingFee('agent1', '12.0000 XPR');
        const paidAt = getSvcDeposit('agent1').paid_at;

        await agentescrow.actions.listsvc(svcArgs()).send('agent1@active');

        const deposit = getSvcDeposit('agent1');
        expect(deposit.amount).to.equal(70000);      // 12 - 5 XPR
        expect(deposit.paid_at).to.equal(paidAt);    // top-ups/consumption keep the original clock
      });

      it('should accumulate top-ups and keep the first paid_at', async () => {
        await payListingFee('agent1', '2.0000 XPR');
        const paidAt = getSvcDeposit('agent1').paid_at;
        blockchain.addTime(TimePointSec.from(3600));
        await payListingFee('agent1', '2.0000 XPR');

        const deposit = getSvcDeposit('agent1');
        expect(deposit.amount).to.equal(40000);
        expect(deposit.paid_at).to.equal(paidAt);
      });

      it('should forward the fee to the platform-fee destination', async () => {
        const ownerBefore = getXprBalance('owner');
        const agentBefore = getXprBalance('agent1');

        await listSvc();

        expect(getXprBalance('owner')).to.equal(ownerBefore + 5);
        expect(getXprBalance('agent1')).to.equal(agentBefore - 5);
      });

      it('should skip the fee entirely when service_fee is 0', async () => {
        await agentescrow.actions.setsvcconfig([0, 10000, 10000]).send('owner@active');
        const ownerBefore = getXprBalance('owner');

        await agentescrow.actions.listsvc(svcArgs()).send('agent1@active');

        expect(getService(0)).to.not.be.undefined;
        expect(getSvcDeposit('agent1')).to.be.undefined;
        expect(getXprBalance('owner')).to.equal(ownerBefore);
      });

      it('should keep updates, delist and relist free', async () => {
        await listSvc();
        expect(getSvcDeposit('agent1')).to.be.undefined;

        await agentescrow.actions.updatesvc(updateArgs(0, { title: 'Cheaper logo' })).send('agent1@active');
        await agentescrow.actions.delistsvc(['agent1', 0]).send('agent1@active');
        await agentescrow.actions.relistsvc(['agent1', 0]).send('agent1@active');

        expect(getService(0).title).to.equal('Cheaper logo');
        expect(getService(0).active).to.equal(true);
      });

      it('should reject a svcfee deposit from another payer', async () => {
        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '5.0000 XPR', 'svcfee:agent1']).send('client@active'),
          protonAssert('Payer must match account in memo')
        );
      });

      it('should reject a svcfee memo with no account name', async () => {
        await expectToThrow(
          eosioToken.actions.transfer(['agent1', 'agentescrow', '5.0000 XPR', 'svcfee:']).send('agent1@active'),
          protonAssert('Invalid account name in memo')
        );
      });
    });

    /* ---------------- refundsvcfee ---------------- */

    describe('refundsvcfee', () => {
      it('should reject a refund before 7 days', async () => {
        await payListingFee();
        await expectToThrow(
          agentescrow.actions.refundsvcfee(['agent1']).send('agent1@active'),
          protonAssert('Listing fee can only be refunded 7 days after payment')
        );

        // one second short of the window
        blockchain.addTime(TimePointSec.from(604799));
        await expectToThrow(
          agentescrow.actions.refundsvcfee(['agent1']).send('agent1@active'),
          protonAssert('Listing fee can only be refunded 7 days after payment')
        );
      });

      it('should refund an unconsumed deposit after 7 days', async () => {
        await payListingFee();
        const before = getXprBalance('agent1');

        blockchain.addTime(TimePointSec.from(604800));
        await agentescrow.actions.refundsvcfee(['agent1']).send('agent1@active');

        expect(getSvcDeposit('agent1')).to.be.undefined;
        expect(getXprBalance('agent1')).to.equal(before + 5);
      });

      it('should refund only the unconsumed remainder', async () => {
        await payListingFee('agent1', '12.0000 XPR');
        await agentescrow.actions.listsvc(svcArgs()).send('agent1@active');
        const before = getXprBalance('agent1');

        blockchain.addTime(TimePointSec.from(604800));
        await agentescrow.actions.refundsvcfee(['agent1']).send('agent1@active');

        expect(getXprBalance('agent1')).to.equal(before + 7);
        expect(getSvcDeposit('agent1')).to.be.undefined;
      });

      it('should reject a refund with no deposit', async () => {
        await expectToThrow(
          agentescrow.actions.refundsvcfee(['agent1']).send('agent1@active'),
          protonAssert('No listing fee deposit found')
        );
      });

      it('should require the agent authority', async () => {
        await payListingFee();
        blockchain.addTime(TimePointSec.from(604800));
        await expectToThrow(
          agentescrow.actions.refundsvcfee(['agent1']).send('client@active'),
          'missing required authority agent1'
        );
      });
    });

    /* ---------------- boost (featured placement) ---------------- */

    describe('boost', () => {
      const DAY = 86400;

      it('should reject featuring an agent with no completed jobs', async () => {
        await listSvc();
        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '3.0000 XPR', 'boost:0']).send('client@active'),
          protonAssert('Agent must have completed a job before featuring')
        );
      });

      it('should feature a listing for one day per rate unit', async () => {
        await listSvc();
        await completeOneJob();

        await eosioToken.actions.transfer(['client', 'agentescrow', '3.0000 XPR', 'boost:0']).send('client@active');

        const svc = getService(0);
        expect(svc.boost_paid).to.equal(30000);
        expect(svc.featured_until).to.be.at.least(1700000000 + 3 * DAY);
        expect(svc.featured_until).to.be.at.most(1700000000 + 3 * DAY + 600);
      });

      it('should extend an already featured listing from featured_until', async () => {
        await listSvc();
        await completeOneJob();

        await eosioToken.actions.transfer(['client', 'agentescrow', '1.0000 XPR', 'boost:0']).send('client@active');
        const first = getService(0).featured_until;

        await eosioToken.actions.transfer(['client', 'agentescrow', '2.0000 XPR', 'boost:0']).send('client@active');
        const second = getService(0);

        expect(second.featured_until).to.equal(first + 2 * DAY);
        expect(second.boost_paid).to.equal(30000);
      });

      it('should restart from now once the feature has expired', async () => {
        await listSvc();
        await completeOneJob();

        await eosioToken.actions.transfer(['client', 'agentescrow', '3.0000 XPR', 'boost:0']).send('client@active');
        const first = getService(0).featured_until;

        // 4 days later the listing is no longer featured
        blockchain.addTime(TimePointSec.from(4 * DAY));
        await eosioToken.actions.transfer(['client', 'agentescrow', '1.0000 XPR', 'boost:0']).send('client@active');

        const svc = getService(0);
        expect(svc.featured_until).to.be.greaterThan(first + DAY); // not stacked on the stale value
        expect(svc.featured_until).to.be.at.least(1700000000 + 5 * DAY);
        expect(svc.boost_paid).to.equal(40000);
      });

      it('should forward the boost to the platform-fee destination', async () => {
        await listSvc();
        await completeOneJob();
        const ownerBefore = getXprBalance('owner');
        const clientBefore = getXprBalance('client');

        await eosioToken.actions.transfer(['client', 'agentescrow', '2.0000 XPR', 'boost:0']).send('client@active');

        expect(getXprBalance('owner')).to.equal(ownerBefore + 2);
        expect(getXprBalance('client')).to.equal(clientBefore - 2);
      });

      it('should let the selling agent boost its own listing', async () => {
        await listSvc();
        await completeOneJob();

        await eosioToken.actions.transfer(['agent1', 'agentescrow', '1.0000 XPR', 'boost:0']).send('agent1@active');

        expect(getService(0).boost_paid).to.equal(10000);
      });

      it('should reject a boost below the minimum', async () => {
        await listSvc();
        await completeOneJob();

        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '0.5000 XPR', 'boost:0']).send('client@active'),
          protonAssert('Boost amount below minimum')
        );
      });

      it('should honour a raised boost minimum', async () => {
        await listSvc();
        await completeOneJob();
        await agentescrow.actions.setsvcconfig([50000, 50000, 50000]).send('owner@active');

        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '4.0000 XPR', 'boost:0']).send('client@active'),
          protonAssert('Boost amount below minimum')
        );

        await eosioToken.actions.transfer(['client', 'agentescrow', '10.0000 XPR', 'boost:0']).send('client@active');
        const svc = getService(0);
        expect(svc.boost_paid).to.equal(100000);
        expect(svc.featured_until).to.be.at.least(1700000000 + 2 * DAY);
        expect(svc.featured_until).to.be.at.most(1700000000 + 2 * DAY + 600);
      });

      it('should reject boosting a delisted service', async () => {
        await listSvc();
        await completeOneJob();
        await agentescrow.actions.delistsvc(['agent1', 0]).send('agent1@active');

        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '1.0000 XPR', 'boost:0']).send('client@active'),
          protonAssert('Service is not active')
        );
      });

      it('should reject boosting an unknown service', async () => {
        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '1.0000 XPR', 'boost:99']).send('client@active'),
          protonAssert('Service not found')
        );
      });

      it('should reject a malformed boost memo', async () => {
        await listSvc();
        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '1.0000 XPR', 'boost:']).send('client@active'),
          protonAssert('Invalid service ID format')
        );
        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '1.0000 XPR', 'boost:abc']).send('client@active'),
          protonAssert('Service ID must be numeric')
        );
      });

      it('should reject a boost when paused', async () => {
        await listSvc();
        await completeOneJob();
        await agentescrow.actions.setconfig([200, 10000, 30, 604800, true, 'agentcore', 'agentfeed', 604800, 10000000, 604800]).send('owner@active');

        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '1.0000 XPR', 'boost:0']).send('client@active'),
          protonAssert('Contract is paused')
        );
      });

      it('should reject an unknown memo listing the supported ones', async () => {
        await expectToThrow(
          eosioToken.actions.transfer(['client', 'agentescrow', '1.0000 XPR', 'sponsor:0']).send('client@active'),
          protonAssert("Invalid memo. Use 'fund:JOB_ID', 'buy:SERVICE_ID', 'svcfee:AGENT', 'boost:SERVICE_ID' or 'arbstake'")
        );
      });
    });
  });
});

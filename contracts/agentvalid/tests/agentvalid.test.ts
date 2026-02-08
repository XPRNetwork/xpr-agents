import { expect } from 'chai';
import { Blockchain, protonAssert, expectToThrow, mintTokens, nameToBigInt } from '@proton/vert';
import { TimePointSec } from '@greymass/eosio';

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                          */
/* ------------------------------------------------------------------ */

const blockchain = new Blockchain();

// agentvalid reads from agentcore's agents table via cross-contract read
const agentcore = blockchain.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const agentvalid = blockchain.createContract('agentvalid', 'assembly/target/agentvalid.contract', true);

// eosio.token for staking/challenges — DO NOT mint to agentvalid (triggers transfer handler)
const eosioToken = blockchain.createContract('eosio.token', 'node_modules/proton-tsc/external/eosio.token/eosio.token');

const [owner, alice, bob, validator1, validator2, challenger1] = blockchain.createAccounts(
  'owner', 'alice', 'bob', 'validator1', 'validator2', 'challenger1'
);

/* helpers */
const getConfig = () => {
  return agentvalid.tables.config(nameToBigInt('agentvalid')).getTableRows()[0];
};

const getValidator = (name: string) => {
  return agentvalid.tables.validators(nameToBigInt('agentvalid')).getTableRow(nameToBigInt(name));
};

const getValidation = (id: number) => {
  return agentvalid.tables.validations(nameToBigInt('agentvalid')).getTableRow(BigInt(id));
};

const getChallenge = (id: number) => {
  return agentvalid.tables.challenges(nameToBigInt('agentvalid')).getTableRow(BigInt(id));
};

/* Setup helpers */
const initAll = async () => {
  // Create XPR token — do NOT mint to agentvalid (transfer handler rejects non-stake memos)
  await mintTokens(eosioToken, 'XPR', 4, 1000000000, 100000, [owner, validator1, validator2, challenger1]);

  // Init agentcore
  await agentcore.actions.init(['owner', 0, 100000, '', 'agentvalid', '']).send('agentcore@active');

  // Init agentvalid
  await agentvalid.actions.init(['owner', 'agentcore', 10000]).send('agentvalid@active');

  // Lower challenge_stake so tests can afford it (default is 100.0000 XPR)
  // setconfig: core_contract, min_stake, challenge_stake, unstake_delay, challenge_window,
  //            slash_percent, dispute_period, funded_challenge_timeout, paused, validation_fee
  await agentvalid.actions.setconfig([
    'agentcore', 10000, 50000, 86400, 3600, 1000, 172800, 604800, false, 0
  ]).send('owner@active');

  // Register an agent in agentcore so we have something to validate
  await agentcore.actions.register([
    'alice', 'Test Agent', 'A test agent', 'https://api.test.com', 'https', '["chat"]'
  ]).send('alice@active');
};

const registerAndStakeValidator = async (name: string) => {
  await agentvalid.actions.regval([name, 'manual', '["ai","compute"]']).send(`${name}@active`);
  // Stake tokens by transferring to the contract with 'stake' memo
  await eosioToken.actions.transfer([name, 'agentvalid', '10.0000 XPR', 'stake']).send(`${name}@active`);
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('agentvalid', () => {

  beforeEach(() => {
    blockchain.resetTables();
  });

  /* ==================== Initialization ==================== */

  describe('init', () => {
    it('should initialize the contract', async () => {
      await agentvalid.actions.init(['owner', 'agentcore', 10000]).send('agentvalid@active');
      const cfg = getConfig();
      expect(cfg.owner).to.equal('owner');
      expect(cfg.min_stake).to.equal(10000);
    });

    it('should prevent re-initialization', async () => {
      await agentvalid.actions.init(['owner', 'agentcore', 10000]).send('agentvalid@active');
      await expectToThrow(
        agentvalid.actions.init(['owner', 'agentcore', 10000]).send('agentvalid@active'),
        protonAssert('Contract already initialized. Use setconfig to modify settings.')
      );
    });

    it('should require contract auth', async () => {
      await expectToThrow(
        agentvalid.actions.init(['owner', 'agentcore', 10000]).send('alice@active'),
        'missing required authority agentvalid'
      );
    });
  });

  /* ==================== Validator Registration ==================== */

  describe('regval', () => {
    beforeEach(async () => {
      await initAll();
    });

    it('should register a validator', async () => {
      await agentvalid.actions.regval(['validator1', 'manual', '["ai","compute"]']).send('validator1@active');
      const val = getValidator('validator1');
      expect(val).to.not.be.undefined;
      expect(val.method).to.equal('manual');
      expect(val.active).to.equal(true);
      expect(val.accuracy_score).to.equal(10000);
      expect(val.total_validations).to.equal(0);
    });

    it('should reject duplicate registration', async () => {
      await agentvalid.actions.regval(['validator1', 'manual', '["ai"]']).send('validator1@active');
      await expectToThrow(
        agentvalid.actions.regval(['validator1', 'manual', '["ai"]']).send('validator1@active'),
        protonAssert('Validator already registered')
      );
    });

    it('should require auth', async () => {
      await expectToThrow(
        agentvalid.actions.regval(['validator1', 'manual', '["ai"]']).send('bob@active'),
        'missing required authority validator1'
      );
    });
  });

  /* ==================== Validator Staking ==================== */

  describe('staking', () => {
    beforeEach(async () => {
      await initAll();
      await agentvalid.actions.regval(['validator1', 'manual', '["ai"]']).send('validator1@active');
    });

    it('should accept stake via token transfer', async () => {
      await eosioToken.actions.transfer(['validator1', 'agentvalid', '10.0000 XPR', 'stake']).send('validator1@active');
      const val = getValidator('validator1');
      expect(val.stake).to.equal(100000);
    });

    it('should accumulate stake on multiple transfers', async () => {
      await eosioToken.actions.transfer(['validator1', 'agentvalid', '5.0000 XPR', 'stake']).send('validator1@active');
      await eosioToken.actions.transfer(['validator1', 'agentvalid', '5.0000 XPR', 'stake']).send('validator1@active');
      const val = getValidator('validator1');
      expect(val.stake).to.equal(100000);
    });

    it('should reject invalid memo', async () => {
      await expectToThrow(
        eosioToken.actions.transfer(['validator1', 'agentvalid', '5.0000 XPR', 'invalid']).send('validator1@active'),
        protonAssert("Invalid memo. Use 'stake' for validator staking or 'challenge:ID' for challenge funding")
      );
    });
  });

  /* ==================== Submit Validation ==================== */

  describe('validate', () => {
    beforeEach(async () => {
      await initAll();
      await registerAndStakeValidator('validator1');
    });

    it('should submit a validation', async () => {
      await agentvalid.actions.validate([
        'validator1', 'alice', 'jobhash123', 1, 95, 'ipfs://evidence'
      ]).send('validator1@active');

      const validation = getValidation(0);
      expect(validation).to.not.be.undefined;
      expect(validation.validator).to.equal('validator1');
      expect(validation.agent).to.equal('alice');
      expect(validation.result).to.equal(1);
      expect(validation.confidence).to.equal(95);
      expect(validation.challenged).to.equal(false);
    });

    it('should reject validation for non-existent agent', async () => {
      await expectToThrow(
        agentvalid.actions.validate([
          'validator1', 'bob', 'jobhash123', 1, 95, 'ipfs://evidence'
        ]).send('validator1@active'),
        protonAssert('Agent not registered in agentcore')
      );
    });

    it('should reject invalid result value', async () => {
      await expectToThrow(
        agentvalid.actions.validate([
          'validator1', 'alice', 'jobhash123', 5, 95, 'ipfs://evidence'
        ]).send('validator1@active'),
        protonAssert('Invalid result (0=fail, 1=pass, 2=partial)')
      );
    });

    it('should reject confidence > 100', async () => {
      await expectToThrow(
        agentvalid.actions.validate([
          'validator1', 'alice', 'jobhash123', 1, 101, 'ipfs://evidence'
        ]).send('validator1@active'),
        protonAssert('Confidence must be 0-100')
      );
    });

    it('should increment total_validations', async () => {
      await agentvalid.actions.validate([
        'validator1', 'alice', 'jobhash123', 1, 95, 'ipfs://evidence'
      ]).send('validator1@active');
      const val = getValidator('validator1');
      expect(val.total_validations).to.equal(1);
    });
  });

  /* ==================== Challenge ==================== */

  describe('challenge', () => {
    beforeEach(async () => {
      await initAll();
      await registerAndStakeValidator('validator1');
      await agentvalid.actions.validate([
        'validator1', 'alice', 'jobhash123', 1, 95, 'ipfs://evidence'
      ]).send('validator1@active');
    });

    it('should create a challenge', async () => {
      await agentvalid.actions.challenge([
        'challenger1', 0, 'Invalid validation', 'ipfs://challenge-evidence'
      ]).send('challenger1@active');

      const challenge = getChallenge(0);
      expect(challenge).to.not.be.undefined;
      expect(challenge.challenger).to.equal('challenger1');
      expect(challenge.validation_id).to.equal(0);
      expect(challenge.status).to.equal(0); // pending
      expect(challenge.stake).to.equal(0); // not funded yet
    });

    it('should reject challenge for non-existent validation', async () => {
      await expectToThrow(
        agentvalid.actions.challenge([
          'challenger1', 99, 'Invalid', 'ipfs://evidence'
        ]).send('challenger1@active'),
        protonAssert('Validation not found')
      );
    });

    it('should fund a challenge via token transfer', async () => {
      await agentvalid.actions.challenge([
        'challenger1', 0, 'Invalid validation', 'ipfs://challenge-evidence'
      ]).send('challenger1@active');

      // Fund it
      await eosioToken.actions.transfer([
        'challenger1', 'agentvalid', '5.0000 XPR', 'challenge:0'
      ]).send('challenger1@active');

      const challenge = getChallenge(0);
      expect(challenge.stake).to.equal(50000);
    });

    it('should mark validation as challenged when funded', async () => {
      await agentvalid.actions.challenge([
        'challenger1', 0, 'Invalid', 'ipfs://evidence'
      ]).send('challenger1@active');

      // Validation should NOT be challenged yet (griefing fix)
      let validation = getValidation(0);
      expect(validation.challenged).to.equal(false);

      // Fund the challenge
      await eosioToken.actions.transfer([
        'challenger1', 'agentvalid', '5.0000 XPR', 'challenge:0'
      ]).send('challenger1@active');

      // NOW validation should be challenged
      validation = getValidation(0);
      expect(validation.challenged).to.equal(true);
    });

    it('should increment pending_challenges on funding', async () => {
      await agentvalid.actions.challenge([
        'challenger1', 0, 'Invalid', 'ipfs://evidence'
      ]).send('challenger1@active');

      // Before funding
      let val = getValidator('validator1');
      expect(val.pending_challenges).to.equal(0);

      // Fund
      await eosioToken.actions.transfer([
        'challenger1', 'agentvalid', '5.0000 XPR', 'challenge:0'
      ]).send('challenger1@active');

      // After funding
      val = getValidator('validator1');
      expect(val.pending_challenges).to.equal(1);
    });
  });

  /* ==================== Unfunded Challenge Expiry ==================== */

  describe('expireunfund', () => {
    beforeEach(async () => {
      await initAll();
      await registerAndStakeValidator('validator1');
      await agentvalid.actions.validate([
        'validator1', 'alice', 'jobhash123', 1, 95, 'ipfs://evidence'
      ]).send('validator1@active');
      await agentvalid.actions.challenge([
        'challenger1', 0, 'Invalid', 'ipfs://evidence'
      ]).send('challenger1@active');
    });

    it('should reject if funding deadline not passed', async () => {
      await expectToThrow(
        agentvalid.actions.expireunfund([0]).send('challenger1@active'),
        protonAssert('Funding deadline not reached')
      );
    });
  });

  /* ==================== Validator Status ==================== */

  describe('setvalstat', () => {
    beforeEach(async () => {
      await initAll();
      await registerAndStakeValidator('validator1');
    });

    it('should deactivate a validator', async () => {
      await agentvalid.actions.setvalstat(['validator1', false]).send('validator1@active');
      const val = getValidator('validator1');
      expect(val.active).to.equal(false);
    });

    it('should reactivate a validator', async () => {
      await agentvalid.actions.setvalstat(['validator1', false]).send('validator1@active');
      await agentvalid.actions.setvalstat(['validator1', true]).send('validator1@active');
      const val = getValidator('validator1');
      expect(val.active).to.equal(true);
    });

    it('should require auth', async () => {
      await expectToThrow(
        agentvalid.actions.setvalstat(['validator1', false]).send('bob@active'),
        'missing required authority validator1'
      );
    });
  });

  /* ==================== Update Validator ==================== */

  describe('updateval', () => {
    beforeEach(async () => {
      await initAll();
      await agentvalid.actions.regval(['validator1', 'manual', '["ai"]']).send('validator1@active');
    });

    it('should update validator info', async () => {
      await agentvalid.actions.updateval(['validator1', 'automated', '["storage","oracle"]']).send('validator1@active');
      const val = getValidator('validator1');
      expect(val.method).to.equal('automated');
    });
  });

  /* ==================== setowner (governance) ==================== */

  describe('setowner', () => {
    beforeEach(async () => {
      await agentvalid.actions.init(['owner', 'agentcore', 10000]).send('agentvalid@active');
    });

    it('should transfer contract ownership', async () => {
      await agentvalid.actions.setowner(['bob']).send('owner@active');
      const cfg = getConfig();
      expect(cfg.owner).to.equal('bob');
    });

    it('should reject from non-owner', async () => {
      await expectToThrow(
        agentvalid.actions.setowner(['bob']).send('alice@active'),
        'missing required authority owner'
      );
    });
  });

  /* ==================== Challenge Resolution & Slashing ==================== */

  describe('challenge resolution and slashing', () => {
    beforeEach(async () => {
      await initAll();
      // Set blockchain time to a non-zero value so currentTimeSec() > 0
      blockchain.setTime(TimePointSec.from(1700000000));
      await registerAndStakeValidator('validator1');
      await agentvalid.actions.validate([
        'validator1', 'alice', 'jobhash123', 1, 95, 'ipfs://evidence'
      ]).send('validator1@active');
      // Create and fund challenge
      await agentvalid.actions.challenge([
        'challenger1', 0, 'Invalid validation', 'ipfs://challenge-evidence'
      ]).send('challenger1@active');
      await eosioToken.actions.transfer([
        'challenger1', 'agentvalid', '5.0000 XPR', 'challenge:0'
      ]).send('challenger1@active');
      // Advance time past dispute_period (172800 seconds = 2 days)
      blockchain.addTime(TimePointSec.from(173000));
    });

    it('should slash validator when challenge is upheld', async () => {
      const valBefore = getValidator('validator1');
      const stakeBefore = valBefore.stake;

      await agentvalid.actions.resolve([
        'owner', 0, true, 'Validation was incorrect'
      ]).send('owner@active');

      const valAfter = getValidator('validator1');
      // slash_percent = 1000 (10%), stake was 100000
      // slashAmount = 100000 * 1000 / 10000 = 10000
      expect(valAfter.stake).to.equal(stakeBefore - 10000);
      expect(valAfter.incorrect_validations).to.equal(1);
    });

    it('should reset challenged flag after resolution', async () => {
      await agentvalid.actions.resolve([
        'owner', 0, true, 'Validation was incorrect'
      ]).send('owner@active');

      const validation = getValidation(0);
      expect(validation.challenged).to.equal(false);
    });

    it('should decrement pending_challenges on resolution', async () => {
      let val = getValidator('validator1');
      expect(val.pending_challenges).to.equal(1);

      await agentvalid.actions.resolve([
        'owner', 0, true, 'Validation was incorrect'
      ]).send('owner@active');

      val = getValidator('validator1');
      expect(val.pending_challenges).to.equal(0);
    });

    it('should forfeit challenger stake to validator when rejected', async () => {
      const valBefore = getValidator('validator1');
      const stakeBefore = valBefore.stake;
      const challengeStake = getChallenge(0).stake;

      await agentvalid.actions.resolve([
        'owner', 0, false, 'Validation was correct'
      ]).send('owner@active');

      const valAfter = getValidator('validator1');
      // Validator gets challenger's stake
      expect(valAfter.stake).to.equal(stakeBefore + challengeStake);
      expect(valAfter.incorrect_validations).to.equal(0);
    });

    it('should keep accuracy at 100% when under MIN_VALIDATIONS (5)', async () => {
      // validator1 has 1 validation, below MIN_VALIDATIONS_FOR_ACCURACY = 5
      await agentvalid.actions.resolve([
        'owner', 0, true, 'Incorrect validation'
      ]).send('owner@active');

      const val = getValidator('validator1');
      // accuracy_score should remain at 10000 (100%) despite incorrect validation
      expect(val.accuracy_score).to.equal(10000);
      expect(val.incorrect_validations).to.equal(1);
    });

    it('should update accuracy after MIN_VALIDATIONS reached', async () => {
      // Resolve first challenge upheld
      await agentvalid.actions.resolve([
        'owner', 0, true, 'Incorrect'
      ]).send('owner@active');

      // Submit 4 more validations to reach MIN_VALIDATIONS = 5
      for (let i = 0; i < 4; i++) {
        await agentvalid.actions.validate([
          'validator1', 'alice', `jobhash${i + 2}`, 1, 90, 'ipfs://ev'
        ]).send('validator1@active');
      }

      // Now create and fund a second challenge on validation 1
      await agentvalid.actions.challenge([
        'challenger1', 1, 'Also invalid', 'ipfs://ev2'
      ]).send('challenger1@active');
      await eosioToken.actions.transfer([
        'challenger1', 'agentvalid', '5.0000 XPR', 'challenge:1'
      ]).send('challenger1@active');

      blockchain.addTime(TimePointSec.from(173000));

      await agentvalid.actions.resolve([
        'owner', 1, true, 'Also incorrect'
      ]).send('owner@active');

      const val = getValidator('validator1');
      // total_validations = 5, incorrect = 2
      // accuracy = (5 - 2) * 10000 / 5 = 6000
      expect(val.total_validations).to.equal(5);
      expect(val.incorrect_validations).to.equal(2);
      expect(val.accuracy_score).to.equal(6000);
    });

    it('should reject resolve before dispute period elapsed', async () => {
      // Reset and recreate without time advance
      blockchain.resetTables();
      await initAll();
      blockchain.setTime(TimePointSec.from(1700000000));
      await registerAndStakeValidator('validator1');
      await agentvalid.actions.validate([
        'validator1', 'alice', 'hash1', 1, 95, 'ipfs://ev'
      ]).send('validator1@active');
      await agentvalid.actions.challenge([
        'challenger1', 0, 'Invalid', 'ipfs://ev'
      ]).send('challenger1@active');
      await eosioToken.actions.transfer([
        'challenger1', 'agentvalid', '5.0000 XPR', 'challenge:0'
      ]).send('challenger1@active');

      // Try to resolve immediately (dispute_period = 172800)
      try {
        await agentvalid.actions.resolve([
          'owner', 0, true, 'Too soon'
        ]).send('owner@active');
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('Dispute period not elapsed');
      }
    });

    it('should reject resolve on unfunded challenge', async () => {
      // Reset and create unfunded challenge
      blockchain.resetTables();
      await initAll();
      blockchain.setTime(TimePointSec.from(1700000000));
      await registerAndStakeValidator('validator1');
      await agentvalid.actions.validate([
        'validator1', 'alice', 'hash1', 1, 95, 'ipfs://ev'
      ]).send('validator1@active');
      await agentvalid.actions.challenge([
        'challenger1', 0, 'Invalid', 'ipfs://ev'
      ]).send('challenger1@active');

      blockchain.addTime(TimePointSec.from(173000));

      await expectToThrow(
        agentvalid.actions.resolve([
          'owner', 0, true, 'Not funded'
        ]).send('owner@active'),
        protonAssert("Challenge must be funded. Send XPR with memo 'challenge:ID'")
      );
    });

    it('should require owner auth for resolve', async () => {
      await expectToThrow(
        agentvalid.actions.resolve([
          'bob', 0, true, 'Not authorized'
        ]).send('bob@active'),
        'missing required authority owner'
      );
    });
  });

  /* ==================== setconfig ==================== */

  describe('setconfig', () => {
    beforeEach(async () => {
      await agentvalid.actions.init(['owner', 'agentcore', 10000]).send('agentvalid@active');
    });

    it('should update config', async () => {
      // core_contract, min_stake, challenge_stake, unstake_delay, challenge_window,
      // slash_percent, dispute_period, funded_challenge_timeout, paused, validation_fee
      await agentvalid.actions.setconfig([
        'agentcore', 20000, 50000, 604800, 86400, 1000, 172800, 604800, false, 0
      ]).send('owner@active');
      const cfg = getConfig();
      expect(cfg.min_stake).to.equal(20000);
      expect(cfg.challenge_stake).to.equal(50000);
    });

    it('should pause the contract', async () => {
      await agentvalid.actions.setconfig([
        'agentcore', 10000, 50000, 604800, 86400, 1000, 172800, 604800, true, 0
      ]).send('owner@active');
      const cfg = getConfig();
      expect(cfg.paused).to.equal(true);
    });
  });
});

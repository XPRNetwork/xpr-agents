import { expect } from 'chai';
import { Blockchain, protonAssert, expectToThrow, mintTokens, nameToBigInt } from '@proton/vert';

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                          */
/* ------------------------------------------------------------------ */

const blockchain = new Blockchain();

const agentdeploy = blockchain.createContract('agentdeploy', 'assembly/target/agentdeploy.contract', true);

// XMD token for subscription payments
const xmdToken = blockchain.createContract('xmd.token', 'node_modules/proton-tsc/external/eosio.token/eosio.token');

// XUSDC token
const xtokens = blockchain.createContract('xtokens', 'node_modules/proton-tsc/external/eosio.token/eosio.token');

// agentcore for reference
const agentcore = blockchain.createContract('agentcore', '../../contracts/agentcore/assembly/target/agentcore.contract');

const [owner, user1, user2] = blockchain.createAccounts('owner', 'user1', 'user2');

// Create agent accounts
const [agent1, agent2, agent3, agent4] = blockchain.createAccounts('agent1', 'agent2', 'agent3', 'agent4');

/* Helpers */
const getConfig = () => {
  return agentdeploy.tables.config(nameToBigInt('agentdeploy')).getTableRows()[0];
};

const getSub = (agent: string) => {
  return agentdeploy.tables.subs(nameToBigInt('agentdeploy')).getTableRow(nameToBigInt(agent));
};

const getAllSubs = () => {
  return agentdeploy.tables.subs(nameToBigInt('agentdeploy')).getTableRows();
};

const getAllPrices = () => {
  return agentdeploy.tables.prices(nameToBigInt('agentdeploy')).getTableRows();
};

/* Setup */
const initAll = async () => {
  // Create tokens
  await mintTokens(xmdToken, 'XMD', 4, 1000000000, 100000000, [owner, user1, user2]);
  await mintTokens(xtokens, 'XUSDC', 4, 1000000000, 100000000, [owner, user1, user2]);

  // Init agentcore
  await agentcore.actions.init(['owner', 0, 100000, '', '', '']).send('agentcore@active');

  // Init agentdeploy
  await agentdeploy.actions.init(['owner', 'agentcore']).send('agentdeploy@active');

  // Set XMD price to 15.0000 XMD
  await agentdeploy.actions.setprice(['xmd.token', 'XMD', 150000, true]).send('owner@active');

  // Set XUSDC price
  await agentdeploy.actions.setprice(['xtokens', 'XUSDC', 150000, true]).send('owner@active');
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('agentdeploy', () => {
  before(async () => {
    await initAll();
  });

  // ============== INIT ==============

  describe('init', () => {
    it('should initialize contract', () => {
      const config = getConfig();
      expect(config.owner).to.equal('owner');
      expect(config.core_contract).to.equal('agentcore');
      expect(config.paused).to.equal(false);
    });

    it('should reject double init', async () => {
      await expectToThrow(
        agentdeploy.actions.init(['owner', 'agentcore']).send('agentdeploy@active'),
        protonAssert('Contract already initialized')
      );
    });
  });

  // ============== PRICING ==============

  describe('setprice', () => {
    it('should have both prices', () => {
      const prices = getAllPrices();
      expect(prices.length).to.equal(2);
      expect(prices[0].token_symbol).to.equal('XMD');
      expect(prices[0].amount).to.equal(150000);
    });

    it('should update existing price', async () => {
      await agentdeploy.actions.setprice(['xmd.token', 'XMD', 200000, true]).send('owner@active');
      const prices = getAllPrices();
      expect(prices.length).to.equal(2);
      expect(prices[0].amount).to.equal(200000);

      // Restore
      await agentdeploy.actions.setprice(['xmd.token', 'XMD', 150000, true]).send('owner@active');
    });

    it('should reject invalid token contract', async () => {
      await expectToThrow(
        agentdeploy.actions.setprice(['eosio.token', 'XPR', 100000, true]).send('owner@active'),
        protonAssert('Only xmd.token (XMD) and xtokens (XUSDC) accepted')
      );
    });

    it('should reject non-owner', async () => {
      await expectToThrow(
        agentdeploy.actions.setprice(['xmd.token', 'XMD', 100000, true]).send('user1@active'),
        'missing required authority owner'
      );
    });
  });

  // ============== SUBSCRIBE + PAY ==============

  describe('subscribe + pay', () => {
    it('should create subscription (starts paused)', async () => {
      await agentdeploy.actions.subscribe(['user1', 'agent1', 'hosted']).send('user1@active');
      const sub = getSub('agent1');
      expect(sub).to.not.be.undefined;
      expect(sub.owner).to.equal('user1');
      expect(sub.plan).to.equal('hosted');
      expect(sub.state).to.equal(2); // PAUSED (unfunded)
    });

    it('should reject duplicate subscription', async () => {
      await expectToThrow(
        agentdeploy.actions.subscribe(['user1', 'agent1', 'hosted']).send('user1@active'),
        protonAssert('Agent already has an active subscription')
      );
    });

    it('should reject invalid plan', async () => {
      await expectToThrow(
        agentdeploy.actions.subscribe(['user1', 'agent2', 'premium']).send('user1@active'),
        protonAssert("Plan must be 'hosted' or 'selfhosted'")
      );
    });

    it('should activate on XMD payment', async () => {
      await xmdToken.actions.transfer(['user1', 'agentdeploy', '15.0000 XMD', 'sub:agent1']).send('user1@active');
      const sub = getSub('agent1');
      expect(sub.state).to.equal(0); // ACTIVE
      expect(sub.paid_until).to.be.greaterThan(0);
      expect(sub.token_symbol).to.equal('XMD');
      expect(sub.total_paid).to.equal(150000);
    });

    it('should extend on second payment', async () => {
      const before = getSub('agent1');
      const prevPaidUntil = before.paid_until;

      await xmdToken.actions.transfer(['user1', 'agentdeploy', '15.0000 XMD', 'sub:agent1']).send('user1@active');

      const after = getSub('agent1');
      expect(after.paid_until).to.be.greaterThan(prevPaidUntil);
      expect(after.total_paid).to.equal(300000);
    });

    it('should reject payment from non-owner', async () => {
      await expectToThrow(
        xmdToken.actions.transfer(['user2', 'agentdeploy', '15.0000 XMD', 'sub:agent1']).send('user2@active'),
        protonAssert('Only subscription owner can pay')
      );
    });

    it('should reject insufficient payment', async () => {
      await agentdeploy.actions.subscribe(['user2', 'agent2', 'hosted']).send('user2@active');
      await expectToThrow(
        xmdToken.actions.transfer(['user2', 'agentdeploy', '1.0000 XMD', 'sub:agent2']).send('user2@active'),
        protonAssert('Insufficient payment amount')
      );
    });

    it('should reject invalid memo', async () => {
      await expectToThrow(
        xmdToken.actions.transfer(['user1', 'agentdeploy', '15.0000 XMD', 'invalid']).send('user1@active'),
        protonAssert("Invalid memo. Use 'sub:{agent_account}'")
      );
    });

    it('should reject non-existent subscription', async () => {
      await expectToThrow(
        xmdToken.actions.transfer(['user1', 'agentdeploy', '15.0000 XMD', 'sub:nobody']).send('user1@active'),
        protonAssert('No subscription for this agent. Call subscribe first')
      );
    });

    it('should update active_subs count', () => {
      const config = getConfig();
      expect(config.active_subs).to.equal(1);
    });
  });

  // ============== ADMIN: setworker ==============

  describe('setworker', () => {
    it('should set worker name', async () => {
      await agentdeploy.actions.setworker(['agent1', 'xpr-agent-agent1']).send('owner@active');
      const sub = getSub('agent1');
      expect(sub.cf_worker_name).to.equal('xpr-agent-agent1');
    });

    it('should reject non-admin', async () => {
      await expectToThrow(
        agentdeploy.actions.setworker(['agent1', 'foo']).send('user1@active'),
        'missing required authority owner'
      );
    });
  });

  // ============== CANCEL (separate agent to avoid vert table cache issues) ==============

  describe('cancel', () => {
    it('should create + fund + cancel agent3', async () => {
      await agentdeploy.actions.subscribe(['user1', 'agent3', 'hosted']).send('user1@active');
      await xmdToken.actions.transfer(['user1', 'agentdeploy', '15.0000 XMD', 'sub:agent3']).send('user1@active');

      const before = getSub('agent3');
      expect(before.state).to.equal(0); // ACTIVE

      await agentdeploy.actions.cancel(['user1', 'agent3']).send('user1@active');

      const after = getSub('agent3');
      expect(after.state).to.equal(3); // CANCELLED
    });

    it('should reject cancel by non-owner', async () => {
      await agentdeploy.actions.subscribe(['user1', 'agent4', 'hosted']).send('user1@active');
      await expectToThrow(
        agentdeploy.actions.cancel(['user2', 'agent4']).send('user2@active'),
        protonAssert('Only subscription owner can cancel')
      );
    });
  });

  // ============== SETCONFIG ==============

  describe('setconfig', () => {
    it('should update config', async () => {
      await agentdeploy.actions.setconfig(['agentcore', true]).send('owner@active');
      const config = getConfig();
      expect(config.paused).to.equal(true);
    });

    it('should reject subscribe when paused', async () => {
      await expectToThrow(
        agentdeploy.actions.subscribe(['user2', 'agent3', 'hosted']).send('user2@active'),
        protonAssert('Contract is paused')
      );
    });

    it('should unpause', async () => {
      await agentdeploy.actions.setconfig(['agentcore', false]).send('owner@active');
      const config = getConfig();
      expect(config.paused).to.equal(false);
    });
  });

  // ============== SETOWNER ==============

  describe('setowner', () => {
    it('should transfer ownership', async () => {
      await agentdeploy.actions.setowner(['user1']).send('owner@active');
      const config = getConfig();
      expect(config.owner).to.equal('user1');
    });

    it('should reject old owner', async () => {
      await expectToThrow(
        agentdeploy.actions.setowner(['owner']).send('owner@active'),
        'missing required authority user1'
      );
    });

    // Restore for other tests
    after(async () => {
      await agentdeploy.actions.setowner(['owner']).send('user1@active');
    });
  });
});

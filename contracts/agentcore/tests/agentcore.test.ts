import { expect } from 'chai';
import { Blockchain, protonAssert, expectToThrow, nameToBigInt } from '@proton/vert';

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                          */
/* ------------------------------------------------------------------ */

const blockchain = new Blockchain();

// Contract under test
const agentcore = blockchain.createContract('agentcore', 'assembly/target/agentcore.contract');

// Accounts
const [owner, alice, bob, carol, plugcon] = blockchain.createAccounts('owner', 'alice', 'bob', 'carol', 'plugcon');

/* helpers */
const getAgent = (name: string) => {
  const rows = agentcore.tables.agents(nameToBigInt('agentcore')).getTableRows();
  return rows.find((r: any) => r.account === name);
};

const getPlugin = (id: number) => {
  return agentcore.tables.plugins(nameToBigInt('agentcore')).getTableRow(BigInt(id));
};

const getAgentPlugin = (id: number) => {
  return agentcore.tables.agentplugs(nameToBigInt('agentcore')).getTableRow(BigInt(id));
};

const getConfig = () => {
  return agentcore.tables.config(nameToBigInt('agentcore')).getTableRows()[0];
};

/* common valid registration args */
const validReg = (account: string) => [
  account,
  'Test Agent',
  'A test agent for testing purposes',
  'https://api.test.com',
  'https',
  '["chat","compute"]',
];

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('agentcore', () => {

  beforeEach(() => {
    blockchain.resetTables();
  });

  /* ==================== Initialization ==================== */

  describe('init', () => {
    it('should initialize the contract', async () => {
      await agentcore.actions.init(['owner', 0, 100000, '', '', '']).send('agentcore@active');
      const cfg = getConfig();
      expect(cfg.owner).to.equal('owner');
      expect(cfg.claim_fee).to.equal(100000);
      expect(cfg.paused).to.equal(false);
    });

    it('should prevent re-initialization', async () => {
      await agentcore.actions.init(['owner', 0, 100000, '', '', '']).send('agentcore@active');
      await expectToThrow(
        agentcore.actions.init(['owner', 0, 100000, '', '', '']).send('agentcore@active'),
        protonAssert('Contract already initialized. Use setconfig to modify settings.')
      );
    });

    it('should require contract auth', async () => {
      await expectToThrow(
        agentcore.actions.init(['owner', 0, 100000, '', '', '']).send('alice@active'),
        'missing required authority agentcore'
      );
    });
  });

  /* ==================== Registration ==================== */

  describe('register', () => {
    beforeEach(async () => {
      await agentcore.actions.init(['owner', 0, 100000, '', '', '']).send('agentcore@active');
    });

    it('should register an agent', async () => {
      await agentcore.actions.register(validReg('alice')).send('alice@active');
      const agent = getAgent('alice');
      expect(agent).to.not.be.undefined;
      expect(agent.name).to.equal('Test Agent');
      expect(agent.active).to.equal(true);
      expect(agent.total_jobs).to.equal(0);
    });

    it('should reject duplicate registration', async () => {
      await agentcore.actions.register(validReg('alice')).send('alice@active');
      await expectToThrow(
        agentcore.actions.register(validReg('alice')).send('alice@active'),
        protonAssert('Agent already registered')
      );
    });

    it('should require auth from the registering account', async () => {
      await expectToThrow(
        agentcore.actions.register(validReg('alice')).send('bob@active'),
        'missing required authority alice'
      );
    });

    it('should validate name length', async () => {
      await expectToThrow(
        agentcore.actions.register(['alice', '', 'desc', 'https://api.test.com', 'https', '[]']).send('alice@active'),
        protonAssert('Name must be 1-64 characters')
      );
    });

    it('should validate description must be non-empty', async () => {
      await expectToThrow(
        agentcore.actions.register(['alice', 'Test', '', 'https://api.test.com', 'https', '[]']).send('alice@active'),
        protonAssert('Description must be 1-256 characters')
      );
    });

    it('should validate endpoint URL format', async () => {
      await expectToThrow(
        agentcore.actions.register(['alice', 'Test', 'A description', 'ftp://bad.url', 'https', '[]']).send('alice@active'),
        protonAssert('Endpoint must start with http://, https://, grpc://, or wss://')
      );
    });

    it('should validate protocol', async () => {
      await expectToThrow(
        agentcore.actions.register(['alice', 'Test', 'A description', 'https://api.test.com', 'ftp', '[]']).send('alice@active'),
        protonAssert('Protocol must be: http, https, grpc, websocket, mqtt, or wss')
      );
    });

    it('should reject when paused', async () => {
      await agentcore.actions.setconfig([0, 0, 100000, '', '', '', true]).send('owner@active');
      await expectToThrow(
        agentcore.actions.register(validReg('alice')).send('alice@active'),
        protonAssert('Contract is paused')
      );
    });
  });

  /* ==================== Update ==================== */

  describe('update', () => {
    beforeEach(async () => {
      await agentcore.actions.init(['owner', 0, 100000, '', '', '']).send('agentcore@active');
      await agentcore.actions.register(validReg('alice')).send('alice@active');
    });

    it('should update agent metadata', async () => {
      await agentcore.actions.update(['alice', 'Updated Name', 'New desc', 'https://new.api.com', 'grpc', '["storage"]']).send('alice@active');
      const agent = getAgent('alice');
      expect(agent.name).to.equal('Updated Name');
      expect(agent.endpoint).to.equal('https://new.api.com');
      expect(agent.protocol).to.equal('grpc');
    });

    it('should reject update from wrong account', async () => {
      await expectToThrow(
        agentcore.actions.update(['alice', 'Updated', 'New desc', 'https://new.api.com', 'https', '[]']).send('bob@active'),
        'missing required authority alice'
      );
    });

    it('should reject update for non-existent agent', async () => {
      await expectToThrow(
        agentcore.actions.update(['bob', 'Updated', 'New desc', 'https://new.api.com', 'https', '[]']).send('bob@active'),
        protonAssert('Agent not found')
      );
    });
  });

  /* ==================== Set Status ==================== */

  describe('setstatus', () => {
    beforeEach(async () => {
      await agentcore.actions.init(['owner', 0, 100000, '', '', '']).send('agentcore@active');
      await agentcore.actions.register(validReg('alice')).send('alice@active');
    });

    it('should deactivate an agent', async () => {
      await agentcore.actions.setstatus(['alice', false]).send('alice@active');
      const agent = getAgent('alice');
      expect(agent.active).to.equal(false);
    });

    it('should reactivate an agent', async () => {
      await agentcore.actions.setstatus(['alice', false]).send('alice@active');
      await agentcore.actions.setstatus(['alice', true]).send('alice@active');
      const agent = getAgent('alice');
      expect(agent.active).to.equal(true);
    });
  });

  /* ==================== Increment Jobs ==================== */

  describe('incjobs', () => {
    beforeEach(async () => {
      await agentcore.actions.init(['owner', 0, 100000, '', '', '']).send('agentcore@active');
      await agentcore.actions.register(validReg('alice')).send('alice@active');
    });

    it('should increment job count (owner auth)', async () => {
      await agentcore.actions.incjobs(['alice']).send('owner@active');
      const agent = getAgent('alice');
      expect(agent.total_jobs).to.equal(1);
    });

    it('should increment multiple times', async () => {
      await agentcore.actions.incjobs(['alice']).send('owner@active');
      await agentcore.actions.incjobs(['alice']).send('owner@active');
      await agentcore.actions.incjobs(['alice']).send('owner@active');
      const agent = getAgent('alice');
      expect(agent.total_jobs).to.equal(3);
    });

    it('should reject unauthorized callers', async () => {
      await expectToThrow(
        agentcore.actions.incjobs(['alice']).send('bob@active'),
        protonAssert('Only authorized contracts can increment jobs')
      );
    });
  });

  /* ==================== Plugin Management ==================== */

  describe('plugins', () => {
    beforeEach(async () => {
      await agentcore.actions.init(['owner', 0, 100000, '', '', '']).send('agentcore@active');
      await agentcore.actions.register(validReg('alice')).send('alice@active');
    });

    it('should register a plugin', async () => {
      await agentcore.actions.regplugin(['alice', 'TestPlugin', '1.0.0', 'plugcon', 'execute', '{}', 'compute']).send('alice@active');
      const plugin = getPlugin(0);
      expect(plugin).to.not.be.undefined;
      expect(plugin.name).to.equal('TestPlugin');
      expect(plugin.category).to.equal('compute');
      expect(plugin.verified).to.equal(false);
    });

    it('should reject invalid plugin category', async () => {
      await expectToThrow(
        agentcore.actions.regplugin(['alice', 'TestPlugin', '1.0.0', 'plugcon', 'execute', '{}', 'invalid']).send('alice@active'),
        protonAssert('Invalid category')
      );
    });

    it('should reject plugin with empty name', async () => {
      await expectToThrow(
        agentcore.actions.regplugin(['alice', '', '1.0.0', 'plugcon', 'execute', '{}', 'compute']).send('alice@active'),
        protonAssert('Name must be 1-64 characters')
      );
    });

    it('should add a plugin to an agent', async () => {
      await agentcore.actions.regplugin(['alice', 'TestPlugin', '1.0.0', 'plugcon', 'execute', '{}', 'compute']).send('alice@active');
      await agentcore.actions.addplugin(['alice', 0, '{"key":"val"}']).send('alice@active');
      const ap = getAgentPlugin(0);
      expect(ap).to.not.be.undefined;
      expect(ap.agent).to.equal('alice');
      expect(ap.enabled).to.equal(true);
    });

    it('should remove a plugin from an agent', async () => {
      await agentcore.actions.regplugin(['alice', 'TestPlugin', '1.0.0', 'plugcon', 'execute', '{}', 'compute']).send('alice@active');
      await agentcore.actions.addplugin(['alice', 0, '{}']).send('alice@active');
      await agentcore.actions.rmplugin(['alice', 0]).send('alice@active');
      const ap = getAgentPlugin(0);
      expect(ap).to.be.undefined;
    });

    it('should reject removing another agent\'s plugin', async () => {
      await agentcore.actions.register(validReg('bob')).send('bob@active');
      await agentcore.actions.regplugin(['alice', 'TestPlugin', '1.0.0', 'plugcon', 'execute', '{}', 'compute']).send('alice@active');
      await agentcore.actions.addplugin(['alice', 0, '{}']).send('alice@active');
      await expectToThrow(
        agentcore.actions.rmplugin(['bob', 0]).send('bob@active'),
        protonAssert('Not your plugin')
      );
    });

    it('should toggle a plugin', async () => {
      await agentcore.actions.regplugin(['alice', 'TestPlugin', '1.0.0', 'plugcon', 'execute', '{}', 'compute']).send('alice@active');
      await agentcore.actions.addplugin(['alice', 0, '{}']).send('alice@active');
      await agentcore.actions.toggleplug(['alice', 0, false]).send('alice@active');
      let ap = getAgentPlugin(0);
      expect(ap.enabled).to.equal(false);
      await agentcore.actions.toggleplug(['alice', 0, true]).send('alice@active');
      ap = getAgentPlugin(0);
      expect(ap.enabled).to.equal(true);
    });
  });

  /* ==================== setowner (governance) ==================== */

  describe('setowner', () => {
    beforeEach(async () => {
      await agentcore.actions.init(['owner', 0, 100000, '', '', '']).send('agentcore@active');
    });

    it('should transfer contract ownership', async () => {
      await agentcore.actions.setowner(['bob']).send('owner@active');
      const cfg = getConfig();
      expect(cfg.owner).to.equal('bob');
    });

    it('should reject from non-owner', async () => {
      await expectToThrow(
        agentcore.actions.setowner(['bob']).send('alice@active'),
        'missing required authority owner'
      );
    });

    it('new owner can use admin actions', async () => {
      await agentcore.actions.setowner(['bob']).send('owner@active');
      // bob should now be able to setconfig
      await agentcore.actions.setconfig([0, 0, 200000, '', '', '', false]).send('bob@active');
      const cfg = getConfig();
      expect(cfg.claim_fee).to.equal(200000);
    });
  });

  /* ==================== setconfig ==================== */

  describe('setconfig', () => {
    beforeEach(async () => {
      await agentcore.actions.init(['owner', 0, 100000, '', '', '']).send('agentcore@active');
    });

    it('should update config', async () => {
      await agentcore.actions.setconfig([100, 0, 200000, '', '', '', false]).send('owner@active');
      const cfg = getConfig();
      expect(cfg.min_stake).to.equal(100);
      expect(cfg.claim_fee).to.equal(200000);
    });

    it('should pause the contract', async () => {
      await agentcore.actions.setconfig([0, 0, 100000, '', '', '', true]).send('owner@active');
      const cfg = getConfig();
      expect(cfg.paused).to.equal(true);
    });

    it('should reject from non-owner', async () => {
      await expectToThrow(
        agentcore.actions.setconfig([100, 0, 200000, '', '', '', false]).send('alice@active'),
        'missing required authority owner'
      );
    });
  });
});

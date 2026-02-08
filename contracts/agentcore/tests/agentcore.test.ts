import { expect } from 'chai';
import { Blockchain, protonAssert, expectToThrow, mintTokens, nameToBigInt } from '@proton/vert';

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                          */
/* ------------------------------------------------------------------ */

const blockchain = new Blockchain();

// Contract under test — sendsInline=true for token refund transfers
const agentcore = blockchain.createContract('agentcore', 'assembly/target/agentcore.contract', true);

// eosio.token for claim deposits
const eosioToken = blockchain.createContract('eosio.token', 'node_modules/proton-tsc/external/eosio.token/eosio.token');

// eosio.proton mock for KYC data — needs both ABI + wasm for table accessors to work
const USERSINFO_ABI = {
  version: 'eosio::abi/1.1',
  types: [],
  structs: [{
    name: 'usersinfo',
    base: '',
    fields: [
      { name: 'acc', type: 'name' },
      { name: 'name', type: 'string' },
      { name: 'avatar', type: 'string' },
      { name: 'verified', type: 'uint8' },
      { name: 'date', type: 'uint64' },
      { name: 'verifiedon', type: 'uint64' },
      { name: 'verifier', type: 'name' },
      { name: 'raccs', type: 'name[]' },
      { name: 'aacts', type: 'string[]' },
      { name: 'ac', type: 'uint64[]' },
      { name: 'kyc', type: 'uint8[]' },
    ],
  }],
  actions: [],
  tables: [{
    name: 'usersinfo',
    index_type: 'i64',
    key_names: ['acc'],
    key_types: ['name'],
    type: 'usersinfo',
  }],
  ricardian_clauses: [],
  variants: [],
};
// Minimal valid wasm module (empty)
const MINIMAL_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

const eosioProton = blockchain.createAccount({
  name: 'eosio.proton',
  abi: USERSINFO_ABI,
  wasm: MINIMAL_WASM,
});

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

/* Set KYC level for an account in eosio.proton::usersinfo */
const setKyc = (account: string, kycLevel: number) => {
  const scope = nameToBigInt('eosio.proton');
  eosioProton.tables.usersinfo(scope).set(nameToBigInt(account), 'eosio.proton' as any, {
    acc: account,
    name: '',
    avatar: '',
    verified: kycLevel > 0 ? 1 : 0,
    date: 0,
    verifiedon: 0,
    verifier: '',
    raccs: [],
    aacts: [],
    ac: [],
    kyc: kycLevel > 0 ? [kycLevel] : [],
  });
};

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

  /* ==================== Ownership / Claim Lifecycle ==================== */

  describe('ownership lifecycle', () => {
    beforeEach(async () => {
      await agentcore.actions.init(['owner', 0, 100000, '', '', '']).send('agentcore@active');
      await mintTokens(eosioToken, 'XPR', 4, 1000000000, 100000, [owner, alice, bob, carol]);
      await agentcore.actions.register(validReg('alice')).send('alice@active');
    });

    describe('approveclaim', () => {
      it('should set pending_owner on unowned agent', async () => {
        setKyc('bob', 2);
        await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');
        const agent = getAgent('alice');
        expect(agent.pending_owner).to.equal('bob');
      });

      it('should reject if agent already has an owner', async () => {
        // First complete a claim so alice has an owner
        setKyc('bob', 2);
        await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');
        await eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:alice:bob']).send('bob@active');
        await agentcore.actions.claim(['alice']).send('bob@active');

        setKyc('carol', 2);
        await expectToThrow(
          agentcore.actions.approveclaim(['alice', 'carol']).send('alice@active'),
          protonAssert('Agent already has an owner')
        );
      });

      it('should reject if new_owner has no KYC', async () => {
        // bob has no KYC
        await expectToThrow(
          agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active'),
          protonAssert('Approved owner must have KYC level 1 or higher')
        );
      });

      it('should reject from non-agent auth', async () => {
        await expectToThrow(
          agentcore.actions.approveclaim(['alice', 'bob']).send('bob@active'),
          'missing required authority alice'
        );
      });
    });

    describe('claim (with deposit)', () => {
      it('should complete claim when KYC valid and fee paid', async () => {
        setKyc('bob', 2);
        await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');
        await eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:alice:bob']).send('bob@active');
        await agentcore.actions.claim(['alice']).send('bob@active');

        const agent = getAgent('alice');
        expect(agent.owner).to.equal('bob');
        expect(agent.pending_owner).to.equal('');
        expect(agent.claim_deposit).to.equal(100000); // 10.0000 XPR stored
        expect(agent.deposit_payer).to.equal('bob');
      });

      it('should reject claim without deposit when fee is required', async () => {
        setKyc('bob', 2);
        await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');

        await expectToThrow(
          agentcore.actions.claim(['alice']).send('bob@active'),
          protonAssert("Claim fee not paid. Send 10 XPR to this contract with memo 'claim:alice:bob'")
        );
      });

      it('should abort claim and refund if KYC revoked between approve and claim', async () => {
        setKyc('bob', 2);
        await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');
        await eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:alice:bob']).send('bob@active');

        // Revoke KYC before claim
        setKyc('bob', 0);

        // claim should NOT throw — it gracefully aborts and refunds
        await agentcore.actions.claim(['alice']).send('bob@active');

        const agent = getAgent('alice');
        expect(agent.owner).to.equal(''); // ownership NOT assigned
        expect(agent.pending_owner).to.equal(''); // pending cleared
        expect(agent.claim_deposit).to.equal(0); // deposit refunded
      });

      it('should reject if no pending claim', async () => {
        setKyc('bob', 2);
        await expectToThrow(
          agentcore.actions.claim(['alice']).send('bob@active'),
          protonAssert('Agent has not approved any claimant. Agent must call approveclaim first.')
        );
      });

      it('should reject claim from wrong account', async () => {
        setKyc('bob', 2);
        await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');
        await expectToThrow(
          agentcore.actions.claim(['alice']).send('carol@active'),
          'missing required authority bob'
        );
      });
    });

    describe('cancelclaim', () => {
      it('should cancel pending claim and refund deposit', async () => {
        setKyc('bob', 2);
        await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');
        await eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:alice:bob']).send('bob@active');

        await agentcore.actions.cancelclaim(['alice']).send('alice@active');

        const agent = getAgent('alice');
        expect(agent.pending_owner).to.equal('');
        expect(agent.claim_deposit).to.equal(0);
      });

      it('should cancel pending claim without deposit', async () => {
        setKyc('bob', 2);
        await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');
        await agentcore.actions.cancelclaim(['alice']).send('alice@active');

        const agent = getAgent('alice');
        expect(agent.pending_owner).to.equal('');
      });

      it('should reject if no pending claim', async () => {
        await expectToThrow(
          agentcore.actions.cancelclaim(['alice']).send('alice@active'),
          protonAssert('No pending claim to cancel')
        );
      });

      it('should reject from non-agent auth', async () => {
        setKyc('bob', 2);
        await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');
        await expectToThrow(
          agentcore.actions.cancelclaim(['alice']).send('bob@active'),
          'missing required authority alice'
        );
      });
    });

    describe('release', () => {
      beforeEach(async () => {
        setKyc('bob', 2);
        await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');
        await eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:alice:bob']).send('bob@active');
        await agentcore.actions.claim(['alice']).send('bob@active');
      });

      it('should release ownership and refund deposit to original payer', async () => {
        await agentcore.actions.release(['alice']).send('bob@active');

        const agent = getAgent('alice');
        expect(agent.owner).to.equal('');
        expect(agent.claim_deposit).to.equal(0);
        expect(agent.deposit_payer).to.equal('');
      });

      it('should reject release from non-owner', async () => {
        await expectToThrow(
          agentcore.actions.release(['alice']).send('alice@active'),
          'missing required authority bob'
        );
      });

      it('should reject release if no owner', async () => {
        await agentcore.actions.release(['alice']).send('bob@active');
        await expectToThrow(
          agentcore.actions.release(['alice']).send('bob@active'),
          protonAssert('Agent has no owner')
        );
      });
    });

    describe('verifyclaim', () => {
      beforeEach(async () => {
        setKyc('bob', 2);
        await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');
        await eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:alice:bob']).send('bob@active');
        await agentcore.actions.claim(['alice']).send('bob@active');
      });

      it('should do nothing when KYC is still valid', async () => {
        // bob still has KYC level 2
        await agentcore.actions.verifyclaim(['alice']).send('carol@active');
        const agent = getAgent('alice');
        expect(agent.owner).to.equal('bob'); // unchanged
      });

      it('should remove ownership when KYC revoked', async () => {
        // Remove bob's KYC by setting level 0
        setKyc('bob', 0);

        await agentcore.actions.verifyclaim(['alice']).send('carol@active');

        const agent = getAgent('alice');
        expect(agent.owner).to.equal(''); // ownership removed
        expect(agent.claim_deposit).to.equal(0); // deposit refunded
      });

      it('should reject if agent has no owner', async () => {
        await agentcore.actions.release(['alice']).send('bob@active');
        await expectToThrow(
          agentcore.actions.verifyclaim(['alice']).send('carol@active'),
          protonAssert('Agent has no owner to verify')
        );
      });

      it('anyone can call verifyclaim (permissionless)', async () => {
        // carol can call it even though she's unrelated
        await agentcore.actions.verifyclaim(['alice']).send('carol@active');
        // No error means it works
      });
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

  /* ==================== Token Transfer Handler (onTransfer) ==================== */

  describe('onTransfer (claim deposit)', () => {
    beforeEach(async () => {
      await agentcore.actions.init(['owner', 0, 100000, '', '', '']).send('agentcore@active');
      await mintTokens(eosioToken, 'XPR', 4, 1000000000, 100000, [owner, alice, bob, carol]);
      await agentcore.actions.register(validReg('alice')).send('alice@active');
    });

    it('should accept valid claim deposit with correct memo format', async () => {
      setKyc('bob', 2);
      await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');

      await eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:alice:bob']).send('bob@active');

      const agent = getAgent('alice');
      expect(agent.claim_deposit).to.equal(100000);
      expect(agent.deposit_payer).to.equal('bob');
    });

    it('should reject memo with missing parts (only "claim:")', async () => {
      setKyc('bob', 2);
      await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');

      await expectToThrow(
        eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:']).send('bob@active'),
        protonAssert('Invalid memo format. Use: claim:agentname:ownername')
      );
    });

    it('should reject memo with too many parts', async () => {
      setKyc('bob', 2);
      await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');

      await expectToThrow(
        eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:alice:bob:extra']).send('bob@active'),
        protonAssert('Invalid memo format. Use: claim:agentname:ownername')
      );
    });

    it('should reject transfer with unrecognized memo', async () => {
      await expectToThrow(
        eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'something']).send('bob@active'),
        protonAssert("Invalid memo. Use 'regfee:accountname' or 'claim:agentname:ownername'")
      );
    });

    it('should reject claim deposit if agent has not approved a claimant', async () => {
      await expectToThrow(
        eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:alice:bob']).send('bob@active'),
        protonAssert('Agent has not approved any claimant yet. Agent must call approveclaim first.')
      );
    });

    it('should reject claim deposit if payer does not match intended owner in memo', async () => {
      setKyc('bob', 2);
      await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');

      // carol tries to pay deposit for bob
      await expectToThrow(
        eosioToken.actions.transfer(['carol', 'agentcore', '10.0000 XPR', 'claim:alice:bob']).send('carol@active'),
        protonAssert('Payer must match intended owner in memo. You cannot pay deposit for someone else.')
      );
    });

    it('should reject claim deposit if agent approved a different claimant', async () => {
      setKyc('bob', 2);
      setKyc('carol', 2);
      await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');

      // carol tries to send a deposit specifying herself as owner
      await expectToThrow(
        eosioToken.actions.transfer(['carol', 'agentcore', '10.0000 XPR', 'claim:alice:carol']).send('carol@active'),
        'eosio_assert: Agent approved a different claimant. Deposit must be from approved account: bob'
      );
    });

    it('should reject claim deposit for non-existent agent', async () => {
      await expectToThrow(
        eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:nonexist:bob']).send('bob@active'),
        protonAssert('Agent not found: nonexist')
      );
    });

    it('should reject claim deposit if agent already has an owner', async () => {
      setKyc('bob', 2);
      await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');
      await eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:alice:bob']).send('bob@active');
      await agentcore.actions.claim(['alice']).send('bob@active');

      // Now alice is owned by bob, try another deposit
      await expectToThrow(
        eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:alice:bob']).send('bob@active'),
        protonAssert('Agent already has an owner')
      );
    });

    it('should cap deposit at claim_fee and refund excess', async () => {
      setKyc('bob', 2);
      await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');

      // Send more than required (claim_fee is 10.0000 XPR = 100000)
      await eosioToken.actions.transfer(['bob', 'agentcore', '20.0000 XPR', 'claim:alice:bob']).send('bob@active');

      const agent = getAgent('alice');
      // Deposit should be capped at claim_fee
      expect(agent.claim_deposit).to.equal(100000);
    });

    it('should accept regfee memo for registration fee deposit', async () => {
      // Set a registration fee
      await agentcore.actions.setconfig([0, 50000, 100000, '', '', '', false]).send('owner@active');

      await eosioToken.actions.transfer(['bob', 'agentcore', '5.0000 XPR', 'regfee:bob']).send('bob@active');

      // Check deposits table
      const deposits = agentcore.tables.deposits(nameToBigInt('agentcore')).getTableRows();
      expect(deposits.length).to.equal(1);
      expect(deposits[0].account).to.equal('bob');
      expect(deposits[0].amount).to.equal(50000);
    });

    it('should reject regfee memo if payer does not match account', async () => {
      await expectToThrow(
        eosioToken.actions.transfer(['carol', 'agentcore', '5.0000 XPR', 'regfee:bob']).send('carol@active'),
        protonAssert('Payer must match account in memo')
      );
    });

    it('should verify claim deposit is refunded on release', async () => {
      setKyc('bob', 2);
      await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');
      await eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:alice:bob']).send('bob@active');
      await agentcore.actions.claim(['alice']).send('bob@active');

      // Verify deposit was stored
      let agent = getAgent('alice');
      expect(agent.claim_deposit).to.equal(100000);
      expect(agent.deposit_payer).to.equal('bob');

      // Release triggers refund (inline transfer)
      await agentcore.actions.release(['alice']).send('bob@active');

      agent = getAgent('alice');
      expect(agent.claim_deposit).to.equal(0);
      expect(agent.deposit_payer).to.equal('');
      expect(agent.owner).to.equal('');
    });

    it('should verify claim deposit is refunded on cancelclaim', async () => {
      setKyc('bob', 2);
      await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');
      await eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:alice:bob']).send('bob@active');

      // Cancel the claim - should refund the deposit
      await agentcore.actions.cancelclaim(['alice']).send('alice@active');

      const agent = getAgent('alice');
      expect(agent.pending_owner).to.equal('');
      expect(agent.claim_deposit).to.equal(0);
      expect(agent.deposit_payer).to.equal('');
    });

    it('should accumulate deposits from same payer', async () => {
      // Set a lower claim_fee to test accumulation
      await agentcore.actions.setconfig([0, 0, 200000, '', '', '', false]).send('owner@active');

      setKyc('bob', 2);
      await agentcore.actions.approveclaim(['alice', 'bob']).send('alice@active');

      // Send first partial deposit
      await eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:alice:bob']).send('bob@active');
      let agent = getAgent('alice');
      expect(agent.claim_deposit).to.equal(100000);

      // Send second partial deposit
      await eosioToken.actions.transfer(['bob', 'agentcore', '10.0000 XPR', 'claim:alice:bob']).send('bob@active');
      agent = getAgent('alice');
      expect(agent.claim_deposit).to.equal(200000); // capped at claim_fee
    });
  });
});

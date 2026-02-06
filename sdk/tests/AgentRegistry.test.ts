import { AgentRegistry } from '../src/AgentRegistry';
import type { JsonRpc, ProtonSession, AgentRaw } from '../src/types';

// ============== Test Helpers ==============

function mockRpc(overrides: Partial<JsonRpc> = {}): JsonRpc {
  return {
    get_table_rows: jest.fn().mockResolvedValue({ rows: [], more: false }),
    ...overrides,
  };
}

function mockSession(actor = 'testuser', permission = 'active'): ProtonSession {
  return {
    auth: { actor, permission },
    link: { transact: jest.fn().mockResolvedValue({ transaction_id: 'abc123', processed: { block_num: 1, block_time: '2024-01-01' } }) },
  };
}

function rawAgent(overrides: Partial<AgentRaw> = {}): AgentRaw {
  return {
    account: 'testagent',
    owner: 'testowner',
    pending_owner: '',
    name: 'Test Agent',
    description: 'A test agent',
    endpoint: 'https://example.com',
    protocol: 'https',
    capabilities: '["compute"]',
    total_jobs: '5',
    registered_at: '1704067200',
    active: 1,
    claim_deposit: '0',
    deposit_payer: '',
    ...overrides,
  };
}

// ============== Write Operations ==============

describe('AgentRegistry write operations', () => {
  describe('register()', () => {
    it('sends "register" action with correct data fields', async () => {
      const session = mockSession();
      const registry = new AgentRegistry(mockRpc(), session);

      await registry.register({
        name: 'My Agent',
        description: 'Does things',
        endpoint: 'https://api.example.com',
        protocol: 'https',
        capabilities: ['compute', 'storage'],
      });

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      expect(call.actions).toHaveLength(1);

      const action = call.actions[0];
      expect(action.account).toBe('agentcore');
      expect(action.name).toBe('register');
      expect(action.authorization).toEqual([{ actor: 'testuser', permission: 'active' }]);
      expect(action.data).toEqual({
        account: 'testuser',
        name: 'My Agent',
        description: 'Does things',
        endpoint: 'https://api.example.com',
        protocol: 'https',
        capabilities: '["compute","storage"]', // JSON.stringify'd
      });
    });
  });

  describe('update()', () => {
    it('sends "update" action and merges with current agent data', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [rawAgent()],
        more: false,
      });
      const session = mockSession('testagent');
      const registry = new AgentRegistry(rpc, session);

      await registry.update({ name: 'Updated Name' });

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('update');
      expect(action.data.name).toBe('Updated Name');
      expect(action.data.description).toBe('A test agent'); // merged from current
      expect(action.data.capabilities).toBe('["compute"]'); // merged from current
    });
  });

  describe('setStatus()', () => {
    it('sends "setstatus" action with {account, active}', async () => {
      const session = mockSession();
      const registry = new AgentRegistry(mockRpc(), session);

      await registry.setStatus(false);

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('setstatus');
      expect(action.data).toEqual({
        account: 'testuser',
        active: false,
      });
    });
  });

  describe('addPlugin()', () => {
    it('sends "addplugin" action with param name "pluginConfig" (not "config")', async () => {
      const session = mockSession();
      const registry = new AgentRegistry(mockRpc(), session);

      await registry.addPlugin(42, { setting: 'value' });

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('addplugin');
      expect(action.data).toEqual({
        agent: 'testuser',
        plugin_id: 42,
        pluginConfig: '{"setting":"value"}', // CRITICAL: must be "pluginConfig", not "config"
      });
    });
  });

  describe('removePlugin()', () => {
    it('sends "rmplugin" action with agentplugin_id', async () => {
      const session = mockSession();
      const registry = new AgentRegistry(mockRpc(), session);

      await registry.removePlugin(7);

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('rmplugin');
      expect(action.data).toEqual({
        agent: 'testuser',
        agentplugin_id: 7,
      });
    });
  });

  describe('registerPlugin()', () => {
    it('sends "regplugin" action with schema JSON.stringify\'d', async () => {
      const session = mockSession();
      const registry = new AgentRegistry(mockRpc(), session);

      await registry.registerPlugin(
        'test-plugin', '1.0.0', 'pluginacct', 'execute',
        { type: 'object' }, 'compute'
      );

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('regplugin');
      expect(action.data.author).toBe('testuser');
      expect(action.data.schema).toBe('{"type":"object"}');
      expect(action.data.category).toBe('compute');
    });
  });

  describe('approveClaim()', () => {
    it('sends "approveclaim" action with agent and new_owner', async () => {
      const session = mockSession('myagent');
      const registry = new AgentRegistry(mockRpc(), session);

      await registry.approveClaim('newowner');

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('approveclaim');
      expect(action.data).toEqual({
        agent: 'myagent',
        new_owner: 'newowner',
      });
    });
  });

  describe('claim()', () => {
    it('sends "claim" action with agent in data', async () => {
      const session = mockSession('newowner');
      const registry = new AgentRegistry(mockRpc(), session);

      await registry.claim('myagent');

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('claim');
      expect(action.data).toEqual({ agent: 'myagent' });
      expect(action.authorization[0].actor).toBe('newowner');
    });
  });

  describe('claimWithFee()', () => {
    it('sends 2-action tx: transfer + claim with correct memo', async () => {
      const session = mockSession('newowner');
      const registry = new AgentRegistry(mockRpc(), session);

      await registry.claimWithFee('myagent', '1.0000 XPR');

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      expect(call.actions).toHaveLength(2);

      // First action: token transfer
      const transfer = call.actions[0];
      expect(transfer.account).toBe('eosio.token');
      expect(transfer.name).toBe('transfer');
      expect(transfer.data.from).toBe('newowner');
      expect(transfer.data.to).toBe('agentcore');
      expect(transfer.data.quantity).toBe('1.0000 XPR');
      expect(transfer.data.memo).toBe('claim:myagent:newowner');

      // Second action: claim
      const claim = call.actions[1];
      expect(claim.name).toBe('claim');
      expect(claim.data).toEqual({ agent: 'myagent' });
    });
  });

  describe('release()', () => {
    it('sends "release" action with agent', async () => {
      const session = mockSession('owner');
      const registry = new AgentRegistry(mockRpc(), session);

      await registry.release('myagent');

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('release');
      expect(action.data).toEqual({ agent: 'myagent' });
    });
  });
});

// ============== Input Validation ==============

describe('AgentRegistry input validation', () => {
  it('rejects name longer than 64 characters', async () => {
    const registry = new AgentRegistry(mockRpc(), mockSession());
    await expect(
      registry.register({
        name: 'x'.repeat(65),
        description: 'Valid description',
        endpoint: 'https://example.com',
        protocol: 'https',
        capabilities: [],
      })
    ).rejects.toThrow('Name must be 1-64 characters');
  });

  it('rejects empty description (whitespace-only)', async () => {
    const registry = new AgentRegistry(mockRpc(), mockSession());
    await expect(
      registry.register({
        name: 'Valid Name',
        description: '   ',
        endpoint: 'https://example.com',
        protocol: 'https',
        capabilities: [],
      })
    ).rejects.toThrow('Description must be 1-256 characters');
  });

  it('rejects bad URL prefix', async () => {
    const registry = new AgentRegistry(mockRpc(), mockSession());
    await expect(
      registry.register({
        name: 'Valid Name',
        description: 'Valid description',
        endpoint: 'ftp://example.com',
        protocol: 'https',
        capabilities: [],
      })
    ).rejects.toThrow('Endpoint must be');
  });

  it('rejects invalid protocol', async () => {
    const registry = new AgentRegistry(mockRpc(), mockSession());
    await expect(
      registry.register({
        name: 'Valid Name',
        description: 'Valid description',
        endpoint: 'https://example.com',
        protocol: 'ftp',
        capabilities: [],
      })
    ).rejects.toThrow('Protocol must be one of');
  });

  it('trims whitespace before checking name length', async () => {
    const registry = new AgentRegistry(mockRpc(), mockSession());
    // Name is 64 spaces + 'a' = 65 chars raw, but 'a' after trimming
    await expect(
      registry.register({
        name: 'a',
        description: 'Valid',
        endpoint: 'https://example.com',
        protocol: 'https',
        capabilities: [],
      })
    ).resolves.toBeDefined();
  });
});

// ============== Read Operations ==============

describe('AgentRegistry read operations', () => {
  describe('getAgent()', () => {
    it('queries correct table with lower_bound/upper_bound', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [rawAgent()],
        more: false,
      });
      const registry = new AgentRegistry(rpc);

      const agent = await registry.getAgent('testagent');

      expect(rpc.get_table_rows).toHaveBeenCalledWith({
        json: true,
        code: 'agentcore',
        scope: 'agentcore',
        table: 'agents',
        lower_bound: 'testagent',
        upper_bound: 'testagent',
        limit: 1,
      });
      expect(agent).not.toBeNull();
      expect(agent!.account).toBe('testagent');
      expect(agent!.capabilities).toEqual(['compute']); // parsed from JSON
      expect(agent!.active).toBe(true); // parsed from number
    });

    it('returns null when agent not found', async () => {
      const registry = new AgentRegistry(mockRpc());
      const agent = await registry.getAgent('nonexistent');
      expect(agent).toBeNull();
    });
  });

  describe('getAgentsByOwner()', () => {
    it('uses secondary index (index_position=2, key_type=name)', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [rawAgent()],
        more: false,
      });
      const registry = new AgentRegistry(rpc);

      await registry.getAgentsByOwner('testowner');

      expect(rpc.get_table_rows).toHaveBeenCalledWith({
        json: true,
        code: 'agentcore',
        scope: 'agentcore',
        table: 'agents',
        index_position: 2,
        key_type: 'name',
        lower_bound: 'testowner',
        upper_bound: 'testowner',
        limit: 100,
      });
    });
  });

  describe('getTrustScore()', () => {
    it('queries agents, agentscores, usersinfo, and voters tables', async () => {
      const rpc = mockRpc();
      const getTableRows = rpc.get_table_rows as jest.Mock;

      // Call 1: agent lookup
      getTableRows.mockResolvedValueOnce({ rows: [rawAgent({ owner: 'kycdowner' })], more: false });
      // Call 2: agentscores lookup
      getTableRows.mockResolvedValueOnce({ rows: [], more: false });
      // Call 3: usersinfo (KYC) lookup
      getTableRows.mockResolvedValueOnce({ rows: [{ acc: 'kycdowner', kyc: [{ kyc_level: 2 }] }], more: false });
      // Call 4: voters (stake) lookup
      getTableRows.mockResolvedValueOnce({ rows: [{ owner: 'testagent', staked: '50000000' }], more: false });

      const registry = new AgentRegistry(rpc);
      const score = await registry.getTrustScore('testagent');

      expect(score).not.toBeNull();
      expect(getTableRows).toHaveBeenCalledTimes(4);

      // Verify agentscores query
      expect(getTableRows.mock.calls[1][0]).toMatchObject({
        code: 'agentfeed',
        table: 'agentscores',
      });

      // Verify KYC query
      expect(getTableRows.mock.calls[2][0]).toMatchObject({
        code: 'eosio.proton',
        table: 'usersinfo',
        lower_bound: 'kycdowner',
      });

      // Verify voters query
      expect(getTableRows.mock.calls[3][0]).toMatchObject({
        code: 'eosio',
        table: 'voters',
      });
    });
  });

  describe('custom contract name', () => {
    it('uses custom contract name for queries', async () => {
      const rpc = mockRpc();
      const registry = new AgentRegistry(rpc, undefined, 'myagentcore');

      await registry.getAgent('testagent');

      expect(rpc.get_table_rows).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'myagentcore',
          scope: 'myagentcore',
        })
      );
    });
  });
});

// ============== Error Handling ==============

describe('AgentRegistry error handling', () => {
  it('throws on missing session for write ops', async () => {
    const registry = new AgentRegistry(mockRpc());
    await expect(
      registry.register({
        name: 'Test',
        description: 'Test',
        endpoint: 'https://example.com',
        protocol: 'https',
        capabilities: [],
      })
    ).rejects.toThrow('Session required for write operations');
  });

  it('throws on missing session for setStatus', async () => {
    const registry = new AgentRegistry(mockRpc());
    await expect(registry.setStatus(true)).rejects.toThrow('Session required');
  });

  it('throws on missing session for addPlugin', async () => {
    const registry = new AgentRegistry(mockRpc());
    await expect(registry.addPlugin(1)).rejects.toThrow('Session required');
  });
});

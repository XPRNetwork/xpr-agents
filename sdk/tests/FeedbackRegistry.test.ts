import { FeedbackRegistry } from '../src/FeedbackRegistry';
import type { JsonRpc, ProtonSession } from '../src/types';

// ============== Test Helpers ==============

function mockRpc(): JsonRpc {
  return {
    get_table_rows: jest.fn().mockResolvedValue({ rows: [], more: false }),
  };
}

function mockSession(actor = 'testuser', permission = 'active'): ProtonSession {
  return {
    auth: { actor, permission },
    link: { transact: jest.fn().mockResolvedValue({ transaction_id: 'abc123', processed: { block_num: 1, block_time: '2024-01-01' } }) },
  };
}

// ============== Write Operations ==============

describe('FeedbackRegistry write operations', () => {
  describe('submit()', () => {
    it('sends "submit" action with tags joined by comma', async () => {
      const session = mockSession();
      const registry = new FeedbackRegistry(mockRpc(), session);

      await registry.submit({
        agent: 'testagent',
        score: 5,
        tags: ['fast', 'reliable'],
        job_hash: 'abc123',
        evidence_uri: 'https://evidence.com/proof',
        amount_paid: 10000,
      });

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.account).toBe('agentfeed');
      expect(action.name).toBe('submit');
      expect(action.data).toEqual({
        reviewer: 'testuser',
        agent: 'testagent',
        score: 5,
        tags: 'fast,reliable', // CRITICAL: comma-joined, not array
        job_hash: 'abc123',
        evidence_uri: 'https://evidence.com/proof',
        amount_paid: 10000,
      });
    });

    it('defaults optional fields', async () => {
      const session = mockSession();
      const registry = new FeedbackRegistry(mockRpc(), session);

      await registry.submit({ agent: 'testagent', score: 3 });

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const data = call.actions[0].data;
      expect(data.tags).toBe(''); // empty tags
      expect(data.job_hash).toBe('');
      expect(data.evidence_uri).toBe('');
      expect(data.amount_paid).toBe(0);
    });
  });

  describe('dispute()', () => {
    it('sends "dispute" action with correct fields', async () => {
      const session = mockSession();
      const registry = new FeedbackRegistry(mockRpc(), session);

      await registry.dispute(42, 'Fake feedback', 'https://proof.com');

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('dispute');
      expect(action.data).toEqual({
        disputer: 'testuser',
        feedback_id: 42,
        reason: 'Fake feedback',
        evidence_uri: 'https://proof.com',
      });
    });

    it('defaults evidence_uri to empty string', async () => {
      const session = mockSession();
      const registry = new FeedbackRegistry(mockRpc(), session);

      await registry.dispute(42, 'Fake feedback');

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      expect(call.actions[0].data.evidence_uri).toBe('');
    });
  });

  describe('recalculate()', () => {
    it('sends "recalc" action with agent, offset, limit', async () => {
      const session = mockSession();
      const registry = new FeedbackRegistry(mockRpc(), session);

      await registry.recalculate('testagent', 50, 25);

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('recalc');
      expect(action.data).toEqual({
        agent: 'testagent',
        offset: 50,
        limit: 25,
      });
    });

    it('defaults offset=0 and limit=100', async () => {
      const session = mockSession();
      const registry = new FeedbackRegistry(mockRpc(), session);

      await registry.recalculate('testagent');

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      expect(call.actions[0].data.offset).toBe(0);
      expect(call.actions[0].data.limit).toBe(100);
    });
  });

  describe('resolve()', () => {
    it('sends "resolve" action with dispute_id, upheld, resolution_notes', async () => {
      const session = mockSession();
      const registry = new FeedbackRegistry(mockRpc(), session);

      await registry.resolve(7, true, 'Feedback was indeed fake');

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('resolve');
      expect(action.data).toEqual({
        resolver: 'testuser',
        dispute_id: 7,
        upheld: true,
        resolution_notes: 'Feedback was indeed fake',
      });
    });
  });

  describe('cancelRecalculation()', () => {
    it('sends "cancelrecalc" action with agent', async () => {
      const session = mockSession();
      const registry = new FeedbackRegistry(mockRpc(), session);

      await registry.cancelRecalculation('testagent');

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('cancelrecalc');
      expect(action.data).toEqual({ agent: 'testagent' });
    });
  });
});

// ============== Read Operations ==============

describe('FeedbackRegistry read operations', () => {
  describe('listFeedbackForAgent()', () => {
    it('uses index_position=2 for byAgent secondary index', async () => {
      const rpc = mockRpc();
      const registry = new FeedbackRegistry(rpc);

      await registry.listFeedbackForAgent('testagent');

      expect(rpc.get_table_rows).toHaveBeenCalledWith(
        expect.objectContaining({
          table: 'feedback',
          index_position: 2,
          key_type: 'i64',
        })
      );
    });
  });

  describe('listFeedbackByReviewer()', () => {
    it('uses index_position=3 for byReviewer secondary index', async () => {
      const rpc = mockRpc();
      const registry = new FeedbackRegistry(rpc);

      await registry.listFeedbackByReviewer('reviewer1');

      expect(rpc.get_table_rows).toHaveBeenCalledWith(
        expect.objectContaining({
          table: 'feedback',
          index_position: 3,
          key_type: 'i64',
        })
      );
    });
  });

  describe('getAgentScore()', () => {
    it('queries agentscores table with correct scope', async () => {
      const rpc = mockRpc();
      const registry = new FeedbackRegistry(rpc);

      await registry.getAgentScore('testagent');

      expect(rpc.get_table_rows).toHaveBeenCalledWith({
        json: true,
        code: 'agentfeed',
        scope: 'agentfeed',
        table: 'agentscores',
        lower_bound: 'testagent',
        upper_bound: 'testagent',
        limit: 1,
      });
    });

    it('returns null when no score found', async () => {
      const registry = new FeedbackRegistry(mockRpc());
      const score = await registry.getAgentScore('nonexistent');
      expect(score).toBeNull();
    });

    it('parses raw score correctly', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [{
          agent: 'testagent',
          total_score: '50000',
          total_weight: '10',
          feedback_count: '5',
          avg_score: '8000',
          last_updated: '1704067200',
        }],
        more: false,
      });
      const registry = new FeedbackRegistry(rpc);

      const score = await registry.getAgentScore('testagent');
      expect(score).toEqual({
        agent: 'testagent',
        total_score: 50000,
        total_weight: 10,
        feedback_count: 5,
        avg_score: 8000,
        last_updated: 1704067200,
      });
    });
  });
});

// ============== Fee + Cleanup + Config ==============

describe('FeedbackRegistry fee and cleanup methods', () => {
  describe('submitWithFee()', () => {
    it('sends 2-action tx: transfer + submit', async () => {
      const session = mockSession();
      const registry = new FeedbackRegistry(mockRpc(), session);

      await registry.submitWithFee({
        agent: 'testagent',
        score: 5,
        tags: ['fast', 'reliable'],
        job_hash: 'abc123',
      }, '2.0000 XPR');

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      expect(call.actions).toHaveLength(2);

      // First action: token transfer with feedfee memo
      const transfer = call.actions[0];
      expect(transfer.account).toBe('eosio.token');
      expect(transfer.name).toBe('transfer');
      expect(transfer.data.from).toBe('testuser');
      expect(transfer.data.to).toBe('agentfeed');
      expect(transfer.data.quantity).toBe('2.0000 XPR');
      expect(transfer.data.memo).toBe('feedfee:testuser');

      // Second action: submit
      const submit = call.actions[1];
      expect(submit.account).toBe('agentfeed');
      expect(submit.name).toBe('submit');
      expect(submit.data).toEqual({
        reviewer: 'testuser',
        agent: 'testagent',
        score: 5,
        tags: 'fast,reliable',
        job_hash: 'abc123',
        evidence_uri: '',
        amount_paid: 0,
      });
    });
  });

  describe('cleanFeedback()', () => {
    it('sends "cleanfback" action with agent, max_age, max_delete', async () => {
      const session = mockSession();
      const registry = new FeedbackRegistry(mockRpc(), session);

      await registry.cleanFeedback('testagent', 7776000, 50);

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.account).toBe('agentfeed');
      expect(action.name).toBe('cleanfback');
      expect(action.data).toEqual({
        agent: 'testagent',
        max_age: 7776000,
        max_delete: 50,
      });
    });
  });

  describe('cleanDisputes()', () => {
    it('sends "cleandisps" action with max_age, max_delete', async () => {
      const session = mockSession();
      const registry = new FeedbackRegistry(mockRpc(), session);

      await registry.cleanDisputes(7776000, 100);

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.account).toBe('agentfeed');
      expect(action.name).toBe('cleandisps');
      expect(action.data).toEqual({
        max_age: 7776000,
        max_delete: 100,
      });
    });
  });

  describe('getConfig()', () => {
    it('reads config singleton and parses numeric fields', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [{
          owner: 'admin',
          core_contract: 'agentcore',
          min_score: 1,
          max_score: 5,
          dispute_window: '604800',
          decay_period: '7776000',
          decay_floor: '5000',
          paused: 0,
          feedback_fee: '10000',
        }],
        more: false,
      });
      const registry = new FeedbackRegistry(rpc);

      const config = await registry.getConfig();

      expect(rpc.get_table_rows).toHaveBeenCalledWith(expect.objectContaining({
        code: 'agentfeed',
        table: 'config',
        limit: 1,
      }));
      expect(config).toEqual({
        owner: 'admin',
        core_contract: 'agentcore',
        min_score: 1,
        max_score: 5,
        dispute_window: 604800,
        decay_period: 7776000,
        decay_floor: 5000,
        paused: false,
        feedback_fee: 10000,
      });
    });

    it('throws when contract not initialized', async () => {
      const registry = new FeedbackRegistry(mockRpc());
      await expect(registry.getConfig()).rejects.toThrow('Contract not initialized');
    });
  });
});

// ============== Error Handling ==============

describe('FeedbackRegistry error handling', () => {
  it('throws on missing session for submit', async () => {
    const registry = new FeedbackRegistry(mockRpc());
    await expect(
      registry.submit({ agent: 'testagent', score: 5 })
    ).rejects.toThrow('Session required for write operations');
  });

  it('throws on missing session for dispute', async () => {
    const registry = new FeedbackRegistry(mockRpc());
    await expect(
      registry.dispute(1, 'reason')
    ).rejects.toThrow('Session required');
  });
});

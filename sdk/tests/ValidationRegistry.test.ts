import { ValidationRegistry } from '../src/ValidationRegistry';
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

describe('ValidationRegistry write operations', () => {
  describe('registerValidator()', () => {
    it('sends "regval" action with specializations JSON.stringify\'d', async () => {
      const session = mockSession();
      const registry = new ValidationRegistry(mockRpc(), session);

      await registry.registerValidator('automated', ['nlp', 'code-review']);

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.account).toBe('agentvalid');
      expect(action.name).toBe('regval');
      expect(action.data).toEqual({
        account: 'testuser',
        method: 'automated',
        specializations: '["nlp","code-review"]',
      });
    });
  });

  describe('stake()', () => {
    it('sends token transfer with memo "stake"', async () => {
      const session = mockSession();
      const registry = new ValidationRegistry(mockRpc(), session);

      await registry.stake('1000.0000 XPR');

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.account).toBe('eosio.token');
      expect(action.name).toBe('transfer');
      expect(action.data).toEqual({
        from: 'testuser',
        to: 'agentvalid',
        quantity: '1000.0000 XPR',
        memo: 'stake',
      });
    });
  });

  describe('validate()', () => {
    it('sends "validate" action with result as numeric', async () => {
      const session = mockSession();
      const registry = new ValidationRegistry(mockRpc(), session);

      await registry.validate({
        agent: 'testagent',
        job_hash: 'hash123',
        result: 'pass',
        confidence: 95,
        evidence_uri: 'https://proof.com',
      });

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('validate');
      expect(action.data).toEqual({
        validator: 'testuser',
        agent: 'testagent',
        job_hash: 'hash123',
        result: 1, // 'pass' → 1
        confidence: 95,
        evidence_uri: 'https://proof.com',
      });
    });

    it('converts "fail" to 0 and "partial" to 2', async () => {
      const session = mockSession();
      const registry = new ValidationRegistry(mockRpc(), session);

      await registry.validate({
        agent: 'a', job_hash: 'h', result: 'fail', confidence: 50,
      });
      let data = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0].data;
      expect(data.result).toBe(0);

      await registry.validate({
        agent: 'a', job_hash: 'h', result: 'partial', confidence: 50,
      });
      data = (session.link.transact as jest.Mock).mock.calls[1][0].actions[0].data;
      expect(data.result).toBe(2);
    });

    it('defaults evidence_uri to empty string', async () => {
      const session = mockSession();
      const registry = new ValidationRegistry(mockRpc(), session);

      await registry.validate({
        agent: 'a', job_hash: 'h', result: 'pass', confidence: 90,
      });
      const data = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0].data;
      expect(data.evidence_uri).toBe('');
    });
  });

  describe('challenge()', () => {
    it('sends "challenge" action with correct fields', async () => {
      const session = mockSession();
      const registry = new ValidationRegistry(mockRpc(), session);

      await registry.challenge(42, 'Incorrect result', 'https://evidence.com');

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('challenge');
      expect(action.data).toEqual({
        challenger: 'testuser',
        validation_id: 42,
        reason: 'Incorrect result',
        evidence_uri: 'https://evidence.com',
      });
    });
  });

  describe('stakeChallengeDeposit()', () => {
    it('sends transfer with memo "challenge:ID"', async () => {
      const session = mockSession();
      const registry = new ValidationRegistry(mockRpc(), session);

      await registry.stakeChallengeDeposit(7, '100.0000 XPR');

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.account).toBe('eosio.token');
      expect(action.name).toBe('transfer');
      expect(action.data.memo).toBe('challenge:7');
      expect(action.data.quantity).toBe('100.0000 XPR');
    });
  });

  describe('resolve()', () => {
    it('sends "resolve" action with challenge_id, upheld, resolution_notes', async () => {
      const session = mockSession();
      const registry = new ValidationRegistry(mockRpc(), session);

      await registry.resolve(3, true, 'Challenge was valid');

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('resolve');
      expect(action.data).toEqual({
        resolver: 'testuser',
        challenge_id: 3,
        upheld: true,
        resolution_notes: 'Challenge was valid',
      });
    });
  });

  describe('expireUnfundedChallenge()', () => {
    it('sends "expireunfund" action with challenge_id', async () => {
      const session = mockSession();
      const registry = new ValidationRegistry(mockRpc(), session);

      await registry.expireUnfundedChallenge(5);

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('expireunfund');
      expect(action.data).toEqual({ challenge_id: 5 });
    });
  });

  describe('expireFundedChallenge()', () => {
    it('sends "expirefunded" action with challenge_id', async () => {
      const session = mockSession();
      const registry = new ValidationRegistry(mockRpc(), session);

      await registry.expireFundedChallenge(8);

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('expirefunded');
      expect(action.data).toEqual({ challenge_id: 8 });
    });
  });

  describe('setValidatorStatus()', () => {
    it('sends "setvalstat" action with account and active', async () => {
      const session = mockSession();
      const registry = new ValidationRegistry(mockRpc(), session);

      await registry.setValidatorStatus(false);

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('setvalstat');
      expect(action.data).toEqual({
        account: 'testuser',
        active: false,
      });
    });
  });

  describe('unstake()', () => {
    it('sends "unstake" action with account and amount', async () => {
      const session = mockSession();
      const registry = new ValidationRegistry(mockRpc(), session);

      await registry.unstake(50000);

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('unstake');
      expect(action.data).toEqual({
        account: 'testuser',
        amount: 50000,
      });
    });
  });

  describe('withdraw()', () => {
    it('sends "withdraw" action with unstake_id parameter', async () => {
      const session = mockSession();
      const registry = new ValidationRegistry(mockRpc(), session);

      await registry.withdraw(3);

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('withdraw');
      expect(action.data).toEqual({
        account: 'testuser',
        unstake_id: 3, // CRITICAL: must be "unstake_id", not just "id"
      });
    });
  });
});

// ============== Read Operations ==============

describe('ValidationRegistry read operations', () => {
  describe('getValidator()', () => {
    it('queries validators table with correct params', async () => {
      const rpc = mockRpc();
      const registry = new ValidationRegistry(rpc);

      await registry.getValidator('val1');

      expect(rpc.get_table_rows).toHaveBeenCalledWith({
        json: true,
        code: 'agentvalid',
        scope: 'agentvalid',
        table: 'validators',
        lower_bound: 'val1',
        upper_bound: 'val1',
        limit: 1,
      });
    });

    it('parses raw validator data correctly', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [{
          account: 'val1',
          stake: '100000',
          method: 'automated',
          specializations: '["nlp","vision"]',
          total_validations: '50',
          incorrect_validations: '2',
          accuracy_score: '9600',
          registered_at: '1704067200',
          active: 1,
        }],
        more: false,
      });
      const registry = new ValidationRegistry(rpc);
      const val = await registry.getValidator('val1');

      expect(val).toEqual({
        account: 'val1',
        stake: 100000,
        method: 'automated',
        specializations: ['nlp', 'vision'],
        total_validations: 50,
        incorrect_validations: 2,
        accuracy_score: 9600,
        registered_at: 1704067200,
        active: true,
      });
    });
  });

  describe('getChallengesForValidation()', () => {
    it('uses index_position=2 secondary index', async () => {
      const rpc = mockRpc();
      const registry = new ValidationRegistry(rpc);

      await registry.getChallengesForValidation(42);

      expect(rpc.get_table_rows).toHaveBeenCalledWith(
        expect.objectContaining({
          table: 'challenges',
          index_position: 2,
          key_type: 'i64',
        })
      );
    });
  });
});

// ============== Error Handling ==============

describe('ValidationRegistry error handling', () => {
  it('throws on missing session for registerValidator', async () => {
    const registry = new ValidationRegistry(mockRpc());
    await expect(
      registry.registerValidator('method', ['spec'])
    ).rejects.toThrow('Session required for write operations');
  });

  it('throws on missing session for validate', async () => {
    const registry = new ValidationRegistry(mockRpc());
    await expect(
      registry.validate({ agent: 'a', job_hash: 'h', result: 'pass', confidence: 50 })
    ).rejects.toThrow('Session required');
  });
});

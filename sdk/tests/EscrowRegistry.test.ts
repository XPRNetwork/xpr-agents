import { EscrowRegistry } from '../src/EscrowRegistry';
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

describe('EscrowRegistry write operations', () => {
  describe('createJob()', () => {
    it('sends "createjob" action with deliverables JSON.stringify\'d and symbol as string', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.createJob({
        agent: 'aiagent',
        title: 'Build a website',
        description: 'Full stack web app',
        deliverables: ['frontend', 'backend', 'tests'],
        amount: 100000,
        symbol: '4,XPR',
        deadline: 1710000000,
        arbitrator: 'arb1',
        job_hash: 'hash123',
      });

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.account).toBe('agentescrow');
      expect(action.name).toBe('createjob');
      expect(action.data).toEqual({
        client: 'testuser',
        agent: 'aiagent',
        title: 'Build a website',
        description: 'Full stack web app',
        deliverables: '["frontend","backend","tests"]', // JSON.stringify'd
        amount: 100000,
        symbol: '4,XPR', // CRITICAL: string format, not object
        deadline: 1710000000,
        arbitrator: 'arb1',
        job_hash: 'hash123',
      });
    });

    it('defaults optional fields', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.createJob({
        agent: 'aiagent',
        title: 'Job',
        description: 'Description',
        deliverables: [],
        amount: 10000,
      });

      const data = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0].data;
      expect(data.symbol).toBe('XPR'); // default symbol
      expect(data.deadline).toBe(0);
      expect(data.arbitrator).toBe('');
      expect(data.job_hash).toBe('');
    });
  });

  describe('fundJob()', () => {
    it('sends transfer with memo "fund:ID"', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.fundJob(42, '100.0000 XPR');

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.account).toBe('eosio.token');
      expect(action.name).toBe('transfer');
      expect(action.data).toEqual({
        from: 'testuser',
        to: 'agentescrow',
        quantity: '100.0000 XPR',
        memo: 'fund:42',
      });
    });
  });

  describe('acceptJob()', () => {
    it('sends "acceptjob" action with {agent, job_id}', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.acceptJob(1);

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.name).toBe('acceptjob');
      expect(action.data).toEqual({
        agent: 'testuser',
        job_id: 1,
      });
    });
  });

  describe('startJob()', () => {
    it('sends "startjob" action', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.startJob(1);

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('startjob');
      expect(action.data).toEqual({ agent: 'testuser', job_id: 1 });
    });
  });

  describe('deliverJob()', () => {
    it('sends "deliver" action with evidence_uri', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.deliverJob(1, 'https://delivery.com/proof');

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('deliver');
      expect(action.data).toEqual({
        agent: 'testuser',
        job_id: 1,
        evidence_uri: 'https://delivery.com/proof',
      });
    });
  });

  describe('approveDelivery()', () => {
    it('sends "approve" action with {client, job_id}', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.approveDelivery(1);

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('approve');
      expect(action.data).toEqual({ client: 'testuser', job_id: 1 });
    });
  });

  describe('reviseJob()', () => {
    it('sends "revise" action with {client, job_id, notes}', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.reviseJob(1, 'missing legend');

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('revise');
      expect(action.data).toEqual({ client: 'testuser', job_id: 1, notes: 'missing legend' });
    });
  });

  describe('addMilestone()', () => {
    it('sends "addmilestone" action with correct fields', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.addMilestone({
        job_id: 1,
        title: 'Phase 1',
        description: 'Initial setup',
        amount: 50000,
        order: 0,
      });

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('addmilestone');
      expect(action.data).toEqual({
        client: 'testuser',
        job_id: 1,
        title: 'Phase 1',
        description: 'Initial setup',
        amount: 50000,
        order: 0,
      });
    });
  });

  describe('submitMilestone()', () => {
    it('sends "submitmile" action', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.submitMilestone(5, 'https://evidence.com');

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('submitmile');
      expect(action.data).toEqual({
        agent: 'testuser',
        milestone_id: 5,
        evidence_uri: 'https://evidence.com',
      });
    });
  });

  describe('approveMilestone()', () => {
    it('sends "approvemile" action', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.approveMilestone(5);

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('approvemile');
      expect(action.data).toEqual({
        client: 'testuser',
        milestone_id: 5,
      });
    });
  });

  describe('raiseDispute()', () => {
    it('sends "dispute" action with correct fields', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.raiseDispute(1, 'Work not delivered', 'https://proof.com');

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('dispute');
      expect(action.data).toEqual({
        raised_by: 'testuser',
        job_id: 1,
        reason: 'Work not delivered',
        evidence_uri: 'https://proof.com',
      });
    });

    it('defaults evidence_uri to empty string', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.raiseDispute(1, 'Work not delivered');

      const data = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0].data;
      expect(data.evidence_uri).toBe('');
    });
  });

  describe('cancelJob()', () => {
    it('sends "cancel" action', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.cancelJob(1);

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('cancel');
      expect(action.data).toEqual({
        client: 'testuser',
        job_id: 1,
      });
    });
  });

  describe('registerArbitrator()', () => {
    it('sends "regarb" action with {account, fee_percent}', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.registerArbitrator(200);

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('regarb');
      expect(action.data).toEqual({
        account: 'testuser',
        fee_percent: 200,
      });
    });
  });

  describe('stakeArbitrator()', () => {
    it('sends transfer with memo "arbstake"', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.stakeArbitrator('5000.0000 XPR');

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.account).toBe('eosio.token');
      expect(action.name).toBe('transfer');
      expect(action.data).toEqual({
        from: 'testuser',
        to: 'agentescrow',
        quantity: '5000.0000 XPR',
        memo: 'arbstake',
      });
    });
  });

  describe('arbitrate()', () => {
    it('sends "arbitrate" action with client_percent (0-100)', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.arbitrate(1, 60, 'Client gets 60%');

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('arbitrate');
      expect(action.data).toEqual({
        arbitrator: 'testuser',
        dispute_id: 1,
        client_percent: 60, // CRITICAL: 0-100, not basis points
        resolution_notes: 'Client gets 60%',
      });
    });
  });

  describe('activateArbitrator()', () => {
    it('sends "activatearb" action', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.activateArbitrator();

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('activatearb');
      expect(action.data).toEqual({ account: 'testuser' });
    });
  });

  describe('deactivateArbitrator()', () => {
    it('sends "deactarb" action', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.deactivateArbitrator();

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('deactarb');
      expect(action.data).toEqual({ account: 'testuser' });
    });
  });

  describe('unstakeArbitrator()', () => {
    it('sends "unstakearb" action with {account, amount}', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.unstakeArbitrator(50000);

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('unstakearb');
      expect(action.data).toEqual({
        account: 'testuser',
        amount: 50000,
      });
    });
  });

  describe('withdrawArbitratorStake()', () => {
    it('sends "withdrawarb" action', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.withdrawArbitratorStake();

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('withdrawarb');
      expect(action.data).toEqual({ account: 'testuser' });
    });
  });

  describe('cancelArbitratorUnstake()', () => {
    it('sends "cancelunstk" action', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.cancelArbitratorUnstake();

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('cancelunstk');
      expect(action.data).toEqual({ account: 'testuser' });
    });
  });
});

// ============== Read Operations ==============

describe('EscrowRegistry read operations', () => {
  describe('getJob()', () => {
    it('queries jobs table with correct params', async () => {
      const rpc = mockRpc();
      const registry = new EscrowRegistry(rpc);

      await registry.getJob(42);

      expect(rpc.get_table_rows).toHaveBeenCalledWith({
        json: true,
        code: 'agentescrow',
        scope: 'agentescrow',
        table: 'jobs',
        lower_bound: '42',
        upper_bound: '42',
        limit: 1,
      });
    });

    it('parses raw job data correctly', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [{
          id: '1',
          client: 'alice',
          agent: 'aibot',
          title: 'Build app',
          description: 'Full stack',
          deliverables: '["frontend","backend"]',
          amount: '100000',
          symbol: '4,XPR',
          funded_amount: '100000',
          released_amount: '0',
          state: 2, // accepted
          deadline: '1710000000',
          arbitrator: 'arb1',
          job_hash: 'hash',
          created_at: '1704067200',
          updated_at: '1704067200',
        }],
        more: false,
      });
      const registry = new EscrowRegistry(rpc);
      const job = await registry.getJob(1);

      expect(job).not.toBeNull();
      expect(job!.state).toBe('accepted'); // mapped from number 2
      expect(job!.deliverables).toEqual(['frontend', 'backend']); // parsed JSON
      expect(job!.amount).toBe(100000);
    });

    it('returns null when job not found', async () => {
      const registry = new EscrowRegistry(mockRpc());
      expect(await registry.getJob(999)).toBeNull();
    });
  });

  describe('listJobsByClient()', () => {
    it('uses index_position=2 for byClient secondary index', async () => {
      const rpc = mockRpc();
      const registry = new EscrowRegistry(rpc);

      await registry.listJobsByClient('alice');

      expect(rpc.get_table_rows).toHaveBeenCalledWith(
        expect.objectContaining({
          table: 'jobs',
          index_position: 2,
          key_type: 'name',
          lower_bound: 'alice',
          upper_bound: 'alice',
        })
      );
    });

    it('filters by state when provided', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [
          { id: '1', client: 'alice', agent: 'bot', title: '', description: '', deliverables: '[]', amount: '0', symbol: 'XPR', funded_amount: '0', released_amount: '0', state: 0, deadline: '0', arbitrator: '', job_hash: '', created_at: '0', updated_at: '0' },
          { id: '2', client: 'alice', agent: 'bot', title: '', description: '', deliverables: '[]', amount: '0', symbol: 'XPR', funded_amount: '0', released_amount: '0', state: 6, deadline: '0', arbitrator: '', job_hash: '', created_at: '0', updated_at: '0' },
        ],
        more: false,
      });
      const registry = new EscrowRegistry(rpc);

      const result = await registry.listJobsByClient('alice', { state: 'completed' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].state).toBe('completed');
    });
  });

  describe('getJobMilestones()', () => {
    it('uses secondary index and sorts by order', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [
          { id: '2', job_id: '1', title: 'Phase 2', description: '', amount: '50000', order: 1, state: 0, evidence_uri: '', submitted_at: '0', approved_at: '0' },
          { id: '1', job_id: '1', title: 'Phase 1', description: '', amount: '50000', order: 0, state: 0, evidence_uri: '', submitted_at: '0', approved_at: '0' },
        ],
        more: false,
      });
      const registry = new EscrowRegistry(rpc);

      const milestones = await registry.getJobMilestones(1);

      expect(rpc.get_table_rows).toHaveBeenCalledWith(
        expect.objectContaining({
          table: 'milestones',
          index_position: 2,
          key_type: 'i64',
        })
      );
      // Sorted by order
      expect(milestones[0].title).toBe('Phase 1');
      expect(milestones[1].title).toBe('Phase 2');
    });
  });

  describe('listArbitrators()', () => {
    it('filters to active only', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [
          { account: 'arb1', stake: '100000', fee_percent: '200', total_cases: '10', successful_cases: '9', active_disputes: '0', active: 1 },
          { account: 'arb2', stake: '50000', fee_percent: '300', total_cases: '5', successful_cases: '5', active_disputes: '1', active: 0 },
        ],
        more: false,
      });
      const registry = new EscrowRegistry(rpc);

      const arbs = await registry.listArbitrators();
      expect(arbs).toHaveLength(1);
      expect(arbs[0].account).toBe('arb1');
      expect(arbs[0].active).toBe(true);
    });
  });
});

// ============== Cleanup Methods ==============

describe('EscrowRegistry cleanup methods', () => {
  describe('cleanJobs()', () => {
    it('sends "cleanjobs" action with max_age, max_delete', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.cleanJobs(7776000, 50);

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.account).toBe('agentescrow');
      expect(action.name).toBe('cleanjobs');
      expect(action.data).toEqual({
        max_age: 7776000,
        max_delete: 50,
      });
    });
  });

  describe('cleanDisputes()', () => {
    it('sends "cleandisps" action with max_age, max_delete', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.cleanDisputes(7776000, 100);

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.account).toBe('agentescrow');
      expect(action.name).toBe('cleandisps');
      expect(action.data).toEqual({
        max_age: 7776000,
        max_delete: 100,
      });
    });
  });
});

// ============== Bidding Write Operations ==============

describe('EscrowRegistry bidding write operations', () => {
  describe('submitBid()', () => {
    it('sends "submitbid" action with agent from session', async () => {
      const session = mockSession('myagent');
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.submitBid({
        job_id: 42,
        amount: 50000,
        timeline: 604800,
        proposal: 'I can deliver this in one week',
      });

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.account).toBe('agentescrow');
      expect(action.name).toBe('submitbid');
      expect(action.data).toEqual({
        agent: 'myagent',
        job_id: 42,
        amount: 50000,
        timeline: 604800,
        proposal: 'I can deliver this in one week',
      });
    });

    it('throws on missing session', async () => {
      const registry = new EscrowRegistry(mockRpc());
      await expect(
        registry.submitBid({ job_id: 1, amount: 100, timeline: 3600, proposal: 'test' })
      ).rejects.toThrow('Session required');
    });
  });

  describe('selectBid()', () => {
    it('sends "selectbid" action with client from session', async () => {
      const session = mockSession('clientacc');
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.selectBid(7);

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.account).toBe('agentescrow');
      expect(action.name).toBe('selectbid');
      expect(action.data).toEqual({
        client: 'clientacc',
        bid_id: 7,
      });
    });

    it('throws on missing session', async () => {
      const registry = new EscrowRegistry(mockRpc());
      await expect(registry.selectBid(1)).rejects.toThrow('Session required');
    });
  });

  describe('withdrawBid()', () => {
    it('sends "withdrawbid" action with agent from session', async () => {
      const session = mockSession('myagent');
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.withdrawBid(3);

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.account).toBe('agentescrow');
      expect(action.name).toBe('withdrawbid');
      expect(action.data).toEqual({
        agent: 'myagent',
        bid_id: 3,
      });
    });

    it('throws on missing session', async () => {
      const registry = new EscrowRegistry(mockRpc());
      await expect(registry.withdrawBid(1)).rejects.toThrow('Session required');
    });
  });
});

// ============== Bidding Read Operations ==============

describe('EscrowRegistry bidding read operations', () => {
  describe('listOpenJobs()', () => {
    it('queries jobs table and filters for empty agent', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [
          { id: '1', client: 'alice', agent: '', title: 'Open Job', description: 'desc', deliverables: '[]', amount: '100000', symbol: 'XPR', funded_amount: '0', released_amount: '0', state: 0, deadline: '0', arbitrator: '', job_hash: '', created_at: '1704067200', updated_at: '1704067200' },
          { id: '2', client: 'bob', agent: 'aibot', title: 'Assigned Job', description: 'desc', deliverables: '[]', amount: '50000', symbol: 'XPR', funded_amount: '0', released_amount: '0', state: 2, deadline: '0', arbitrator: '', job_hash: '', created_at: '1704067200', updated_at: '1704067200' },
          { id: '3', client: 'carol', agent: '.............', title: 'Another Open', description: 'desc', deliverables: '[]', amount: '75000', symbol: 'XPR', funded_amount: '0', released_amount: '0', state: 0, deadline: '0', arbitrator: '', job_hash: '', created_at: '1704067200', updated_at: '1704067200' },
        ],
        more: false,
      });
      const registry = new EscrowRegistry(rpc);

      const result = await registry.listOpenJobs();

      expect(result.items).toHaveLength(2);
      expect(result.items[0].title).toBe('Open Job');
      expect(result.items[1].title).toBe('Another Open');
    });

    it('respects state filter', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [
          { id: '1', client: 'alice', agent: '', title: 'Created', description: '', deliverables: '[]', amount: '100000', symbol: 'XPR', funded_amount: '0', released_amount: '0', state: 0, deadline: '0', arbitrator: '', job_hash: '', created_at: '0', updated_at: '0' },
          { id: '2', client: 'bob', agent: '', title: 'Funded', description: '', deliverables: '[]', amount: '100000', symbol: 'XPR', funded_amount: '100000', released_amount: '0', state: 1, deadline: '0', arbitrator: '', job_hash: '', created_at: '0', updated_at: '0' },
        ],
        more: false,
      });
      const registry = new EscrowRegistry(rpc);

      const result = await registry.listOpenJobs({ state: 'funded' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Funded');
    });

    it('handles pagination', async () => {
      const rpc = mockRpc();
      const registry = new EscrowRegistry(rpc);

      await registry.listOpenJobs({ limit: 10, cursor: '5' });

      expect(rpc.get_table_rows).toHaveBeenCalledWith(
        expect.objectContaining({
          table: 'jobs',
          lower_bound: '5',
          limit: 100, // batch size for scanning sparse open jobs
        })
      );
    });
  });

  describe('listBidsForJob()', () => {
    it('queries bids table with byJob secondary index', async () => {
      const rpc = mockRpc();
      const registry = new EscrowRegistry(rpc);

      await registry.listBidsForJob(42);

      expect(rpc.get_table_rows).toHaveBeenCalledWith({
        json: true,
        code: 'agentescrow',
        scope: 'agentescrow',
        table: 'bids',
        index_position: 2,
        key_type: 'i64',
        lower_bound: '42',
        upper_bound: '42',
        limit: 100,
      });
    });

    it('parses bid rows correctly', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [
          { id: '1', job_id: '42', agent: 'agent1', amount: '50000', timeline: '604800', proposal: 'My proposal', created_at: '1704067200' },
          { id: '2', job_id: '42', agent: 'agent2', amount: '75000', timeline: '1209600', proposal: 'Another bid', created_at: '1704070800' },
        ],
        more: false,
      });
      const registry = new EscrowRegistry(rpc);

      const bids = await registry.listBidsForJob(42);

      expect(bids).toHaveLength(2);
      expect(bids[0].agent).toBe('agent1');
      expect(bids[0].amount).toBe(50000);
      expect(bids[0].timeline).toBe(604800);
      expect(bids[0].proposal).toBe('My proposal');
      expect(bids[1].agent).toBe('agent2');
    });

    it('returns empty array when no bids', async () => {
      const registry = new EscrowRegistry(mockRpc());
      const bids = await registry.listBidsForJob(99);
      expect(bids).toEqual([]);
    });
  });

  describe('getBid()', () => {
    it('queries bids table with correct bounds', async () => {
      const rpc = mockRpc();
      const registry = new EscrowRegistry(rpc);

      await registry.getBid(5);

      expect(rpc.get_table_rows).toHaveBeenCalledWith({
        json: true,
        code: 'agentescrow',
        scope: 'agentescrow',
        table: 'bids',
        lower_bound: '5',
        upper_bound: '5',
        limit: 1,
      });
    });

    it('parses bid correctly', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [
          { id: '5', job_id: '42', agent: 'bidder', amount: '60000', timeline: '259200', proposal: 'Three day turnaround', created_at: '1704067200' },
        ],
        more: false,
      });
      const registry = new EscrowRegistry(rpc);

      const bid = await registry.getBid(5);

      expect(bid).not.toBeNull();
      expect(bid!.id).toBe(5);
      expect(bid!.job_id).toBe(42);
      expect(bid!.agent).toBe('bidder');
      expect(bid!.amount).toBe(60000);
      expect(bid!.timeline).toBe(259200);
      expect(bid!.proposal).toBe('Three day turnaround');
      expect(bid!.created_at).toBe(1704067200);
    });

    it('returns null when bid not found', async () => {
      const registry = new EscrowRegistry(mockRpc());
      expect(await registry.getBid(999)).toBeNull();
    });
  });
});

// ============== Error Handling ==============

describe('EscrowRegistry error handling', () => {
  it('throws on missing session for createJob', async () => {
    const registry = new EscrowRegistry(mockRpc());
    await expect(
      registry.createJob({
        agent: 'a', title: 't', description: 'd', deliverables: [], amount: 1,
      })
    ).rejects.toThrow('Session required for write operations');
  });

  it('throws on missing session for fundJob', async () => {
    const registry = new EscrowRegistry(mockRpc());
    await expect(
      registry.fundJob(1, '1.0000 XPR')
    ).rejects.toThrow('Session required');
  });

  it('throws on missing session for arbitrate', async () => {
    const registry = new EscrowRegistry(mockRpc());
    await expect(
      registry.arbitrate(1, 50, 'notes')
    ).rejects.toThrow('Session required');
  });
});

// ============== Services Market ==============

describe('EscrowRegistry service write operations', () => {
  describe('listService()', () => {
    it('sends "listsvc" action with deliverables JSON.stringify\'d', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.listService({
        title: 'Logo design',
        description: 'A vector logo in three concepts',
        deliverables: ['logo.svg', 'logo.png', 'brief.md'],
        price: 250000,
        turnaround: 86400,
        category: 'image',
        sampleUri: 'https://ipfs.io/ipfs/Qmsample',
      });

      const call = (session.link.transact as jest.Mock).mock.calls[0][0];
      const action = call.actions[0];
      expect(action.account).toBe('agentescrow');
      expect(action.name).toBe('listsvc');
      expect(action.data).toEqual({
        agent: 'testuser',
        title: 'Logo design',
        description: 'A vector logo in three concepts',
        deliverables: '["logo.svg","logo.png","brief.md"]',
        price: 250000,
        turnaround: 86400,
        category: 'image',
        sample_uri: 'https://ipfs.io/ipfs/Qmsample',
      });
    });

    it('defaults category and sample_uri to empty strings', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.listService({
        title: 'Data cleanup',
        description: 'CSV normalisation',
        deliverables: ['clean.csv'],
        price: 10000,
        turnaround: 3600,
      });

      const data = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0].data;
      expect(data.category).toBe('');
      expect(data.sample_uri).toBe('');
    });
  });

  describe('updateService()', () => {
    it('sends "updatesvc" action with service_id', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.updateService(7, {
        title: 'Logo design v2',
        description: 'Now with five concepts',
        deliverables: ['logo.svg'],
        price: 300000,
        turnaround: 172800,
        category: 'image',
        sampleUri: 'https://ipfs.io/ipfs/Qmsample2',
      });

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('updatesvc');
      expect(action.data).toEqual({
        agent: 'testuser',
        service_id: 7,
        title: 'Logo design v2',
        description: 'Now with five concepts',
        deliverables: '["logo.svg"]',
        price: 300000,
        turnaround: 172800,
        category: 'image',
        sample_uri: 'https://ipfs.io/ipfs/Qmsample2',
      });
    });
  });

  describe('delistService()', () => {
    it('sends "delistsvc" action with {agent, service_id}', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.delistService(7);

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('delistsvc');
      expect(action.data).toEqual({ agent: 'testuser', service_id: 7 });
    });
  });

  describe('relistService()', () => {
    it('sends "relistsvc" action with {agent, service_id}', async () => {
      const session = mockSession();
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.relistService(7);

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.name).toBe('relistsvc');
      expect(action.data).toEqual({ agent: 'testuser', service_id: 7 });
    });
  });

  describe('buyService()', () => {
    it('sends transfer to the escrow contract with memo "buy:ID"', async () => {
      const session = mockSession('buyer');
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.buyService(3, 250000);

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.account).toBe('eosio.token');
      expect(action.name).toBe('transfer');
      expect(action.data).toEqual({
        from: 'buyer',
        to: 'agentescrow',
        quantity: '25.0000 XPR',
        memo: 'buy:3',
      });
    });

    it('formats fractional prices with 4 decimals', async () => {
      const session = mockSession('buyer');
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.buyService(9, 12345);

      const data = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0].data;
      expect(data.quantity).toBe('1.2345 XPR');
    });
  });
});

describe('EscrowRegistry service read operations', () => {
  const rawService = {
    id: '3',
    agent: 'seller',
    title: 'Logo design',
    description: 'A vector logo',
    deliverables: '["logo.svg","logo.png"]',
    price: '250000',
    turnaround: '86400',
    category: 'image',
    sample_uri: 'https://ipfs.io/ipfs/Qmsample',
    active: 1,
    sales: '4',
    created_at: '1704067200',
    updated_at: '1704070800',
  };

  describe('getService()', () => {
    it('queries the services table with correct bounds', async () => {
      const rpc = mockRpc();
      const registry = new EscrowRegistry(rpc);

      await registry.getService(3);

      expect(rpc.get_table_rows).toHaveBeenCalledWith({
        json: true,
        code: 'agentescrow',
        scope: 'agentescrow',
        table: 'services',
        lower_bound: '3',
        upper_bound: '3',
        limit: 1,
      });
    });

    it('parses the row, keeping price raw and deliverables as an array', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({ rows: [rawService], more: false });
      const registry = new EscrowRegistry(rpc);

      const service = await registry.getService(3);

      expect(service).not.toBeNull();
      expect(service!.id).toBe(3);
      expect(service!.agent).toBe('seller');
      expect(service!.deliverables).toEqual(['logo.svg', 'logo.png']);
      expect(service!.price).toBe(250000); // raw units, not divided
      expect(service!.turnaround).toBe(86400);
      expect(service!.category).toBe('image');
      expect(service!.active).toBe(true);
      expect(service!.sales).toBe(4);
      expect(service!.created_at).toBe(1704067200);
      expect(service!.updated_at).toBe(1704070800);
    });

    it('falls back to an empty deliverables array on bad JSON', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [{ ...rawService, deliverables: 'not json' }],
        more: false,
      });
      const registry = new EscrowRegistry(rpc);

      const service = await registry.getService(3);
      expect(service!.deliverables).toEqual([]);
    });

    it('returns null when the service does not exist', async () => {
      const registry = new EscrowRegistry(mockRpc());
      expect(await registry.getService(999)).toBeNull();
    });
  });

  describe('listServices()', () => {
    it('scans the services table with limit + 1', async () => {
      const rpc = mockRpc();
      const registry = new EscrowRegistry(rpc);

      await registry.listServices({ limit: 10 });

      expect(rpc.get_table_rows).toHaveBeenCalledWith({
        json: true,
        code: 'agentescrow',
        scope: 'agentescrow',
        table: 'services',
        limit: 11,
      });
    });

    it('filters out inactive listings by default', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [rawService, { ...rawService, id: '4', active: 0 }],
        more: false,
      });
      const registry = new EscrowRegistry(rpc);

      const result = await registry.listServices();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(3);
    });

    it('includes inactive listings when activeOnly is false', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [rawService, { ...rawService, id: '4', active: 0 }],
        more: false,
      });
      const registry = new EscrowRegistry(rpc);

      const result = await registry.listServices({ activeOnly: false });
      expect(result.items).toHaveLength(2);
      expect(result.items[1].active).toBe(false);
    });

    it('reports hasMore when an extra row comes back', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [rawService, { ...rawService, id: '4' }, { ...rawService, id: '5' }],
        more: true,
      });
      const registry = new EscrowRegistry(rpc);

      const result = await registry.listServices({ limit: 2 });
      expect(result.hasMore).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('4');
    });
  });

  describe('listServicesByAgent()', () => {
    it('queries the byAgent secondary index with key_type name', async () => {
      const rpc = mockRpc();
      const registry = new EscrowRegistry(rpc);

      await registry.listServicesByAgent('seller');

      expect(rpc.get_table_rows).toHaveBeenCalledWith({
        json: true,
        code: 'agentescrow',
        scope: 'agentescrow',
        table: 'services',
        index_position: 2,
        key_type: 'name',
        lower_bound: 'seller',
        upper_bound: 'seller',
        limit: 100,
      });
    });

    it('returns both active and delisted listings', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [rawService, { ...rawService, id: '4', active: 0 }],
        more: false,
      });
      const registry = new EscrowRegistry(rpc);

      const services = await registry.listServicesByAgent('seller');
      expect(services).toHaveLength(2);
      expect(services[0].active).toBe(true);
      expect(services[1].active).toBe(false);
    });

    it('returns an empty array when the agent has no listings', async () => {
      const registry = new EscrowRegistry(mockRpc());
      expect(await registry.listServicesByAgent('nobody')).toEqual([]);
    });
  });
});

describe('EscrowRegistry service error handling', () => {
  it('throws on missing session for listService', async () => {
    const registry = new EscrowRegistry(mockRpc());
    await expect(
      registry.listService({ title: 't', description: 'd', deliverables: [], price: 10000, turnaround: 3600 })
    ).rejects.toThrow('Session required for write operations');
  });

  it('throws on missing session for buyService', async () => {
    const registry = new EscrowRegistry(mockRpc());
    await expect(registry.buyService(1, 10000)).rejects.toThrow('Session required');
  });

  it('throws on missing session for delistService', async () => {
    const registry = new EscrowRegistry(mockRpc());
    await expect(registry.delistService(1)).rejects.toThrow('Session required');
  });
});

// ============== Listing Fee & Featured Placement ==============

describe('EscrowRegistry service fee and boost', () => {
  describe('getServiceConfig()', () => {
    it('reads the svcconfig singleton', async () => {
      const rpc = mockRpc();
      const registry = new EscrowRegistry(rpc);

      await registry.getServiceConfig();

      expect(rpc.get_table_rows).toHaveBeenCalledWith({
        json: true,
        code: 'agentescrow',
        scope: 'agentescrow',
        table: 'svcconfig',
        limit: 1,
      });
    });

    it('returns the on-chain settings when the row exists', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [{ service_fee: '75000', boost_min: '20000', boost_rate: '25000' }],
        more: false,
      });
      const registry = new EscrowRegistry(rpc);

      const config = await registry.getServiceConfig();
      expect(config).toEqual({ service_fee: 75000, boost_min: 20000, boost_rate: 25000 });
    });

    it('falls back to contract defaults when svcconfig is unset', async () => {
      const registry = new EscrowRegistry(mockRpc());

      const config = await registry.getServiceConfig();
      expect(config).toEqual({
        service_fee: 50000, // 5 XPR
        boost_min: 10000,   // 1 XPR
        boost_rate: 10000,  // 1 XPR per featured day
      });
    });
  });

  describe('payServiceFee()', () => {
    it('sends transfer with memo "svcfee:<actor>"', async () => {
      const session = mockSession('selleragent');
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.payServiceFee(50000);

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.account).toBe('eosio.token');
      expect(action.name).toBe('transfer');
      expect(action.data).toEqual({
        from: 'selleragent',
        to: 'agentescrow',
        quantity: '5.0000 XPR',
        memo: 'svcfee:selleragent',
      });
    });
  });

  describe('refundServiceFee()', () => {
    it('sends "refundsvcfee" action with {agent}', async () => {
      const session = mockSession('selleragent');
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.refundServiceFee();

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.account).toBe('agentescrow');
      expect(action.name).toBe('refundsvcfee');
      expect(action.data).toEqual({ agent: 'selleragent' });
    });
  });

  describe('listServiceWithFee()', () => {
    it('sends the fee transfer and listsvc in ONE transaction, fee first', async () => {
      const session = mockSession('selleragent');
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.listServiceWithFee(50000, {
        title: 'Logo design',
        description: 'A vector logo',
        deliverables: ['logo.svg'],
        price: 250000,
        turnaround: 86400,
        category: 'image',
      });

      expect((session.link.transact as jest.Mock).mock.calls).toHaveLength(1);
      const actions = (session.link.transact as jest.Mock).mock.calls[0][0].actions;
      expect(actions).toHaveLength(2);
      expect(actions[0].name).toBe('transfer');
      expect(actions[0].data.memo).toBe('svcfee:selleragent');
      expect(actions[0].data.quantity).toBe('5.0000 XPR');
      expect(actions[1].name).toBe('listsvc');
      expect(actions[1].data).toEqual({
        agent: 'selleragent',
        title: 'Logo design',
        description: 'A vector logo',
        deliverables: '["logo.svg"]',
        price: 250000,
        turnaround: 86400,
        category: 'image',
        sample_uri: '',
      });
    });
  });

  describe('boostService()', () => {
    it('sends transfer with memo "boost:ID"', async () => {
      const session = mockSession('fan');
      const registry = new EscrowRegistry(mockRpc(), session);

      await registry.boostService(3, 30000);

      const action = (session.link.transact as jest.Mock).mock.calls[0][0].actions[0];
      expect(action.account).toBe('eosio.token');
      expect(action.name).toBe('transfer');
      expect(action.data).toEqual({
        from: 'fan',
        to: 'agentescrow',
        quantity: '3.0000 XPR',
        memo: 'boost:3',
      });
    });
  });

  describe('boost fields on Service rows', () => {
    it('parses boost_paid and featured_until', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [{
          id: '3', agent: 'seller', title: 'T', description: 'D',
          deliverables: '[]', price: '250000', turnaround: '86400',
          category: 'image', sample_uri: '', active: 1, sales: '4',
          boost_paid: '70000', featured_until: '1735689600',
          created_at: '1704067200', updated_at: '1704070800',
        }],
        more: false,
      });
      const registry = new EscrowRegistry(rpc);

      const service = await registry.getService(3);
      expect(service!.boostPaid).toBe(70000);
      expect(service!.featuredUntil).toBe(1735689600);
    });

    it('defaults both to 0 on rows written before the boost fields shipped', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [{
          id: '3', agent: 'seller', title: 'T', description: 'D',
          deliverables: '[]', price: '250000', turnaround: '86400',
          category: 'image', sample_uri: '', active: 1, sales: '4',
          created_at: '1704067200', updated_at: '1704070800',
        }],
        more: false,
      });
      const registry = new EscrowRegistry(rpc);

      const service = await registry.getService(3);
      expect(service!.boostPaid).toBe(0);
      expect(service!.featuredUntil).toBe(0);
    });
  });

  describe('session requirements', () => {
    it('throws on missing session for payServiceFee', async () => {
      const registry = new EscrowRegistry(mockRpc());
      await expect(registry.payServiceFee(50000)).rejects.toThrow('Session required');
    });

    it('throws on missing session for boostService', async () => {
      const registry = new EscrowRegistry(mockRpc());
      await expect(registry.boostService(1, 10000)).rejects.toThrow('Session required');
    });

    it('throws on missing session for refundServiceFee', async () => {
      const registry = new EscrowRegistry(mockRpc());
      await expect(registry.refundServiceFee()).rejects.toThrow('Session required');
    });

    it('throws on missing session for listServiceWithFee', async () => {
      const registry = new EscrowRegistry(mockRpc());
      await expect(
        registry.listServiceWithFee(50000, {
          title: 't', description: 'd', deliverables: [], price: 10000, turnaround: 3600,
        })
      ).rejects.toThrow('Session required');
    });
  });
});

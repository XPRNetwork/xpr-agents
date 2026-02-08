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
          key_type: 'i64',
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
          limit: 11, // limit + 1 for hasMore check
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
        limit: 100,
      });
    });

    it('parses bid rows and filters by job_id', async () => {
      const rpc = mockRpc();
      (rpc.get_table_rows as jest.Mock).mockResolvedValue({
        rows: [
          { id: '1', job_id: '42', agent: 'agent1', amount: '50000', timeline: '604800', proposal: 'My proposal', created_at: '1704067200' },
          { id: '2', job_id: '42', agent: 'agent2', amount: '75000', timeline: '1209600', proposal: 'Another bid', created_at: '1704070800' },
          { id: '3', job_id: '43', agent: 'agent3', amount: '30000', timeline: '86400', proposal: 'Wrong job', created_at: '1704074400' },
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

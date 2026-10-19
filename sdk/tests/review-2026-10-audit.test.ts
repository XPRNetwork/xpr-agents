import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { AgentRegistry } from '../src/AgentRegistry';
import { FeedbackRegistry } from '../src/FeedbackRegistry';
import { ValidationRegistry } from '../src/ValidationRegistry';
import { EscrowRegistry } from '../src/EscrowRegistry';
import { A2AClient } from '../src/A2AClient';
import { calculateTrustScore, formatXpr, parseXpr } from '../src/utils';
import { createA2ADigest, hashBody, signA2ARequest, recoverA2APublicKey } from '../src/eosio-auth';
import { Key } from '@proton/js';
import type { JsonRpc, ProtonSession } from '../src/types';

// All network, chain access and cryptographic signing are mocked. No real keys.
const contracts = ['agentcore', 'agentfeed', 'agentvalid', 'agentescrow'];
// Contract ABIs are build outputs (contracts' `npm run build`). CI builds and supplies them, so
// only a local run without built contracts skips these checks.
const abiFile = (c: string) => join(__dirname, '../../contracts', c, 'assembly/target', `${c}.contract.abi`);
const haveAbis = !!process.env.CI || contracts.every(c => existsSync(abiFile(c)));
const describeAbi = haveAbis ? describe : describe.skip;
const abis: Record<string, any> = haveAbis
  ? Object.fromEntries(contracts.map(c => [c, JSON.parse(readFileSync(abiFile(c), 'utf8'))]))
  : {};
function row(contract: string, table: string, overrides: Record<string, unknown> = {}): any {
  const abi = abis[contract];
  const type = abi.tables.find((t: any) => t.name === table).type;
  const fields = abi.structs.find((s: any) => s.name === type).fields;
  return { ...Object.fromEntries(fields.map((f: any) => [f.name,
    f.type === 'uint64' ? '0' : f.type === 'bool' || /^u?int/.test(f.type) ? 0 : '',
  ])), ...overrides };
}
function agent(account = 'alice', overrides: Record<string, unknown> = {}) {
  return row('agentcore', 'agents', { account, name: 'Agent', description: 'An agent',
    endpoint: 'https://example.test', protocol: 'https', capabilities: '["compute"]', active: 1, ...overrides });
}
function job(id: number, overrides: Record<string, unknown> = {}) {
  return row('agentescrow', 'jobs', { id: String(id), client: 'alice', agent: 'bob', deliverables: '[]', ...overrides });
}
function service(id: number) {
  return row('agentescrow', 'services', { id: String(id), agent: 'bob', deliverables: '[]', active: 1 });
}
function rpcWith(fn: (query: any) => any): JsonRpc {
  return { get_table_rows: jest.fn(async (query: any) => fn(query)) } as JsonRpc;
}
function session(): ProtonSession {
  return { auth: { actor: 'alice', permission: 'active' },
    link: { transact: jest.fn().mockResolvedValue({ transaction_id: 'mock' }) } } as ProtonSession;
}
const registration = { name: 'Agent', description: 'An agent', endpoint: 'https://example.test', protocol: 'https', capabilities: ['compute'] };
const feedback = { agent: 'bob', score: 5, tags: ['compute'], job_hash: 'hash', evidence_uri: 'https://example.test', amount_paid: 10000 };
const validation = { agent: 'bob', job_hash: 'hash', result: 'pass', confidence: 90, evidence_uri: 'https://example.test' };
const listing = { title: 'Service', description: 'Description', deliverables: ['file'], price: 10000, turnaround: 3600 };
// Every public transaction builder, including atomic fee/purchase variants.
const builders: Record<string, Record<string, any[]>> = {
  agentcore: {
    register: [registration], registerWithFee: [registration, '1.0000 XPR'], update: [{ name: 'Updated' }],
    setStatus: [false], addPlugin: [1, { x: 1 }], removePlugin: [1],
    registerPlugin: ['plugin', '1.0', 'bob', 'execute', {}, 'compute'], approveClaim: ['bob'], claim: ['bob'],
    claimWithFee: ['bob', '1.0000 XPR'], cancelClaim: [], transferOwnership: ['bob', 'carol'], release: ['bob'], verifyClaim: ['bob'],
  },
  agentfeed: {
    submit: [feedback], dispute: [1, 'Reason', 'https://example.test'], recalculate: ['bob', 0, 100],
    resolve: [1, true, 'Notes'], cancelRecalculation: ['bob'], submitWithFee: [feedback, '1.0000 XPR'],
    cleanFeedback: ['bob', 100, 10], cleanDisputes: [100, 10],
  },
  agentvalid: {
    registerValidator: ['manual', ['compute']], updateValidator: ['manual', ['compute']], stake: ['1.0000 XPR'],
    validate: [validation], challenge: [1, 'Reason', 'https://example.test'], stakeChallengeDeposit: [1, '1.0000 XPR'],
    setValidatorStatus: [false], unstake: [10000], withdraw: [1], cancelChallenge: [1], resolve: [1, true, 'Notes'],
    expireUnfundedChallenge: [1], expireFundedChallenge: [1], validateWithFee: [validation, '1.0000 XPR'],
    cleanValidations: ['bob', 100, 10], cleanChallenges: [100, 10],
  },
  agentescrow: {
    createJob: [{ title: 'Job', description: 'Description', deliverables: ['file'], amount: 10000, agent: 'bob' }],
    fundJob: [1, '1.0000 XPR'], acceptJob: [1], startJob: [1], deliverJob: [1, 'https://example.test'],
    reviseJob: [1, 'Notes'], askClient: [1, 'Question'], answerAgent: [1, 'Answer'], approveDelivery: [1],
    addMilestone: [{ job_id: 1, title: 'Milestone', description: 'Description', amount: 10000, order: 1 }],
    submitMilestone: [1, 'https://example.test'], approveMilestone: [1], raiseDispute: [1, 'Reason', 'https://example.test'],
    cancelJob: [1], cancelByAgent: [1, 'Reason'], claimTimeout: [1], claimAcceptanceTimeout: [1],
    submitBid: [{ job_id: 1, amount: 10000, timeline: 3600, proposal: 'Proposal' }], selectBid: [1], withdrawBid: [1],
    registerArbitrator: [100], stakeArbitrator: ['1.0000 XPR'], arbitrate: [1, 50, 'Notes'], resolveTimeout: [1, 50, 'Notes'],
    activateArbitrator: [], deactivateArbitrator: [], unstakeArbitrator: [10000], withdrawArbitratorStake: [], cancelArbitratorUnstake: [],
    cleanJobs: [100, 10], cleanDisputes: [100, 10], listService: [listing], updateService: [1, listing], delistService: [1], relistService: [1],
    payServiceFee: [10000], refundServiceFee: [], listServiceWithFee: [10000, listing], boostService: [1, 10000],
    buyService: [1, 10000, 'notes:with:colons'], setServiceInput: [1, { v: 1, fields: [] }], buyServiceWithInput: [1, 10000, { brief: 'Hello' }],
  },
};
const classes: Record<string, any> = { agentcore: AgentRegistry, agentfeed: FeedbackRegistry, agentvalid: ValidationRegistry, agentescrow: EscrowRegistry };
const originalFetch = global.fetch;
beforeEach(() => { global.fetch = jest.fn().mockRejectedValue(new Error('Unexpected network access')); });
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

describeAbi('review findings: correct behavior required', () => {
  it('P3 agent pagination returns each row once at an inclusive lower-bound boundary', async () => {
    const rows = ['alice', 'bob', 'carol'].map(a => agent(a));
    const rpc = rpcWith(q => {
      const rest = rows.filter(r => !q.lower_bound || r.account >= q.lower_bound);
      return { rows: rest.slice(0, q.limit), more: rest.length > q.limit };
    });
    const r = new AgentRegistry(rpc);
    const first = await r.listAgents({ limit: 2 });
    const second = await r.listAgents({ limit: 2, cursor: first.nextCursor });
    expect([...first.items, ...second.items].map(a => a.account)).toEqual(['alice', 'bob', 'carol']);
  });

  it('P3 pagination honors RPC more/next_key when the node returns a short page', async () => {
    const rpc = rpcWith(() => ({ rows: [agent()], more: true, next_key: 'bob' }));
    const page = await new AgentRegistry(rpc).listAgents({ limit: 10 });
    expect({ hasMore: page.hasMore, nextCursor: page.nextCursor }).toEqual({ hasMore: true, nextCursor: 'bob' });
  });

  it('P3 client and agent job pagination consumes the returned cursor', async () => {
    const pages: Record<string, number[][]> = {};
    for (const method of ['listJobsByClient', 'listJobsByAgent'] as const) {
      const rpc = rpcWith(q => {
        // Model inclusive chain bounds, including a primary-index fallback.
        let rows = [job(1, { agent: 'alice' }), job(2, { agent: 'alice' }), job(3, { agent: 'alice' })];
        const key = (r: any) => q.index_position === 2 ? r.client : q.index_position === 3 ? r.agent : BigInt(r.id);
        const bound = (v: string) => q.index_position ? v : BigInt(v);
        rows = rows.filter(r => (!q.lower_bound || key(r) >= bound(q.lower_bound)) && (!q.upper_bound || key(r) <= bound(q.upper_bound)));
        if (q.reverse) rows.reverse();
        return { rows: rows.slice(0, q.limit), more: rows.length > q.limit };
      });
      const r = new EscrowRegistry(rpc);
      const first = await r[method]('alice', { limit: 2 });
      const second = await r[method]('alice', { limit: 2, cursor: first.nextCursor });
      pages[method] = [first.items.map(j => j.id), second.items.map(j => j.id)];
    }
    expect(pages).toEqual({ listJobsByClient: [[2, 3], [1]], listJobsByAgent: [[2, 3], [1]] });
  });

  it('P3 service catalogue supports continuation without repeating its first page', async () => {
    const rows = [service(1), service(2), service(3)];
    const rpc = rpcWith(q => {
      const rest = rows.filter(r => !q.lower_bound || Number(r.id) >= Number(q.lower_bound));
      return { rows: rest.slice(0, q.limit), more: rest.length > q.limit };
    });
    const r = new EscrowRegistry(rpc);
    const first = await r.listServices({ limit: 2 });
    // ServiceListOptions currently omits cursor, despite returning nextCursor.
    const continuation = { limit: 2, cursor: first.nextCursor };
    const second = await r.listServices(continuation);
    expect([...first.items, ...second.items].map(s => s.id)).toEqual([1, 2, 3]);
  });

  it('P3 sparse open-job scan increments a decimal u64 cursor numerically', async () => {
    const rows = Array.from({ length: 101 }, (_, i) => job(i + 1, { agent: i === 100 ? '' : 'bob' }));
    const rpc = rpcWith(q => {
      const rest = rows.filter(r => Number(r.id) >= Number(q.lower_bound || 0));
      return { rows: rest.slice(0, q.limit), more: rest.length > q.limit };
    });
    const page = await new EscrowRegistry(rpc).listOpenJobs({ limit: 1 });
    expect(page.items.map(j => j.id)).toEqual([101]);
  });

  it('P2 formats an exactly representable large raw amount without changing a unit', async () => {
    const raw = 9007199254740904; // safe integer, well below the Antelope asset bound
    expect(Number.isSafeInteger(raw)).toBe(true);
    const s = session();
    const r = new EscrowRegistry(rpcWith(() => ({ rows: [], more: false })), s);
    await r.buyService(1, raw);
    await r.buyServiceWithInput(1, raw, { brief: 'Hello' });
    await r.boostService(1, raw);
    await r.payServiceFee(raw);
    const quantities = (s.link.transact as jest.Mock).mock.calls.map(c => c[0].actions[0].data.quantity);
    expect([formatXpr(raw), ...quantities]).toEqual(Array(5).fill('900719925474.0904 XPR'));
  });

  it('P3 malformed validator specializations do not crash filtered listing', async () => {
    const rpc = rpcWith(() => ({ rows: [row('agentvalid', 'validators', {
      account: 'bob', active: 1, specializations: 'null',
    })], more: false }));
    await expect(new ValidationRegistry(rpc).listValidators({ specialization: 'compute' })).resolves.toEqual([]);
  });

  it('P3 job deliverables remain an array when valid JSON has the wrong shape', async () => {
    const rpc = rpcWith(() => ({ rows: [job(1, { deliverables: 'null' })], more: false }));
    const result = await new EscrowRegistry(rpc).getJob(1);
    expect(result!.deliverables).toEqual([]);
  });

  it('P5 A2A refuses non-http(s) endpoints before invoking fetch', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ name: 'untrusted' }) });
    let rejected = false;
    try { await new A2AClient('data:application/json,%7B%7D#').getAgentCard(); } catch { rejected = true; }
    expect({ rejected, calls: (global.fetch as jest.Mock).mock.calls.length }).toEqual({ rejected: true, calls: 0 });
  });
});

describeAbi('properties that hold', () => {
  it('P1 every transaction builder uses the target ABI action, exact data keys and ABI-compatible values', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errors: string[] = [];
    for (const [contract, methods] of Object.entries(builders)) {
      const s = session();
      const r = new classes[contract](rpcWith(() => ({ rows: [agent()], more: false })), s);
      const source = readFileSync(join(__dirname, '../src', `${classes[contract].name}.ts`), 'utf8');
      // Guard against accidentally omitting a public transaction-producing method.
      const writes = [...source.matchAll(/async\s+(\w+)\([^)]*\): Promise<TransactionResult>/g)].map(m => m[1]);
      expect(Object.keys(methods).sort()).toEqual(writes.sort());
      for (const [method, args] of Object.entries(methods)) {
        (s.link.transact as jest.Mock).mockClear();
        await r[method](...args);
        const actions = (s.link.transact as jest.Mock).mock.calls[0][0].actions;
        for (const action of actions) {
          // eosio.token is external: its transfer schema is standard; all four project ABIs are read from disk.
          const abi = abis[action.account];
          const definition = abi?.actions.find((a: any) => a.name === action.name);
          const fields = action.account === 'eosio.token' && action.name === 'transfer'
            ? [{ name: 'from', type: 'name' }, { name: 'to', type: 'name' }, { name: 'quantity', type: 'asset' }, { name: 'memo', type: 'string' }]
            : abi?.structs.find((s: any) => s.name === definition?.type)?.fields;
          const label = `${contract}.${method} -> ${action.account}::${action.name}`;
          if (!fields) { errors.push(`${label}: missing ABI action`); continue; }
          if (JSON.stringify(Object.keys(action.data).sort()) !== JSON.stringify(fields.map((f: any) => f.name).sort())) errors.push(`${label}: data keys`);
          for (const f of fields) {
            const value = action.data[f.name];
            let valid = false;
            if (['string', 'name'].includes(f.type)) valid = typeof value === 'string';
            else if (f.type === 'bool') valid = typeof value === 'boolean' || value === 0 || value === 1;
            else if (f.type === 'asset') valid = typeof value === 'string' && /^\d+\.\d{4} XPR$/.test(value);
            else if (/^uint\d+$/.test(f.type)) valid = Number.isSafeInteger(value) && value >= 0 && BigInt(value) < (BigInt(1) << BigInt(f.type.slice(4)));
            if (!valid) errors.push(`${label}: ${f.name} is not ${f.type}`);
          }
        }
      }
      if (contract === 'agentcore') {
        const proposal = r.buildTransferProposal('bob', 'alice', 'carol');
        expect(Object.keys(proposal.data).sort()).toEqual(['agent', 'new_owner']);
      }
    }
    expect(errors).toEqual([]);
  });

  it('P2 common four-decimal amounts round-trip exactly', () => {
    for (const [asset, raw] of [['0.1000 XPR', 1000], ['1.0050 XPR', 10050], ['999999.9999 XPR', 9999999999]] as const) {
      expect(parseXpr(asset)).toBe(raw);
      expect(formatXpr(raw)).toBe(asset);
    }
  });

  it('P2 transfer memo families match contract parser operands', async () => {
    const s = session();
    const rpc = rpcWith(() => ({ rows: [], more: false }));
    const e = new EscrowRegistry(rpc, s);
    await e.fundJob(7, '1.0050 XPR'); await e.buyService(7, 10050, 'a:b');
    await e.payServiceFee(10050); await e.boostService(7, 10050);
    await new ValidationRegistry(rpc, s).validateWithFee(validation as any, '1.0050 XPR');
    await new AgentRegistry(rpc, s).registerWithFee(registration, '1.0050 XPR');
    await new FeedbackRegistry(rpc, s).submitWithFee(feedback, '1.0050 XPR');
    await new AgentRegistry(rpc, s).claimWithFee('bob', '1.0050 XPR');
    const transfers = (s.link.transact as jest.Mock).mock.calls.map(c => c[0].actions[0].data);
    expect(transfers.map(t => t.memo)).toEqual(['fund:7', 'buy:7:a:b', 'svcfee:alice', 'boost:7', 'valfee:alice', 'regfee:alice', 'feedfee:alice', 'claim:bob:alice']);
    expect(transfers.every(t => t.quantity === '1.0050 XPR')).toBe(true);
  });

  it('P3 representative u64 strings, boolean 0/1 and malformed JSON syntax parse safely', async () => {
    for (const active of [0, 1]) {
      const rpc = rpcWith(() => ({ rows: [agent('alice', { active, total_jobs: '42', capabilities: '{broken' })], more: false }));
      expect(await new AgentRegistry(rpc).getAgent('alice')).toMatchObject({ active: active === 1, total_jobs: 42, capabilities: [] });
      const vrpc = rpcWith(() => ({ rows: [row('agentvalid', 'validators', {
        account: 'alice', active, stake: '10050', specializations: '{broken',
      })], more: false }));
      expect(await new ValidationRegistry(vrpc).getValidator('alice')).toMatchObject({ active: active === 1, stake: 10050, specializations: [] });
      const frpc = rpcWith(() => ({ rows: [row('agentfeed', 'feedback', {
        id: '42', disputed: active, resolved: active, tags: 'compute, storage', amount_paid: '10050',
      })], more: false }));
      expect(await new FeedbackRegistry(frpc).getFeedback(42)).toMatchObject({
        id: 42, disputed: active === 1, resolved: active === 1, tags: ['compute', 'storage'], amount_paid: 10050,
      });
      const erpc = rpcWith(() => ({ rows: [{ ...service(42), active, price: '10050', deliverables: '{broken' }], more: false }));
      expect(await new EscrowRegistry(erpc).getService(42)).toMatchObject({ id: 42, active: active === 1, price: 10050, deliverables: [] });
    }
  });

  it('P4 trust score follows review-volume scaling and documented caps for valid inputs', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1800000000000);
    const a: any = { account: 'alice', registered_at: 1800000000 - 12 * 2592000 };
    for (const count of [0, 1, 4, 5, 100]) {
      const score: any = { total_weight: count, avg_score: 10000, feedback_count: count };
      const result = calculateTrustScore(a, score, 3, 20000 * 10000);
      expect(result.breakdown).toEqual({ kyc: 30, stake: 20, reputation: 40 * Math.min(count, 5) / 5, longevity: 10 });
      expect(result.total).toBe(60 + 40 * Math.min(count, 5) / 5);
    }
    expect(calculateTrustScore(a, null, 0, 4999999).breakdown.stake).toBe(0);
  });

  it('P5 A2A signing/recovery pass the same digest to mocked crypto and bind every request component', () => {
    let signed = '';
    jest.spyOn(Key.PrivateKey, 'fromString').mockReturnValue({ sign: jest.fn((digest: Buffer) => {
      signed = digest.toString('hex'); return { toString: () => 'mock-signature' };
    }) } as any);
    jest.spyOn(Key.Signature, 'fromString').mockReturnValue({ recover: jest.fn((digest: Buffer) => ({
      toString: () => digest.toString('hex') === signed ? 'mock-public-key' : 'different-key',
    })) } as any);
    const args: [string, number, string, string, string] = ['alice', 1800000000, hashBody('body'), 'bob', 'a'.repeat(64)];
    const sig = signA2ARequest('mock-key', ...args);
    expect(recoverA2APublicKey(sig, ...args)).toBe('mock-public-key');
    for (let i = 0; i < args.length; i++) {
      const changed = [...args] as typeof args;
      (changed as any)[i] = i === 1 ? args[1] - 600 : `${args[i]}changed`;
      expect(createA2ADigest(...changed)).not.toBe(createA2ADigest(...args));
      expect(recoverA2APublicKey(sig, ...changed)).toBe('different-key');
    }
    // This checks SDK digest wiring, NOT cryptographic verification or freshness policy.
  });

  it('P5 both A2A request paths refuse redirects at the fetch boundary', async () => {
    global.fetch = jest.fn(async (_url, init) => {
      expect(init?.redirect).toBe('error');
      throw new TypeError('redirect disallowed');
    }) as any;
    const client = new A2AClient('https://example.test');
    await expect(client.getAgentCard()).rejects.toThrow('redirect disallowed');
    await expect(client.getTask('task')).rejects.toThrow('redirect disallowed');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

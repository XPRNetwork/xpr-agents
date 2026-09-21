import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HyperionPoller } from '../src/poller';

/**
 * Audit round 2 (codex #16): Hyperion `after=<block>` is inclusive, so a block with
 * more than one page (100) of actions used to stall the poller — it refetched the
 * first 100 forever and never reached the rest. The poller now skip-pages and dedups
 * by global_sequence. These drive pollContract via a mocked Hyperion that honours
 * `after` (block, inclusive) + `skip`.
 */
type Act = { block_num: number; global_sequence: number; act: any; '@timestamp': string; trx_id: string };

function makeActions(specs: Array<{ block: number; count: number; startSeq: number }>): Act[] {
  const out: Act[] = [];
  let n = 0;
  for (const s of specs) {
    for (let i = 0; i < s.count; i++) {
      const seq = s.startSeq + i;
      out.push({ block_num: s.block, global_sequence: seq, act: { account: 'agentescrow', name: 'noop', data: {} }, '@timestamp': '2024-01-01T00:00:00.000', trx_id: `t${++n}` });
    }
  }
  return out;
}

function mockHyperion(all: Act[]) {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    const after = Number(u.searchParams.get('after') || '0');
    const skip = Number(u.searchParams.get('skip') || '0');
    const limit = Number(u.searchParams.get('limit') || '100');
    const filtered = all.filter(a => a.block_num >= after); // Hyperion `after` is inclusive
    const page = filtered.slice(skip, skip + limit);
    return { ok: true, json: async () => ({ actions: page }) } as any;
  });
}

describe('HyperionPoller skip-paging + global_sequence dedup (#16)', () => {
  let poller: HyperionPoller;
  let emitted: any[];

  beforeEach(() => {
    poller = new HyperionPoller({ endpoint: 'http://hyp.test', contracts: ['agentescrow'], startBlock: 0 });
    emitted = [];
    poller.on('action', (a) => emitted.push(a));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('drains a block holding more than one page of actions (no stall)', async () => {
    // 150 actions in block 1000, then 5 in block 1001 — 155 total across pages.
    vi.stubGlobal('fetch', mockHyperion(makeActions([
      { block: 1000, count: 150, startSeq: 1 },
      { block: 1001, count: 5, startSeq: 151 },
    ])));

    await (poller as any).pollContract('agentescrow');

    const seqs = emitted.map(a => a.global_sequence).sort((x, y) => x - y);
    expect(seqs.length).to.equal(155);                 // all drained (pre-fix: only 100)
    expect(new Set(seqs).size).to.equal(155);          // no duplicates
    expect(seqs[0]).to.equal(1);
    expect(seqs[154]).to.equal(155);
  });

  it('does not re-emit already-processed actions on the next poll (inclusive-boundary refetch)', async () => {
    vi.stubGlobal('fetch', mockHyperion(makeActions([{ block: 1000, count: 30, startSeq: 1 }])));
    await (poller as any).pollContract('agentescrow');
    expect(emitted.length).to.equal(30);

    // Second poll, same data — after=1000 (inclusive) refetches block 1000, but all
    // 30 are already seen, so nothing is re-emitted and it doesn't spin.
    emitted.length = 0;
    await (poller as any).pollContract('agentescrow');
    expect(emitted.length).to.equal(0);
  });

  it('picks up genuinely new actions in a later block on a subsequent poll', async () => {
    const store = makeActions([{ block: 1000, count: 10, startSeq: 1 }]);
    vi.stubGlobal('fetch', mockHyperion(store));
    await (poller as any).pollContract('agentescrow');
    expect(emitted.length).to.equal(10);

    // A new block arrives.
    store.push(...makeActions([{ block: 1005, count: 4, startSeq: 11 }]));
    emitted.length = 0;
    await (poller as any).pollContract('agentescrow');
    expect(emitted.map(a => a.global_sequence)).to.deep.equal([11, 12, 13, 14]);
  });

  it('drains a block bigger than the per-poll page cap over successive polls (no permanent stall)', async () => {
    // 5050 actions in ONE block — more than MAX_PAGES_PER_POLL(50) * 100 = 5000, so a
    // single poll cannot drain it. Pre-fix, every poll refetched skip 0..4900 forever
    // and actions 5001..5050 were never emitted. The persisted skip cursor must let
    // the next poll resume past the cap.
    const big = new HyperionPoller({ endpoint: 'http://hyp.test', contracts: ['agentescrow'], startBlock: 1000 });
    const got: number[] = [];
    big.on('action', (a) => got.push(a.global_sequence));
    vi.stubGlobal('fetch', mockHyperion(makeActions([{ block: 1000, count: 5050, startSeq: 1 }])));

    await (big as any).pollContract('agentescrow'); // drains first 5000
    expect(got.length).to.equal(5000);
    await (big as any).pollContract('agentescrow'); // resumes past the cap, drains the rest

    const seqs = got.slice().sort((x, y) => x - y);
    expect(seqs.length).to.equal(5050);
    expect(new Set(seqs).size).to.equal(5050); // no duplicates
    expect(seqs[0]).to.equal(1);
    expect(seqs[5049]).to.equal(5050);
  });

  it('does not double-emit when the action window overlaps across pages (failover / tip shift)', async () => {
    // A mid-drain window shift (endpoint failover, or new tip rows inserted between
    // page fetches) can make consecutive skip pages overlap. Dedup is against the
    // RUNNING max seq, so an already-emitted action in the overlap is never re-emitted.
    const page0 = makeActions([{ block: 1000, count: 100, startSeq: 1 }]);   // seq 1..100
    const page1 = makeActions([{ block: 1000, count: 100, startSeq: 100 }]); // seq 100..199 (overlaps at 100)
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      const page = call++ === 0 ? page0 : page1;
      return { ok: true, json: async () => ({ actions: page }) } as any;
    }));

    await (poller as any).pollContract('agentescrow');

    const seqs = emitted.map(a => a.global_sequence);
    expect(seqs.filter(s => s === 100).length).to.equal(1); // emitted once, not twice
    expect(new Set(seqs).size).to.equal(seqs.length);       // no duplicates anywhere
  });
});

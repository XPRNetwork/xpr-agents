import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import type { AddressInfo } from 'net';
import { initDatabase, updateStats } from '../src/db/schema';
import { createRoutes } from '../src/api/routes';
import { kycLevelFromClaims, computeTrustScore, enrichAgents, FetchLike } from '../src/enrich';

const MONTH = 30 * 24 * 60 * 60;

describe('kycLevelFromClaims', () => {
  it('returns 0 for missing or empty entries', () => {
    expect(kycLevelFromClaims(undefined)).toBe(0);
    expect(kycLevelFromClaims(null)).toBe(0);
    expect(kycLevelFromClaims([])).toBe(0);
    expect(kycLevelFromClaims([{ kyc_provider: 'x', kyc_level: '' }])).toBe(0);
  });

  it('maps claim counts to levels 1-3 and takes the max across providers', () => {
    expect(kycLevelFromClaims([{ kyc_level: 'email' }])).toBe(1);
    expect(kycLevelFromClaims([{ kyc_level: 'a,b' }])).toBe(1);
    expect(kycLevelFromClaims([{ kyc_level: 'a,b,c' }])).toBe(2);
    expect(kycLevelFromClaims([{ kyc_level: 'a,b,c,d,e' }])).toBe(3);
    expect(kycLevelFromClaims([{ kyc_level: 'a' }, { kyc_level: 'a,b,c,d,e,f' }])).toBe(3);
  });

  it('ignores a numeric kyc_level (the field is a claims string)', () => {
    // A bare number stringifies to one "claim" — level 1, never 3.
    expect(kycLevelFromClaims([{ kyc_level: 3 as unknown as string }])).toBe(1);
  });
});

describe('computeTrustScore', () => {
  const now = 1_800_000_000;

  it('matches the frontend formula (charliebot on 2026-09-02 = 96)', () => {
    // KYC 3 → 30, stake 100,271.99 XPR → min(floor(200.5), 20) = 20,
    // avg 10000 with feedback → 40, registered 6.5 months ago → 6. Total 96.
    const score = computeTrustScore({
      kyc_level: 3,
      system_stake: 1_002_719_900,
      avg_score: 10000,
      feedback_count: 7,
      registered_at: now - Math.floor(6.5 * MONTH),
    }, now);
    expect(score).toBe(96);
  });

  it('caps each component and floors reputation', () => {
    expect(computeTrustScore({ kyc_level: 9, system_stake: 0, avg_score: 0, feedback_count: 0, registered_at: now }, now)).toBe(30);
    expect(computeTrustScore({ kyc_level: 0, system_stake: 999_999_999_999, avg_score: 0, feedback_count: 0, registered_at: now }, now)).toBe(20);
    expect(computeTrustScore({ kyc_level: 0, system_stake: 0, avg_score: 8750, feedback_count: 5, registered_at: now }, now)).toBe(35);
    expect(computeTrustScore({ kyc_level: 0, system_stake: 0, avg_score: 0, feedback_count: 0, registered_at: now - 24 * MONTH }, now)).toBe(10);
  });

  it('scales reputation by review count until five reviews', () => {
    const base = { kyc_level: 0, system_stake: 0, avg_score: 10000, registered_at: now };
    expect(computeTrustScore({ ...base, feedback_count: 1 }, now)).toBe(8);
    expect(computeTrustScore({ ...base, feedback_count: 2 }, now)).toBe(16);
    expect(computeTrustScore({ ...base, feedback_count: 4 }, now)).toBe(32);
    expect(computeTrustScore({ ...base, feedback_count: 5 }, now)).toBe(40);
    expect(computeTrustScore({ ...base, feedback_count: 50 }, now)).toBe(40);
  });

  it('gives no reputation without feedback even if avg_score is set', () => {
    expect(computeTrustScore({ kyc_level: 0, system_stake: 0, avg_score: 10000, feedback_count: 0, registered_at: now }, now)).toBe(0);
  });
});

function fakeChain(kyc: Record<string, string[]>, stake: Record<string, number>, failFor: string[] = []): FetchLike {
  return async (_url: string, init?: any) => {
    const body = JSON.parse(init.body);
    const acct = body.lower_bound as string;
    if (failFor.includes(acct)) return { ok: false, json: async () => ({}) };
    if (body.table === 'usersinfo') {
      const claims = kyc[acct];
      return { ok: true, json: async () => ({ rows: claims ? [{ acc: acct, kyc: claims.map(c => ({ kyc_provider: 'p', kyc_level: c, kyc_date: 1 })) }] : [] }) };
    }
    if (body.table === 'voters') {
      const s = stake[acct];
      return { ok: true, json: async () => ({ rows: s !== undefined ? [{ owner: acct, staked: String(s) }] : [] }) };
    }
    return { ok: true, json: async () => ({ rows: [] }) };
  };
}

describe('enrichAgents', () => {
  let db: Database.Database;
  const now = 1_800_000_000;

  beforeEach(() => {
    db = initDatabase(':memory:');
    const ins = db.prepare(`INSERT INTO agents (account, owner, name, registered_at, active) VALUES (?, ?, ?, ?, 1)`);
    ins.run('botone', 'human', 'Bot One', now - 3 * MONTH);
    ins.run('bottwo', '', 'Bot Two', now - 1 * MONTH);
    ins.run('botthree', '.............', 'Bot Three', now);
    db.prepare(`INSERT INTO agent_scores (agent, total_score, total_weight, feedback_count, avg_score, last_updated) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('botone', 20, 4, 2, 10000, now);
  });

  it('uses the owner KYC when higher, reads stake, and writes trust_score', async () => {
    const fetchFn = fakeChain(
      { human: ['a,b,c,d,e'], botone: ['a'], bottwo: ['a,b,c'] },
      { botone: 2_500_000_000, bottwo: 0 },
    );
    const r = await enrichAgents(db, 'http://rpc', { fetchFn, now });
    expect(r).toEqual({ agents: 3, updated: 3, failed: 0 });

    const one = db.prepare('SELECT kyc_level, system_stake, trust_score, enriched_at FROM agents WHERE account = ?').get('botone') as any;
    // owner KYC 3 → 30; 250,000 XPR → 20; avg 10000 w/ feedback → 40; 3 months → 3
    // KYC 30 + stake 20 + reputation 16 (2 reviews at 100%: 40 x 2/5) + longevity 3
    expect(one).toEqual({ kyc_level: 3, system_stake: 2_500_000_000, trust_score: 69, enriched_at: now });

    const two = db.prepare('SELECT kyc_level, system_stake, trust_score FROM agents WHERE account = ?').get('bottwo') as any;
    expect(two).toEqual({ kyc_level: 2, system_stake: 0, trust_score: 21 });

    const three = db.prepare('SELECT kyc_level, system_stake, trust_score FROM agents WHERE account = ?').get('botthree') as any;
    expect(three).toEqual({ kyc_level: 0, system_stake: 0, trust_score: 0 });
  });

  it('keeps previous values for agents whose lookups fail', async () => {
    db.prepare('UPDATE agents SET kyc_level = 2, system_stake = 5, trust_score = 42 WHERE account = ?').run('botone');
    const fetchFn = fakeChain({ bottwo: ['a'] }, { bottwo: 0 }, ['human']);
    const r = await enrichAgents(db, 'http://rpc', { fetchFn, now });
    expect(r.failed).toBe(1);
    expect(r.updated).toBe(2);
    const one = db.prepare('SELECT kyc_level, system_stake, trust_score FROM agents WHERE account = ?').get('botone') as any;
    expect(one).toEqual({ kyc_level: 2, system_stake: 5, trust_score: 42 });
  });

  it('looks each account up once even when shared as owner and agent', async () => {
    let calls = 0;
    const base = fakeChain({ human: ['a'] }, {});
    const counting: FetchLike = (u, i) => { calls++; return base(u, i); };
    await enrichAgents(db, 'http://rpc', { fetchFn: counting, now });
    // 4 distinct KYC accounts (botone, human, bottwo, botthree) + 3 stake lookups
    expect(calls).toBe(7);
  });
});

describe('GET /api/agents pagination', () => {
  let db: Database.Database;
  let base: string;
  let server: ReturnType<express.Express['listen']>;

  beforeEach(async () => {
    db = initDatabase(':memory:');
    const ins = db.prepare(`INSERT INTO agents (account, name, registered_at, active, total_jobs, trust_score, system_stake) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    ins.run('alpha', 'Alpha', 100, 1, 5, 80, 0);
    ins.run('bravo', 'Bravo', 200, 1, 1, 60, 900);
    ins.run('charlie', 'Charlie', 300, 1, 9, 60, 0);
    ins.run('delta', 'Delta', 400, 0, 0, 99, 0); // inactive
    db.prepare(`INSERT INTO jobs (id, client, agent, amount, state) VALUES (1, 'c', 'bravo', 1000, 6), (2, 'c', 'bravo', 500, 8), (3, 'c', 'charlie', 700, 3)`).run();
    updateStats(db);
    const app = express();
    app.use('/api', createRoutes(db));
    server = app.listen(0);
    await new Promise<void>(r => server.once('listening', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });

  it('returns the full count and honours limit/offset with a stable trust order', async () => {
    const p1 = await (await fetch(`${base}/agents?limit=2&offset=0`)).json();
    expect(p1.total).toBe(3);
    expect(p1.limit).toBe(2);
    expect(p1.agents.map((a: any) => a.account)).toEqual(['alpha', 'charlie']); // 60-tie broken by total_jobs
    const p2 = await (await fetch(`${base}/agents?limit=2&offset=2`)).json();
    expect(p2.agents.map((a: any) => a.account)).toEqual(['bravo']);
  });

  it('includes earnings/completed_jobs and supports other sorts', async () => {
    const byEarn = await (await fetch(`${base}/agents?sort=earnings`)).json();
    expect(byEarn.agents[0].account).toBe('bravo');
    expect(byEarn.agents[0].earnings).toBe(1500);
    expect(byEarn.agents[0].completed_jobs).toBe(2);
    const byStake = await (await fetch(`${base}/agents?sort=stake`)).json();
    expect(byStake.agents[0].account).toBe('bravo');
    const all = await (await fetch(`${base}/agents?active_only=false`)).json();
    expect(all.total).toBe(4);
    expect(all.agents[0].account).toBe('delta');
  });

  it('exposes network_earnings and completed_jobs in /stats', async () => {
    const stats = await (await fetch(`${base}/stats`)).json();
    expect(stats.network_earnings).toBe(1500);
    expect(stats.completed_jobs).toBe(2);
  });

  it('reports sync-kyc as not configured without an RPC endpoint', async () => {
    process.env.ADMIN_API_TOKEN = 'tok';
    const app = express();
    app.use('/api', createRoutes(db, undefined, {}));
    const s2 = app.listen(0);
    await new Promise<void>(r => s2.once('listening', () => r()));
    const b2 = `http://127.0.0.1:${(s2.address() as AddressInfo).port}/api`;
    const res = await fetch(`${b2}/admin/sync-kyc`, { method: 'POST', headers: { authorization: 'Bearer tok' } });
    s2.close();
    expect(res.status).toBe(503);
  });

  afterEach(() => { server?.close(); });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

import blockartSkill, {
  MATERIAL, SETTING, LIGHT, PALETTE, MOTION, SCALE, TIME_OF_DAY, PATINA,
  deriveTraits, buildPrompt, buildManifest, patinaFor, blockHour, accountAgeDays,
  readPlan, writePlan, planPath,
  type BlockArtPlan, type Traits,
} from '../skills/blockart/src/index';

// ── Mock skill API (mirrors starter/agent/src/skill-loader.ts) ──

interface ToolDef {
  name: string;
  description: string;
  parameters: { type: 'object'; required?: string[]; properties: Record<string, unknown> };
  handler: (params: any) => Promise<any>;
}

function createMockApi(config: Record<string, unknown> = {}) {
  const tools = new Map<string, ToolDef>();
  return {
    tools,
    registerTool(tool: ToolDef) { tools.set(tool.name, tool); },
    getConfig() { return config; },
  };
}

// ── Fixtures cross-checked against the reference Python (fulfil.py) ──
// Produced by sha256'ing each block id and indexing the same tables. If these
// stop matching, the TypeScript port has silently changed what a block maps to.

const PY_FIXTURES = [
  {
    block_id: '0000000a3b9e2c1d5f4a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e',
    block_time: '2026-09-03T21:15:30.500',
    digest_head: [234, 231, 160, 9, 250, 122],
    material: 'braided optical fibre carrying blue light',
    setting: 'deep ocean, no horizon',
    light: 'low raking dawn light',
    palette: 'slate blue and lavender, muted and soft',
    motion: 'shattering outward',
    scale: "held at arm's length, macro detail",
    time_of_day: 'dead of night',
  },
  {
    block_id: '02f8c3a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d',
    block_time: '2026-01-01T00:00:00.000',
    digest_head: [216, 25, 247, 25, 19, 230],
    material: 'lapis lazuli veined with gold',
    setting: 'a mirrored infinity chamber',
    light: 'total eclipse corona',
    palette: 'slate blue and lavender, muted and soft',
    motion: 'slowly dissolving into particles',
    scale: 'reflected, the reflection sharper than the object',
    time_of_day: 'deep night, before dawn',
  },
  {
    block_id: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    block_time: '2025-06-15T13:45:00.000',
    digest_head: [175, 150, 19, 118, 15, 114],
    material: 'knurled anodised aluminium',
    setting: 'a cloud layer seen from above',
    light: 'single cold rim light',
    palette: 'ultraviolet and deep teal',
    motion: 'frozen at the instant of impact',
    scale: "held at arm's length, macro detail",
    time_of_day: 'late afternoon',
  },
];

// build_prompt() output from the reference Python, verbatim.
const PY_PROMPT_NO_STEER =
  "Reproduce the emblem from the reference image EXACTLY: it is a classic ATOM. At the exact centre sits one solid sphere, the nucleus. Around that nucleus run exactly three slender elliptical ORBIT rings, all sharing the same centre point, each rotated about sixty degrees from the next, so they read as orbital paths sweeping around the nucleus. Each orbit is a thin open hoop with empty space inside it, never a filled disc or shell, and the background shows through the gaps.\n\nThe three orbits are made of braided optical fibre carrying blue light. The atom is held at arm's length, macro detail, set in deep ocean, no horizon, at dead of night, lit by low raking dawn light. Its surface is worn at the edges from use. The atom is shattering outward. Colour palette strictly slate blue and lavender, muted and soft.\n\nPremium 3D render, glossy and dimensional, ray-traced reflections, shallow depth of field, centred composition with generous negative space.\n\nNo text, no letters, no numbers and no watermark. The atom is the only emblem; any other imagery is scenery, never a logo.";

const PY_PROMPT_WITH_STEER =
  "Reproduce the emblem from the reference image EXACTLY: it is a classic ATOM. At the exact centre sits one solid sphere, the nucleus. Around that nucleus run exactly three slender elliptical ORBIT rings, all sharing the same centre point, each rotated about sixty degrees from the next, so they read as orbital paths sweeping around the nucleus. Each orbit is a thin open hoop with empty space inside it, never a filled disc or shell, and the background shows through the gaps.\n\nThe three orbits are made of braided optical fibre carrying blue light. The atom is held at arm's length, macro detail, set in deep ocean, no horizon, at dead of night, lit by low raking dawn light. Its surface is worn at the edges from use. The atom is shattering outward. Colour palette strictly slate blue and lavender, muted and soft.\n\nPremium 3D render, glossy and dimensional, ray-traced reflections, shallow depth of field, centred composition with generous negative space.\n\nThe buyer asked for this, and it must be visibly present: mood: stormy; the buyer's theme: sailing ships. Work their theme into the surroundings — the environment, the sky, the forms and shadows around the atom — while the atom itself stays the single clear subject at the centre, unchanged in geometry.\n\nNo text, no letters, no numbers and no watermark. The atom is the only emblem; any other imagery is scenery, never a logo.";

const TRAITS_FIXTURE: Traits = {
  material: 'braided optical fibre carrying blue light',
  setting: 'deep ocean, no horizon',
  light: 'low raking dawn light',
  palette: 'slate blue and lavender, muted and soft',
  motion: 'shattering outward',
  scale: "held at arm's length, macro detail",
  time_of_day: 'dead of night',
  patina: 'worn at the edges from use',
};

// ── Trait tables ──

describe('Block Art trait tables', () => {
  it('keeps the published table sizes', () => {
    expect(MATERIAL).toHaveLength(16);
    expect(SETTING).toHaveLength(16);
    expect(LIGHT).toHaveLength(16);
    expect(PALETTE).toHaveLength(16);
    expect(MOTION).toHaveLength(8);
    expect(SCALE).toHaveLength(8);
    expect(TIME_OF_DAY).toHaveLength(8);
    expect(PATINA).toHaveLength(5);
  });

  it('has no duplicate entries (a duplicate would make two blocks indistinguishable)', () => {
    for (const table of [MATERIAL, SETTING, LIGHT, PALETTE, MOTION, SCALE, TIME_OF_DAY, PATINA]) {
      expect(new Set(table).size).toBe(table.length);
    }
  });
});

// ── Derivation ──

describe('Block Art trait derivation', () => {
  it.each(PY_FIXTURES)('matches the reference Python for block $block_id', (f) => {
    const digest = createHash('sha256').update(Buffer.from(f.block_id, 'hex')).digest();
    expect(Array.from(digest.subarray(0, 6))).toEqual(f.digest_head);

    const traits = deriveTraits(f.block_id, f.block_time, 500);
    expect(traits.material).toBe(f.material);
    expect(traits.setting).toBe(f.setting);
    expect(traits.light).toBe(f.light);
    expect(traits.palette).toBe(f.palette);
    expect(traits.motion).toBe(f.motion);
    expect(traits.scale).toBe(f.scale);
    expect(traits.time_of_day).toBe(f.time_of_day);
  });

  it('is deterministic — the same block always yields the same piece', () => {
    const f = PY_FIXTURES[0];
    const a = deriveTraits(f.block_id, f.block_time, 500);
    const b = deriveTraits(f.block_id, f.block_time, 500);
    expect(a).toEqual(b);
  });

  it('indexes by the raw block id bytes, not the hex text', () => {
    const f = PY_FIXTURES[0];
    const digest = createHash('sha256').update(Buffer.from(f.block_id, 'hex')).digest();
    const textDigest = createHash('sha256').update(f.block_id).digest();
    expect(digest[0]).not.toBe(textDigest[0]);
    expect(deriveTraits(f.block_id, f.block_time, 0).material).toBe(MATERIAL[digest[0] % 16]);
  });

  it('rejects a block id that is not hex', () => {
    expect(() => deriveTraits('not-hex', '2026-01-01T00:00:00.000', 0)).toThrow(/not hex/);
  });

  it('buckets time_of_day by hour // 3, independent of the host timezone', () => {
    for (let hour = 0; hour < 24; hour++) {
      const hh = String(hour).padStart(2, '0');
      expect(blockHour(`2026-01-01T${hh}:30:00.000`)).toBe(hour);
      const traits = deriveTraits(PY_FIXTURES[0].block_id, `2026-01-01T${hh}:30:00.000`, 0);
      expect(traits.time_of_day).toBe(TIME_OF_DAY[Math.floor(hour / 3)]);
    }
  });
});

describe('Block Art patina bucketing', () => {
  const boundaries: [number, string][] = [
    [0, 'factory fresh, not a mark on it'],
    [89, 'factory fresh, not a mark on it'],
    [90, 'lightly handled, faint fingerprints'],
    [364, 'lightly handled, faint fingerprints'],
    [365, 'worn at the edges from use'],
    [1094, 'worn at the edges from use'],
    [1095, 'aged, oxidised, softened by years'],
    [1824, 'aged, oxidised, softened by years'],
    [1825, 'ancient, pitted and mineral-crusted'],
    [9000, 'ancient, pitted and mineral-crusted'],
  ];

  it.each(boundaries)('%i days → %s', (days, expected) => {
    expect(patinaFor(days)).toBe(expected);
    expect(deriveTraits(PY_FIXTURES[0].block_id, PY_FIXTURES[0].block_time, days).patina).toBe(expected);
  });

  it('floors the account age in whole days, UTC', () => {
    const now = Date.parse('2026-09-03T00:00:00.000Z');
    expect(accountAgeDays('2026-09-02T00:00:01.000', now)).toBe(0);
    expect(accountAgeDays('2026-09-02T00:00:00.000', now)).toBe(1);
    expect(accountAgeDays('2026-09-02T00:00:00.000Z', now)).toBe(1);
  });
});

// ── Prompt ──

describe('Block Art prompt', () => {
  it('matches the reference Python with no buyer steer', () => {
    expect(buildPrompt(TRAITS_FIXTURE, '')).toBe(PY_PROMPT_NO_STEER);
  });

  it('matches the reference Python with a buyer steer', () => {
    const steer = "mood: stormy; the buyer's theme: sailing ships";
    expect(buildPrompt(TRAITS_FIXTURE, steer)).toBe(PY_PROMPT_WITH_STEER);
  });

  it('keeps the atom the subject and the steer in the surroundings', () => {
    const p = buildPrompt(TRAITS_FIXTURE, 'dragons');
    expect(p).toContain('Work their theme into the surroundings');
    expect(p).toContain('unchanged in geometry');
    expect(p.endsWith('any other imagery is scenery, never a logo.')).toBe(true);
  });
});

// ── Manifest ──

function fixturePlan(overrides: Partial<BlockArtPlan> = {}): BlockArtPlan {
  return {
    job_id: 42,
    service: 'svc:4',
    client: 'buyeracct',
    buyer: { account: 'buyeracct', display_name: 'Buyer', verified: true },
    seed_block: 123456789,
    block_id: PY_FIXTURES[0].block_id,
    block_time: PY_FIXTURES[0].block_time,
    producer: 'protonnz',
    buyer_steer: '',
    traits: TRAITS_FIXTURE,
    account_age_days: 500,
    prompt: PY_PROMPT_NO_STEER,
    how_to_verify: 'sha256 the block id...',
    ...overrides,
  };
}

describe('Block Art delivery manifest', () => {
  it('puts the image first, as image/png, with traits.json second', () => {
    const manifest = JSON.parse(buildManifest(fixturePlan(), 'https://gw.example/ipfs/bafyTEST'));
    expect(manifest.v).toBe(1);
    expect(manifest.files).toHaveLength(2);
    expect(manifest.files[0]).toEqual({
      name: 'blockart.png',
      uri: 'https://gw.example/ipfs/bafyTEST/blockart.png',
      type: 'image/png',
    });
    expect(manifest.files[1]).toEqual({
      name: 'traits.json',
      uri: 'https://gw.example/ipfs/bafyTEST/traits.json',
      type: 'application/json',
    });
  });

  it('notes the seed block, producer and every trait so the buyer can check it', () => {
    const manifest = JSON.parse(buildManifest(fixturePlan(), 'https://gw.example/ipfs/bafy'));
    expect(manifest.note).toContain('Seeded by block 123456789');
    expect(manifest.note).toContain('produced by protonnz');
    for (const value of Object.values(TRAITS_FIXTURE)) expect(manifest.note).toContain(value);
    expect(manifest.note).toContain(PY_FIXTURES[0].block_id.slice(0, 16));
    expect(manifest.note).toContain('buyeracct');
  });

  it('is compact JSON that fits the on-chain evidence_uri limit', () => {
    const manifest = buildManifest(fixturePlan(), 'https://gw.example/ipfs/bafy');
    expect(manifest).not.toContain('\n');
    expect(manifest.startsWith('{"v":1,"files":[{"name":"blockart.png"')).toBe(true);
    expect(manifest.length).toBeLessThanOrEqual(2048);
  });

  it('truncates rather than exceeding 2048 bytes', () => {
    const manifest = buildManifest(fixturePlan({ producer: 'x'.repeat(4000) }), 'https://gw.example/ipfs/bafy');
    expect(manifest.length).toBeLessThanOrEqual(2048);
    expect(manifest.startsWith('{"v":1,"files":[{"name":"blockart.png"')).toBe(true);
  });
});

// ── Tool registration + handlers ──

const BLOCK = {
  id: PY_FIXTURES[0].block_id,
  timestamp: PY_FIXTURES[0].block_time,
  producer: 'protonnz',
};

const JOB = {
  id: 42,
  client: 'buyeracct',
  agent: 'greyagent',
  description: 'Block Art\n\nBuyer notes: something',
  state: 3,
  job_hash: 'svc:4',
};

interface FetchLog { url: string; body?: any }

function installFetch(opts: {
  transferActions?: any[];
  reviseActions?: any[];
  jobmsgs?: any[];
  job?: any;
  replicate?: any;
  pinata?: any;
  png?: Buffer;
} = {}) {
  const calls: FetchLog[] = [];
  const json = (data: any) => ({
    ok: true, status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
    arrayBuffer: async () => new ArrayBuffer(0),
  });

  const impl = vi.fn(async (url: string, init: any = {}) => {
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), body });
    const u = String(url);

    if (u.includes('/v1/chain/get_table_rows')) {
      if (body.table === 'jobs') return json({ rows: opts.job === null ? [] : [opts.job || JOB] });
      if (body.table === 'jobmsgs') return json({ rows: opts.jobmsgs || [] });
      if (body.table === 'usersinfo') return json({ rows: [{ name: 'Buyer Name', verified: 1 }] });
      return json({ rows: [] });
    }
    if (u.includes('/v1/chain/get_block')) return json(BLOCK);
    if (u.includes('/v1/chain/get_account')) return json({ created: '2020-01-01T00:00:00.000' });
    if (u.includes('get_actions') && u.includes('eosio.token%3Atransfer')) {
      return json({ actions: opts.transferActions || [] });
    }
    if (u.includes('get_actions') && u.includes('eosio.token:transfer')) {
      return json({ actions: opts.transferActions || [] });
    }
    if (u.includes('get_actions') && u.includes('revise')) return json({ actions: opts.reviseActions || [] });
    if (u.includes('api.replicate.com')) {
      return json(opts.replicate || { status: 'succeeded', output: ['https://replicate.delivery/out.png'] });
    }
    if (u.includes('replicate.delivery')) {
      const buf = opts.png || Buffer.from('PNGDATA');
      return {
        ok: true, status: 200,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        json: async () => ({}), text: async () => '',
      };
    }
    if (u.includes('api.pinata.cloud')) return json(opts.pinata || { IpfsHash: 'bafyTESTCID' });
    throw new Error(`unexpected fetch: ${u}`);
  });

  (globalThis as any).fetch = impl;
  return { calls, impl };
}

describe('Block Art tools', () => {
  let tmpDir: string;
  let realFetch: any;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blockart-test-'));
    realFetch = (globalThis as any).fetch;
    process.env.BLOCKART_WORK_DIR = tmpDir;
    process.env.HYPERION_URL = 'https://hyperion.example';
    process.env.XPR_RPC_ENDPOINT = 'https://rpc.example';
    delete process.env.XPR_ACCOUNT;
    delete process.env.REPLICATE_API_TOKEN;
    delete process.env.PINATA_JWT;
    delete process.env.PINATA_GATEWAY;
  });

  afterEach(() => {
    (globalThis as any).fetch = realFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...savedEnv };
  });

  function loadSkill() {
    const api = createMockApi({ rpcEndpoint: 'https://rpc.example' });
    blockartSkill(api as any);
    return api;
  }

  it('registers exactly the two documented tools', () => {
    const api = loadSkill();
    expect(api.tools.size).toBe(2);
    expect(api.tools.has('blockart_plan')).toBe(true);
    expect(api.tools.has('blockart_render')).toBe(true);
  });

  it('blockart_plan derives the piece from the funding transfer block', async () => {
    installFetch({
      transferActions: [
        { block_num: 555, act: { data: { from: 'someoneelse', memo: 'buy:4' } } },
        { block_num: 987, act: { data: { from: 'buyeracct', memo: 'buy:4:make it stormy' } } },
      ],
    });
    const api = loadSkill();
    const res = await api.tools.get('blockart_plan')!.handler({ job_id: 42 });

    expect(res.error).toBeUndefined();
    expect(res.plan.seed_block).toBe(987);
    expect(res.plan.block_id).toBe(BLOCK.id);
    expect(res.plan.producer).toBe('protonnz');
    expect(res.plan.traits.material).toBe(PY_FIXTURES[0].material);
    expect(res.plan.buyer).toEqual({ account: 'buyeracct', display_name: 'Buyer Name', verified: true });
    expect(res.reused_seed_block).toBe(false);
    expect(typeof res.summary).toBe('string');
    expect(res.summary).toContain('block 987');
    // The plan is persisted as the traits.json that will be pinned.
    expect(fs.existsSync(planPath(tmpDir, 42))).toBe(true);
    expect(readPlan(tmpDir, 42)!.seed_block).toBe(987);
  });

  it('blockart_plan reuses the stored seed block instead of re-deriving it', async () => {
    writePlan(tmpDir, fixturePlan({ job_id: 42, seed_block: 111222 }));
    const { calls } = installFetch({
      // If the transfer lookup were consulted it would hand back a different block.
      transferActions: [{ block_num: 999999, act: { data: { from: 'buyeracct', memo: 'buy:4' } } }],
    });
    const api = loadSkill();
    const res = await api.tools.get('blockart_plan')!.handler({ job_id: 42 });

    expect(res.error).toBeUndefined();
    expect(res.plan.seed_block).toBe(111222);
    expect(res.reused_seed_block).toBe(true);
    expect(res.summary).toContain('reused from the first attempt');
    expect(calls.some(c => c.url.includes('transfer'))).toBe(false);
  });

  it('blockart_plan folds the form answers and revise notes into the steer', async () => {
    installFetch({
      transferActions: [{ block_num: 987, act: { data: { from: 'buyeracct', memo: 'buy:4' } } }],
      jobmsgs: [
        { author: 'buyeracct', text: JSON.stringify({ mood: 'stormy', intended_use: 'not sure yet', notes: 'sailing ships' }) },
        { author: 'greyagent', text: JSON.stringify({ mood: 'ignored' }) },
      ],
      reviseActions: [
        { act: { data: { job_id: 42, notes: 'too dark' } } },
        { act: { data: { job_id: 43, notes: 'other job' } } },
      ],
    });
    const api = loadSkill();
    const res = await api.tools.get('blockart_plan')!.handler({ job_id: 42 });

    expect(res.plan.buyer_steer).toContain('mood: stormy');
    expect(res.plan.buyer_steer).toContain("the buyer's theme: sailing ships");
    expect(res.plan.buyer_steer).not.toContain('not sure yet');
    expect(res.plan.buyer_steer).not.toContain('ignored');
    expect(res.plan.buyer_steer).not.toContain('other job');
    expect(res.plan.buyer_steer).toContain('the buyer rejected the last attempt, saying: too dark');
    expect(res.plan.prompt).toContain('Work their theme into the surroundings');
  });

  it('blockart_plan drops "let the block decide" moods and lets the block decide', async () => {
    installFetch({
      job: { ...JOB, description: 'Block Art' },
      transferActions: [{ block_num: 987, act: { data: { from: 'buyeracct', memo: 'buy:4' } } }],
      jobmsgs: [{ author: 'buyeracct', text: JSON.stringify({ mood: 'Let the block decide', notes: '' }) }],
    });
    const api = loadSkill();
    const res = await api.tools.get('blockart_plan')!.handler({ job_id: 42 });
    expect(res.plan.buyer_steer).toBe('');
    expect(res.plan.prompt).toBe(buildPrompt(res.plan.traits, ''));
    expect(res.plan.prompt).not.toContain('The buyer asked for this');
  });

  it('blockart_plan falls back to the transfer-memo notes when there are no form answers', async () => {
    installFetch({
      job: { ...JOB, description: 'Block Art\n\nBuyer notes: sailing ships, please' },
      transferActions: [{ block_num: 987, act: { data: { from: 'buyeracct', memo: 'buy:4' } } }],
      jobmsgs: [],
    });
    const api = loadSkill();
    const res = await api.tools.get('blockart_plan')!.handler({ job_id: 42 });
    expect(res.plan.buyer_steer).toBe('sailing ships, please');
    expect(res.plan.prompt).toContain('sailing ships, please');
  });

  it('blockart_plan refuses a job that is not a service purchase', async () => {
    installFetch({ job: { ...JOB, job_hash: 'openjob' } });
    const api = loadSkill();
    const res = await api.tools.get('blockart_plan')!.handler({ job_id: 42 });
    expect(res.error).toMatch(/svc:<id>/);
  });

  it('blockart_plan refuses a job assigned to another agent', async () => {
    process.env.XPR_ACCOUNT = 'otheragent';
    installFetch({});
    const api = loadSkill();
    const res = await api.tools.get('blockart_plan')!.handler({ job_id: 42 });
    expect(res.error).toMatch(/assigned to "greyagent"/);
  });

  it('blockart_plan reports a missing funding transfer instead of inventing a block', async () => {
    installFetch({ transferActions: [] });
    const api = loadSkill();
    const res = await api.tools.get('blockart_plan')!.handler({ job_id: 42 });
    expect(res.error).toMatch(/could not find the funding transfer/);
    expect(fs.existsSync(planPath(tmpDir, 42))).toBe(false);
  });

  it('blockart_render names the missing environment variable', async () => {
    writePlan(tmpDir, fixturePlan());
    installFetch({});
    const api = loadSkill();

    let res = await api.tools.get('blockart_render')!.handler({ job_id: 42 });
    expect(res.error).toMatch(/REPLICATE_API_TOKEN/);

    process.env.REPLICATE_API_TOKEN = 'r8_test';
    res = await api.tools.get('blockart_render')!.handler({ job_id: 42 });
    expect(res.error).toMatch(/PINATA_JWT/);
  });

  it('blockart_render requires a plan first', async () => {
    process.env.REPLICATE_API_TOKEN = 'r8_test';
    process.env.PINATA_JWT = 'jwt_test';
    installFetch({});
    const api = loadSkill();
    const res = await api.tools.get('blockart_render')!.handler({ job_id: 99 });
    expect(res.error).toMatch(/call blockart_plan first/);
  });

  it('blockart_render renders, pins, and returns a manifest without signing anything', async () => {
    process.env.REPLICATE_API_TOKEN = 'r8_test';
    process.env.PINATA_JWT = 'jwt_test';
    process.env.PINATA_GATEWAY = 'https://gw.example/';
    writePlan(tmpDir, fixturePlan());
    const { calls } = installFetch({ png: Buffer.from('PNGDATA') });
    const api = loadSkill();
    const res = await api.tools.get('blockart_render')!.handler({ job_id: 42 });

    expect(res.error).toBeUndefined();
    expect(res.cid).toBe('bafyTESTCID');
    expect(res.image_url).toBe('https://gw.example/ipfs/bafyTESTCID/blockart.png');
    expect(res.traits_url).toBe('https://gw.example/ipfs/bafyTESTCID/traits.json');

    const manifest = JSON.parse(res.evidence_uri);
    expect(manifest.files[0].name).toBe('blockart.png');
    expect(manifest.files[0].type).toBe('image/png');
    expect(manifest.files[1].name).toBe('traits.json');

    // Replicate is asked for the exact listing spec, with the glyph as reference.
    const replicate = calls.find(c => c.url.includes('api.replicate.com'))!;
    expect(replicate.url).toContain('google/nano-banana-2');
    expect(replicate.body.input.aspect_ratio).toBe('1:1');
    expect(replicate.body.input.resolution).toBe('2K');
    expect(replicate.body.input.output_format).toBe('png');
    expect(replicate.body.input.image_input).toEqual(['https://xpragents.com/xpr-glyph-black.png']);
    expect(replicate.body.input.prompt).toBe(PY_PROMPT_NO_STEER);

    // Nothing on chain: no RPC, no push_transaction, no delivery.
    expect(calls.some(c => c.url.includes('push_transaction'))).toBe(false);
    expect(calls.some(c => c.url.includes('rpc.example'))).toBe(false);
    expect(res.transaction_id).toBeUndefined();
    expect(res.instruction).toMatch(/xpr_deliver_job/);
  });

  it('blockart_render surfaces a failed generation rather than delivering nothing', async () => {
    process.env.REPLICATE_API_TOKEN = 'r8_test';
    process.env.PINATA_JWT = 'jwt_test';
    writePlan(tmpDir, fixturePlan());
    installFetch({ replicate: { status: 'failed', error: 'content policy' } });
    const api = loadSkill();
    const res = await api.tools.get('blockart_render')!.handler({ job_id: 42 });
    expect(res.error).toMatch(/content policy/);
  });

  it('never writes a token to the plan file', async () => {
    process.env.REPLICATE_API_TOKEN = 'r8_secret_token';
    process.env.PINATA_JWT = 'jwt_secret_token';
    installFetch({ transferActions: [{ block_num: 987, act: { data: { from: 'buyeracct', memo: 'buy:4' } } }] });
    const api = loadSkill();
    await api.tools.get('blockart_plan')!.handler({ job_id: 42 });
    const onDisk = fs.readFileSync(planPath(tmpDir, 42), 'utf-8');
    expect(onDisk).not.toContain('r8_secret_token');
    expect(onDisk).not.toContain('jwt_secret_token');
  });
});

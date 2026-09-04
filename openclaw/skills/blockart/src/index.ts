/**
 * Block Art Skill — fulfils "Block Art" service purchases.
 *
 * A Block Art buyer gets a 2048px render of the XPR Network atom emblem whose
 * every visual trait is derived, deterministically and checkably, from the
 * block their payment confirmed in. The derivation below is a published promise
 * to buyers: the trait tables, their order, and the byte offsets used to index
 * them must not change, or an existing block silently starts mapping to a
 * different piece.
 *
 * Two tools, deliberately split:
 *   blockart_plan   — read chain, recover the seed block, derive traits, build
 *                     the prompt, persist the plan. No spend, no signing.
 *   blockart_render — render, pin to IPFS, hand back a delivery manifest.
 *                     Never signs and never delivers: the agent delivers by
 *                     passing the manifest to the audited xpr_deliver_job tool.
 *
 * Ported from the reference Python implementation (fulfil.py) that has already
 * fulfilled real orders. Behaviour is kept byte-for-byte where it is visible to
 * a buyer.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────

interface ToolDef {
  name: string;
  description: string;
  parameters: { type: 'object'; required?: string[]; properties: Record<string, unknown> };
  handler: (params: any) => Promise<unknown>;
}

interface SkillApi {
  registerTool(tool: ToolDef): void;
  getConfig(): Record<string, unknown>;
}

export interface Traits {
  material: string;
  setting: string;
  light: string;
  palette: string;
  motion: string;
  scale: string;
  time_of_day: string;
  patina: string;
}

export interface BuyerIdentity {
  account: string;
  display_name: string | null;
  verified: boolean;
}

export interface BlockArtPlan {
  job_id: number;
  service: string;
  client: string;
  buyer: BuyerIdentity;
  seed_block: number;
  block_id: string;
  block_time: string;
  producer: string;
  buyer_steer: string;
  traits: Traits;
  account_age_days: number;
  prompt: string;
  how_to_verify: string;
}

// ── Constants ────────────────────────────────────

const ESCROW = 'agentescrow';
const GLYPH = 'https://xpragents.com/xpr-glyph-black.png';
const REPLICATE_MODEL = 'google/nano-banana-2';
const DEFAULT_RPC = 'https://proton.eosusa.io';
const DEFAULT_HYPERION = 'https://proton.eosusa.io';
const DEFAULT_GATEWAY = 'https://agent.mypinata.cloud';
const DEFAULT_WORK_DIR = './blockart-work';

const HTTP_TIMEOUT = 30000;
const RENDER_DEADLINE_MS = 300000;
const MAX_DOWNLOAD_SIZE = 25 * 1024 * 1024;
const MAX_EVIDENCE_LEN = 2048;

// ── Trait tables ─────────────────────────────────
// PUBLISHED DERIVATION — do not reorder, insert, or reword. Buyers verify a
// finished piece against these tables; an edit rewrites history.

export const MATERIAL: string[] = [
  'woven brass wire, purple-anodised',
  'hand-blown violet glass tubing',
  'brushed titanium tube with a violet anodised sheen',
  'polished amethyst rod',
  'liquid mercury drawn into slender rings',
  'spun indigo carbon fibre',
  'cold neon tubing, violet-blue',
  'hammered silver wire with a blue patina',
  'lapis lazuli veined with gold',
  'frosted acrylic lit from within',
  'braided optical fibre carrying blue light',
  'wet ink drawn into perfect loops',
  'blued gun steel, mirror finished',
  'iridescent beetle-shell chitin',
  'clear ice with violet trapped inside',
  'knurled anodised aluminium',
];

export const SETTING: string[] = [
  'a still black water surface',
  'a salt flat under open sky',
  'a vast marble hall',
  'dense volcanic rock',
  'a field of drifting particles',
  'the inside of a geode',
  'a cloud layer seen from above',
  'deep ocean, no horizon',
  'a windless dune sea',
  'a mirrored infinity chamber',
  'an abandoned observatory dome',
  'a cracked frozen lake',
  'a monsoon downpour at night',
  'a field of tall dry grass',
  'a limestone cavern floor',
  "low orbit, a planet's edge below",
];

export const LIGHT: string[] = [
  'low raking dawn light',
  'hard directional noon sun',
  'soft overcast diffusion',
  'single cold rim light',
  'warm sodium glow',
  'caustic light through water',
  'bioluminescence',
  'total eclipse corona',
  'lightning frozen mid-strike',
  'close flickering candlelight',
  'a searchlight beam through fog',
  'low blue moonlight',
  'light through stained glass',
  'the glow of a screen just off frame',
  'aurora light from above',
  'backlit against a bright sky',
];

export const PALETTE: string[] = [
  'deep indigo #4B3ADF and violet #7A68FF against near-black',
  'electric violet and cold cyan-blue, high contrast',
  'royal purple and pale ice blue',
  'indigo and bone white, minimal and clean',
  'midnight navy and luminous periwinkle',
  'iridescent purple-to-blue shift, oil-slick sheen',
  'ultraviolet and deep teal',
  'amethyst and brushed silver-blue',
  'violet and warm gold, jewel-toned',
  'slate blue and lavender, muted and soft',
  'deep plum and electric blue',
  'cobalt and pale lilac',
  'blue-black and neon magenta-violet',
  'dusty mauve and steel blue',
  'sapphire and pearl white',
  'blacklight purple on charcoal',
];

export const MOTION: string[] = [
  'perfectly still',
  'mid-rotation, motion blur on the outer ring',
  'shattering outward',
  'slowly dissolving into particles',
  'reassembling from fragments',
  'rippling as if seen through heat haze',
  'spinning fast enough to blur into a shell',
  'frozen at the instant of impact',
];

export const SCALE: string[] = [
  'monumental, filling the frame',
  'small and distant, dwarfed by the setting',
  "held at arm's length, macro detail",
  'repeated in receding rows',
  'tilted off-axis, seen from below',
  'seen from directly above, flattened',
  'reflected, the reflection sharper than the object',
  'partially out of frame, cropped close',
];

export const TIME_OF_DAY: string[] = [
  'deep night, before dawn',
  'first light',
  'full morning',
  'high noon',
  'late afternoon',
  'golden hour',
  'dusk',
  'dead of night',
];

export const PATINA: string[] = [
  'factory fresh, not a mark on it',
  'lightly handled, faint fingerprints',
  'worn at the edges from use',
  'aged, oxidised, softened by years',
  'ancient, pitted and mineral-crusted',
];

const PATINA_THRESHOLDS = [90, 365, 1095, 1825];

export const HOW_TO_VERIFY =
  'sha256 the block id, then index MATERIAL/SETTING/LIGHT/PALETTE (16 each) ' +
  'by bytes 0-3 mod 16 and MOTION/SCALE (8 each) by bytes 4-5 mod 8; hour//3 of the block ' +
  'time gives time_of_day; the client account\'s age gives patina.';

// ── Derivation ───────────────────────────────────

/** Age in days of the buyer's account, bucketed at 90 / 365 / 1095 / 1825. */
export function patinaFor(accountAgeDays: number): string {
  let idx = 0;
  for (const threshold of PATINA_THRESHOLDS) if (accountAgeDays >= threshold) idx += 1;
  return PATINA[Math.min(idx, 4)];
}

/**
 * The hour of a chain timestamp, read literally. Chain timestamps are UTC and
 * carry no offset, so the literal hour in the string is the hour that matters —
 * reading it textually keeps the result free of the host's timezone.
 */
export function blockHour(blockTime: string): number {
  const m = /T(\d{2}):/.exec(blockTime);
  if (m) return parseInt(m[1], 10);
  const parsed = new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(blockTime) ? blockTime : `${blockTime}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`unparseable block time: ${blockTime}`);
  return parsed.getUTCHours();
}

/** Days between an ISO timestamp (UTC, offset optional) and now, floored. */
export function accountAgeDays(created: string, now: number = Date.now()): number {
  const iso = /[Zz]|[+-]\d{2}:?\d{2}$/.test(created) ? created : `${created}Z`;
  const createdMs = new Date(iso).getTime();
  if (Number.isNaN(createdMs)) throw new Error(`unparseable account creation time: ${created}`);
  return Math.floor((now - createdMs) / 86400000);
}

/**
 * Every trait, from the block id, the block time, and the buyer's account age.
 * sha256 the raw block id bytes; bytes 0-3 mod 16 pick material/setting/light/
 * palette, bytes 4-5 mod 8 pick motion/scale.
 */
export function deriveTraits(blockId: string, blockTime: string, ageDays: number): Traits {
  if (!/^[0-9a-fA-F]+$/.test(blockId) || blockId.length % 2 !== 0) {
    throw new Error(`block id is not hex: ${blockId}`);
  }
  const h = createHash('sha256').update(Buffer.from(blockId, 'hex')).digest();
  return {
    material: MATERIAL[h[0] % 16],
    setting: SETTING[h[1] % 16],
    light: LIGHT[h[2] % 16],
    palette: PALETTE[h[3] % 16],
    motion: MOTION[h[4] % 8],
    scale: SCALE[h[5] % 8],
    time_of_day: TIME_OF_DAY[Math.floor(blockHour(blockTime) / 3)],
    patina: patinaFor(ageDays),
  };
}

/** The generation prompt. The atom's geometry is fixed; the block sets the rest. */
export function buildPrompt(t: Traits, steer: string): string {
  let p =
    'Reproduce the emblem from the reference image EXACTLY: it is a classic ATOM. At the ' +
    'exact centre sits one solid sphere, the nucleus. Around that nucleus run exactly three ' +
    'slender elliptical ORBIT rings, all sharing the same centre point, each rotated about ' +
    'sixty degrees from the next, so they read as orbital paths sweeping around the nucleus. ' +
    'Each orbit is a thin open hoop with empty space inside it, never a filled disc or shell, ' +
    'and the background shows through the gaps.\n\n' +
    `The three orbits are made of ${t.material}. The atom is ${t.scale}, set in ` +
    `${t.setting}, at ${t.time_of_day}, lit by ${t.light}. Its surface is ` +
    `${t.patina}. The atom is ${t.motion}. Colour palette strictly ${t.palette}.\n\n` +
    'Premium 3D render, glossy and dimensional, ray-traced reflections, shallow depth of ' +
    'field, centred composition with generous negative space.';
  if (steer) {
    // The block fixes the atom's material, setting, light, palette, motion and
    // scale. It says nothing about what else may share the scene, so a buyer's
    // theme is honoured around the atom rather than refused.
    p +=
      `\n\nThe buyer asked for this, and it must be visibly present: ${steer}. ` +
      'Work their theme into the surroundings — the environment, the sky, the ' +
      'forms and shadows around the atom — while the atom itself stays the ' +
      'single clear subject at the centre, unchanged in geometry.';
  }
  return (
    p +
    '\n\nNo text, no letters, no numbers and no watermark. ' +
    'The atom is the only emblem; any other imagery is scenery, never a logo.'
  );
}

/**
 * A manifest, not a bare link: the job page renders the first file when it is an
 * image, so the buyer sees the piece instead of a gateway directory listing.
 */
export function buildManifest(plan: BlockArtPlan, base: string): string {
  const t = plan.traits;
  let manifest = JSON.stringify({
    v: 1,
    files: [
      { name: 'blockart.png', uri: `${base}/blockart.png`, type: 'image/png' },
      { name: 'traits.json', uri: `${base}/traits.json`, type: 'application/json' },
    ],
    note:
      `Seeded by block ${plan.seed_block}, produced by ${plan.producer} at ${plan.block_time}Z. ` +
      `${t.material}; ${t.setting}; ${t.light}; ${t.palette}; ${t.motion}; ` +
      `${t.scale}; ${t.time_of_day}; patina ${t.patina}. ` +
      `Every trait derives from the block id (${plan.block_id.slice(0, 16)}...) and the age of ` +
      `${plan.client}; traits.json shows the derivation so you can check it.`,
  });
  if (manifest.length > MAX_EVIDENCE_LEN) manifest = manifest.slice(0, MAX_EVIDENCE_LEN - 8) + '"}]}';
  return manifest;
}

/** One paragraph an operator (or an agent) can read without opening the JSON. */
export function planSummary(plan: BlockArtPlan, reusedSeed: boolean): string {
  const t = plan.traits;
  const who = plan.buyer.display_name ? `${plan.buyer.display_name} (${plan.client})` : plan.client;
  return [
    `Job ${plan.job_id} is a Block Art purchase by ${who}, seeded by block ${plan.seed_block}`,
    `(${plan.block_id.slice(0, 16)}..., produced by ${plan.producer} at ${plan.block_time}Z)`,
    reusedSeed ? 'reused from the first attempt.' : 'recovered from the payment transfer.',
    `The block gives: three orbits of ${t.material}, ${t.scale}, set in ${t.setting},`,
    `at ${t.time_of_day}, lit by ${t.light}, ${t.motion}, in ${t.palette};`,
    `the account is ${plan.account_age_days} days old, so the surface is ${t.patina}.`,
    plan.buyer_steer
      ? `The buyer's steer, honoured in the surroundings only: ${plan.buyer_steer}`
      : 'The buyer gave no steer, so the block decides the whole piece.',
  ].join(' ');
}

// ── HTTP helpers ─────────────────────────────────

async function httpJson(url: string, init: RequestInit = {}, timeout = HTTP_TIMEOUT): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const err: any = new Error(`${init.method || 'GET'} ${url} failed (${resp.status}): ${text.slice(0, 200)}`);
      err.status = resp.status;
      throw err;
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

function rpcPost(endpoint: string, path: string, body: unknown): Promise<any> {
  return httpJson(`${endpoint}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Hyperion is rate-limited; back off rather than failing the run. */
async function hyperion(url: string, attempts = 3): Promise<any> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await httpJson(url);
    } catch (e: any) {
      if (e?.status !== 429 || i === attempts - 1) throw e;
      await new Promise(r => setTimeout(r, 2 ** i * 3000));
    }
  }
  throw new Error('unreachable');
}

/** Accept a bare host or a full /v2/history base for HYPERION_URL. */
function hyperionBase(raw: string): string {
  const trimmed = raw.replace(/\/+$/, '');
  return /\/v2\/history$/.test(trimmed) ? trimmed : `${trimmed}/v2/history`;
}

// ── Chain reads ──────────────────────────────────

interface ChainJob {
  id: number;
  client: string;
  agent: string;
  description: string;
  state: number;
  job_hash: string;
  [k: string]: unknown;
}

async function getJob(rpc: string, jobId: number): Promise<ChainJob | null> {
  const res = await rpcPost(rpc, '/v1/chain/get_table_rows', {
    json: true, code: ESCROW, scope: ESCROW, table: 'jobs',
    lower_bound: jobId, upper_bound: jobId, limit: 1,
  });
  return (res.rows && res.rows[0]) || null;
}

/** The block the buyer's payment confirmed in — the seed for the whole piece. */
async function fundingBlock(hypBase: string, job: ChainJob, svc: string): Promise<number | null> {
  const url = `${hypBase}/get_actions?account=${ESCROW}&filter=eosio.token:transfer&limit=100&sort=desc`;
  const actions = (await hyperion(url)).actions || [];
  for (const a of actions) {
    const d = (a?.act?.data || {}) as Record<string, unknown>;
    if (d.from === job.client && String(d.memo ?? '').startsWith(`buy:${svc}`)) return a.block_num;
  }
  return null;
}

/** Who the buyer is, per the chain itself — never a handle they typed. */
async function buyerIdentity(rpc: string, account: string): Promise<BuyerIdentity> {
  try {
    const res = await rpcPost(rpc, '/v1/chain/get_table_rows', {
      json: true, code: 'eosio.proton', scope: 'eosio.proton', table: 'usersinfo',
      lower_bound: account, upper_bound: account, limit: 1,
    });
    const row = res.rows && res.rows[0];
    const name = row ? String(row.name || '').trim() : '';
    return { account, display_name: name || null, verified: row ? Boolean(row.verified) : false };
  } catch {
    return { account, display_name: null, verified: false };
  }
}

/**
 * Notes the client attached to any revise action, oldest first.
 *
 * These live in action history, not in the jobmsgs table, so a job that has been
 * sent back looks identical on chain to one never delivered. Ignoring them means
 * re-rendering the same thing and being sent back again.
 */
async function revisionNotes(hypBase: string, jobId: number): Promise<string[]> {
  try {
    const url = `${hypBase}/get_actions?account=${ESCROW}&filter=${ESCROW}:revise&limit=100&sort=desc`;
    const actions = (await hyperion(url)).actions || [];
    const out: string[] = [];
    for (const a of actions) {
      const d = (a?.act?.data || {}) as Record<string, unknown>;
      if (String(d.job_id) === String(jobId)) out.push(String(d.notes ?? ''));
    }
    return out.reverse().filter(n => n);
  } catch {
    return [];
  }
}

/**
 * What the buyer asked for, from the input form first, notes second.
 *
 * The site sends form answers as a JSON message on the job thread in the same
 * transaction as payment; the memo-notes path is the fallback for a buyer who
 * transferred by hand. Revision notes are appended so a re-render answers the
 * complaint instead of repeating it.
 */
async function buyerSteer(rpc: string, hypBase: string, job: ChainJob): Promise<string> {
  const parts: string[] = [];
  try {
    const res = await rpcPost(rpc, '/v1/chain/get_table_rows', {
      json: true, code: ESCROW, scope: ESCROW, table: 'jobmsgs',
      index_position: 2, key_type: 'i64',
      lower_bound: job.id, upper_bound: job.id, limit: 30,
    });
    for (const m of res.rows || []) {
      if (m.author !== job.client) continue;
      let ans: any;
      try { ans = JSON.parse(m.text); } catch { continue; }
      if (!ans || typeof ans !== 'object' || Array.isArray(ans)) continue;
      const mood = String(ans.mood ?? '').trim();
      if (mood && !mood.toLowerCase().includes('let the block decide')) parts.push(`mood: ${mood}`);
      const use = String(ans.intended_use ?? '').trim();
      if (use && use !== 'not sure yet') parts.push(`intended use: ${use}`);
      const notes = String(ans.notes ?? '').trim();
      if (notes) parts.push(`the buyer's theme: ${notes}`);
    }
  } catch { /* fall through to the memo-notes path */ }

  if (parts.length === 0) {
    const m = /Buyer notes:\s*([\s\S]+)/.exec(job.description || '');
    if (m) parts.push(m[1].trim());
  }

  const seen = new Set<string>();
  for (const n of await revisionNotes(hypBase, job.id)) {
    const key = n.trim().replace(/\.+$/, '').toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      parts.push(`the buyer rejected the last attempt, saying: ${n.trim()}`);
    }
  }
  return parts.join('; ').slice(0, 600);
}

// ── Plan persistence ─────────────────────────────
// The seed is immutable once established: a re-render after a revision must use
// the same block, or the piece no longer matches the block the buyer was told it
// came from. Reusing it also means a rate-limited history API cannot block a
// retry.

function workDir(): string {
  return path.resolve(process.env.BLOCKART_WORK_DIR || DEFAULT_WORK_DIR);
}

export function planPath(dir: string, jobId: number): string {
  return path.join(dir, `job${jobId}.json`);
}

export function readPlan(dir: string, jobId: number): BlockArtPlan | null {
  try {
    const raw = fs.readFileSync(planPath(dir, jobId), 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as BlockArtPlan) : null;
  } catch {
    return null;
  }
}

export function writePlan(dir: string, plan: BlockArtPlan): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = planPath(dir, plan.job_id);
  // The persisted plan IS the traits.json that gets pinned alongside the image.
  fs.writeFileSync(file, JSON.stringify(plan, null, 2));
  return file;
}

// ── Render ───────────────────────────────────────

/**
 * Replicate, with the XPR glyph as the reference image so the atom's geometry
 * comes from the emblem rather than from the model's imagination.
 */
async function renderImage(token: string, prompt: string): Promise<string> {
  const create = await httpJson(
    `https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' },
      body: JSON.stringify({
        input: {
          prompt,
          image_input: [GLYPH],
          aspect_ratio: '1:1',
          resolution: '2K',
          output_format: 'png',
        },
      }),
    },
    120000,
  );

  let result: any = create;
  const deadline = Date.now() + RENDER_DEADLINE_MS;
  while (result.status !== 'succeeded' && result.status !== 'failed' && result.status !== 'canceled') {
    if (Date.now() > deadline) throw new Error('render timed out after 5 minutes');
    await new Promise(r => setTimeout(r, 2000));
    result = await httpJson(result.urls?.get || `https://api.replicate.com/v1/predictions/${result.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  if (result.status !== 'succeeded') throw new Error(`render ${result.status}: ${result.error || 'no detail'}`);

  const output = result.output;
  const url = Array.isArray(output) ? output[0] : output;
  if (!url) throw new Error('render succeeded but returned no image url');
  return String(url);
}

async function download(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const resp = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!resp.ok) throw new Error(`download failed (${resp.status})`);
    const bytes = await resp.arrayBuffer();
    if (bytes.byteLength > MAX_DOWNLOAD_SIZE) throw new Error(`rendered image too large (${bytes.byteLength} bytes)`);
    return Buffer.from(bytes);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pin the image and its traits as one directory, so both live under one CID and
 * traits.json sits beside the piece it explains.
 */
async function pinDirectory(jwt: string, png: Buffer, traitsJson: string, name: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'ba/blockart.png');
  form.append('file', new Blob([traitsJson], { type: 'application/json' }), 'ba/traits.json');
  form.append('pinataOptions', JSON.stringify({ wrapWithDirectory: false }));
  form.append('pinataMetadata', JSON.stringify({ name }));

  const data = await httpJson(
    'https://api.pinata.cloud/pinning/pinFileToIPFS',
    { method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: form },
    120000,
  );
  if (!data?.IpfsHash) throw new Error('Pinata returned no IpfsHash');
  return String(data.IpfsHash);
}

// ── Skill entry point ────────────────────────────

export default function blockartSkill(api: SkillApi): void {
  const config = api.getConfig();
  const rpcEndpoint =
    ((config.rpcEndpoint as string) || process.env.XPR_RPC_ENDPOINT || DEFAULT_RPC).replace(/\/+$/, '');
  const hypBase = hyperionBase(process.env.HYPERION_URL || DEFAULT_HYPERION);

  // ── blockart_plan ──
  api.registerTool({
    name: 'blockart_plan',
    description: [
      'Plan a Block Art piece for a funded job (job_hash "svc:<id>"). Reads the job from chain,',
      'recovers the block the buyer\'s payment confirmed in, derives every trait from that block,',
      'reads the buyer\'s form answers and any revision notes, and builds the generation prompt.',
      'Returns the full plan plus a one-paragraph summary, and persists the plan so a re-render',
      'after a revision reuses the same seed block. Read-only: it never spends and never signs.',
      'Call this before blockart_render.',
    ].join(' '),
    parameters: {
      type: 'object',
      required: ['job_id'],
      properties: {
        job_id: { type: 'number', description: 'Escrow job ID of the Block Art purchase' },
      },
    },
    handler: async ({ job_id }: { job_id: number }) => {
      if (!Number.isInteger(job_id) || job_id < 0) return { error: 'job_id must be a non-negative integer' };
      try {
        const job = await getJob(rpcEndpoint, job_id);
        if (!job) return { error: `job ${job_id} not found` };

        const match = /^svc:(\d+)$/.exec(String(job.job_hash || ''));
        if (!match) {
          return {
            error: `job ${job_id} has job_hash "${job.job_hash}" — Block Art only fulfils service purchases (job_hash "svc:<id>")`,
          };
        }
        const svc = match[1];

        const me = process.env.XPR_ACCOUNT;
        if (me && job.agent !== me) {
          return { error: `job ${job_id} is assigned to "${job.agent}", not "${me}"` };
        }

        const dir = workDir();
        const prior = readPlan(dir, job_id);
        const reusedSeed = Boolean(prior?.seed_block);
        const seedBlock = reusedSeed ? Number(prior!.seed_block) : await fundingBlock(hypBase, job, svc);
        if (!seedBlock) {
          return {
            error: `could not find the funding transfer for job ${job_id} (an "eosio.token:transfer" from ${job.client} with memo "buy:${svc}...") in the last 100 escrow transfers`,
          };
        }

        const block = await rpcPost(rpcEndpoint, '/v1/chain/get_block', { block_num_or_id: seedBlock });
        const account = await rpcPost(rpcEndpoint, '/v1/chain/get_account', { account_name: job.client });
        const ageDays = accountAgeDays(String(account.created));
        const traits = deriveTraits(String(block.id), String(block.timestamp), ageDays);
        const steer = await buyerSteer(rpcEndpoint, hypBase, job);

        const plan: BlockArtPlan = {
          job_id,
          service: String(job.job_hash),
          client: String(job.client),
          buyer: await buyerIdentity(rpcEndpoint, String(job.client)),
          seed_block: seedBlock,
          block_id: String(block.id),
          block_time: String(block.timestamp),
          producer: String(block.producer),
          buyer_steer: steer,
          traits,
          account_age_days: ageDays,
          prompt: buildPrompt(traits, steer),
          how_to_verify: HOW_TO_VERIFY,
        };

        const file = writePlan(dir, plan);
        return {
          success: true,
          plan,
          summary: planSummary(plan, reusedSeed),
          reused_seed_block: reusedSeed,
          job_state: job.state,
          plan_file: file,
          instruction: [
            'Read the summary. If the buyer asked for something the Block Art listing does not offer,',
            'ask ONE question with xpr_ask_client before rendering. Otherwise call blockart_render',
            'with the same job_id.',
          ].join(' '),
        };
      } catch (e: any) {
        return { error: `blockart_plan failed: ${e?.message || String(e)}` };
      }
    },
  });

  // ── blockart_render ──
  api.registerTool({
    name: 'blockart_render',
    description: [
      'Render the planned Block Art piece and pin it to IPFS with its traits.json, under one CID.',
      'Requires a plan from blockart_plan for the same job_id (it reuses that plan\'s seed block,',
      'so a re-render after a revision still matches the block the buyer was told it came from).',
      'Requires REPLICATE_API_TOKEN and PINATA_JWT.',
      'Returns a ready-to-use delivery manifest — this tool never signs and never delivers:',
      'pass the returned evidence_uri to xpr_deliver_job to complete the delivery.',
    ].join(' '),
    parameters: {
      type: 'object',
      required: ['job_id'],
      properties: {
        job_id: { type: 'number', description: 'Escrow job ID previously passed to blockart_plan' },
      },
    },
    handler: async ({ job_id }: { job_id: number }) => {
      if (!Number.isInteger(job_id) || job_id < 0) return { error: 'job_id must be a non-negative integer' };

      const replicateToken = process.env.REPLICATE_API_TOKEN;
      if (!replicateToken) return { error: 'REPLICATE_API_TOKEN is not set — Block Art cannot render without it' };
      const pinataJwt = process.env.PINATA_JWT;
      if (!pinataJwt) return { error: 'PINATA_JWT is not set — Block Art cannot pin the piece without it' };
      const gateway = (process.env.PINATA_GATEWAY || DEFAULT_GATEWAY).replace(/\/+$/, '');

      const dir = workDir();
      const plan = readPlan(dir, job_id);
      if (!plan) return { error: `no Block Art plan found for job ${job_id} — call blockart_plan first` };
      if (!plan.prompt || !plan.block_id) return { error: `the stored plan for job ${job_id} is incomplete — re-run blockart_plan` };

      try {
        const imageUrl = await renderImage(replicateToken, plan.prompt);
        const png = await download(imageUrl);

        // Keep the rendered piece beside its plan so a failed pin can be retried
        // without paying for a second render.
        fs.mkdirSync(dir, { recursive: true });
        const pngPath = path.join(dir, `job${job_id}.png`);
        fs.writeFileSync(pngPath, png);

        const traitsJson = JSON.stringify(plan, null, 2);
        const cid = await pinDirectory(pinataJwt, png, traitsJson, `blockart-job${job_id}`);
        const base = `${gateway}/ipfs/${cid}`;
        const manifest = buildManifest(plan, base);

        return {
          success: true,
          evidence_uri: manifest,
          cid,
          image_url: `${base}/blockart.png`,
          traits_url: `${base}/traits.json`,
          bytes: png.length,
          seed_block: plan.seed_block,
          traits: plan.traits,
          local_png: pngPath,
          instruction:
            'Rendered and pinned. Now call xpr_deliver_job with evidence_uri set to the manifest string above, exactly as returned.',
        };
      } catch (e: any) {
        return { error: `blockart_render failed: ${e?.message || String(e)}` };
      }
    },
  });
}

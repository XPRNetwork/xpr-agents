import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { Key } from '@proton/js';
import { signA2ARequest, hashBody } from '../../../../sdk/src/eosio-auth';
import { verifyA2ARequest, clearAuthCaches } from '../src/a2a-auth';
import { isReadonlyToolName } from '../src/a2a-tools';

const { rpc } = vi.hoisted(() => ({ rpc: { get_info: vi.fn(), get_account: vi.fn(), get_table_rows: vi.fn() } }));
vi.mock('@proton/js', async () => ({
  ...await vi.importActual<any>('@proton/js'),
  JsonRpc: class { get_info = rpc.get_info; get_account = rpc.get_account; get_table_rows = rpc.get_table_rows; },
}));
vi.mock('@xpr-agents/sdk', async () => await import('../../../../sdk/src/eosio-auth'));
const WIF = '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3'; // public EOSIO development fixture
const publicKey = Key.PrivateKey.fromString(WIF).getPublicKey().toString();
const chain = 'a'.repeat(64);
const config = { rpcEndpoint: 'https://rpc.invalid', authRequired: true, minTrustScore: 0, minKycLevel: 0,
  rateLimit: 100, timestampWindow: 300, agentcoreContract: 'agentcore', selfAccount: 'testagent', requireRegistered: true };
function permission(threshold = 1) {
  return { permissions: [{ perm_name: 'a2a', required_auth: { threshold, keys: [{ key: publicKey, weight: 1 }] } }] };
}
function headers(body: string, audience = 'testagent', chainId = chain) {
  const timestamp = Math.floor(Date.now() / 1000);
  return { 'x-xpr-account': 'caller', 'x-xpr-timestamp': String(timestamp),
    'x-xpr-signature': signA2ARequest(WIF, 'caller', timestamp, hashBody(body), audience, chainId) };
}
beforeEach(() => {
  clearAuthCaches();
  rpc.get_info.mockReset().mockResolvedValue({ chain_id: chain });
  rpc.get_account.mockReset().mockResolvedValue(permission());
  rpc.get_table_rows.mockReset().mockImplementation(async (q: any) => ({ rows: q.table === 'agents' ? [{ account: 'caller', active: 1 }] : [] }));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected network attempt'); }));
});
afterEach(() => { vi.unstubAllGlobals(); clearAuthCaches(); });

// Execute the whole unchanged entrypoint with captured Express routes and mocked
// imports. No sockets, timers, startup registration, subprocesses or filesystem writes.
// This exercises real runAgent dispatch rather than a copied filter implementation.
function runnerHarness() {
  const routes = new Map<string, any>();
  const write = vi.fn(async () => ({ ok: true }));
  const read = vi.fn(async () => ({ ok: true }));
  const writes = ['xpr_accept_job', 'xpr_submit_bid', 'xpr_list_service', 'nft_list_for_sale',
    'nft_transfer', 'nft_claim_auction', 'defi_create_otc', 'loan_supply', 'gov_vote', 'xmd_mint', 'msig_approve'];
  const tools = [...writes.map(name => ({ name, handler: write })), { name: 'xpr_get_job', handler: read }]
    .map(t => ({ ...t, description: t.name, parameters: { type: 'object', properties: {} } }));
  const complete = vi.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] });
  const app: any = { set() {}, use() {}, get: (p: string, h: any) => routes.set(`GET ${p}`, h),
    post: (p: string, h: any) => routes.set(`POST ${p}`, h), listen: () => ({ close() {} }) };
  const express = Object.assign(() => app, { json: () => () => {} });
  const auth = vi.fn().mockResolvedValue({ account: 'caller' });
  const imports: Record<string, any> = {
    express, fs: { readFileSync: () => { throw new Error('No fixture'); } }, path,
    './llm': { createLlmClientFromEnv: () => ({ complete, model: 'fixture' }) },
    './a2a-auth': { verifyA2ARequest: auth, A2AAuthError: class extends Error {} },
    './a2a-tools': { isReadonlyToolName },
    './security': { scanInbound: (text: string) => ({ action: 'allow', text, flagged: [] }),
      scanOutput: () => ({ action: 'allow', flagged: [] }), loadSecurityConfig: () => ({}), getSecurityStats: () => ({}) },
    './skill-loader': { loadBuiltinSkill: () => null, loadSkills: () => ({ skills: [], capabilities: [], promptSections: [] }) },
    './token-budget': { MAX_TOKENS_PER_RUN: 100000, MAX_TOKENS_PER_DAY: 1000000,
      dailyTokenBudgetExhausted: () => false, recordTokenUsage: () => 0 },
    './scan-guard': {}, './timeouts': {}, './llm-errors': {},
    '@xpr-agents/openclaw': { default: (api: any) => tools.forEach(t => api.registerTool(t)),
      checkProtonCli: async () => true, checkKeychainPopulated: async () => true },
  };
  const requireMock: any = (name: string) => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  };
  requireMock.resolve = () => '/fixture/openclaw/package.json';
  const source = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(js, { require: requireMock, exports: {}, __dirname: '/fixture/agent/src',
    process: { env: { XPR_ACCOUNT: 'testagent', XPR_RPC_ENDPOINT: 'https://rpc.invalid', OPENCLAW_HOOK_TOKEN: 'fixture-secret',
      A2A_TOOL_MODE: 'readonly', POLL_ENABLED: 'false' }, on() {}, exit() { throw new Error('Unexpected exit'); } },
    console: { log() {}, warn() {}, error() {} }, setInterval: () => ({ unref() {} }),
    setTimeout: () => { throw new Error('Unexpected timer'); }, clearTimeout() {}, Buffer, URL,
  }, { filename: 'review-runner.cjs' });
  async function request(route: string, authorization?: string, body: any = {}) {
    const response: any = { statusCode: 200, status(n: number) { this.statusCode = n; return this; },
      json(value: any) { this.body = value; return this; } };
    await routes.get(route)({ headers: { authorization }, body, rawBody: JSON.stringify(body), params: { jobId: '1' } }, response);
    return response;
  }
  return { request, complete, read, write, writes, auth };
}

describe('runner access control (October 2026 review)', () => {
  it('P5: actual webhook/run/deliverable routes reject missing or incorrect tokens', async () => {
    const runner = runnerHarness();
    for (const route of ['POST /hooks/agent', 'POST /run', 'GET /deliverables/:jobId']) {
      for (const token of [undefined, '', 'Bearer wrong', 'Bearer fixture-secret-suffix', 'Bearer true']) {
        expect((await runner.request(route, token, { prompt: 'hello', event_type: 'test' })).statusCode).toBe(401);
      }
    }
    expect(runner.complete).not.toHaveBeenCalled();
    expect((await runner.request('POST /run', 'Bearer fixture-secret', { prompt: 'hello' })).body.ok).toBe(true);
    expect(runner.complete).toHaveBeenCalledTimes(1);
  });

  it('P5: actual readonly A2A dispatch rejects write names and variations, including skill tools', async () => {
    const runner = runnerHarness();
    const names = runner.writes.flatMap(n => [n, `${n}.`, n.toUpperCase(), `${n} `]);
    runner.complete.mockResolvedValueOnce({ stop_reason: 'tool_use', content: names.map((name, i) => ({ type: 'tool_use', id: String(i), name, input: { confirmed: true } })) });
    await runner.request('POST /a2a', undefined, { jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { parts: [{ type: 'text', text: 'test' }] } } });
    expect(runner.auth).toHaveBeenCalledTimes(1);
    expect(runner.complete).toHaveBeenCalledTimes(2);
    expect(runner.write).not.toHaveBeenCalled();
    expect(runner.complete.mock.calls[0][0].tools.map((t: any) => t.name)).toEqual(['xpr_get_job']);
  });

  it('P5: valid isolated-key signature works once; identical and alternate timestamp spelling replays fail', async () => {
    const body = '{"jsonrpc":"2.0","id":1}';
    const h = headers(body);
    await expect(verifyA2ARequest(h, body, config)).resolves.toMatchObject({ account: 'caller' });
    await expect(verifyA2ARequest(h, body, config)).rejects.toThrow(/Replay/);
    await expect(verifyA2ARequest({ ...h, 'x-xpr-timestamp': `${h['x-xpr-timestamp']}junk` }, body, config)).rejects.toThrow(/Replay/);
  });

  it('P5: rejects missing/invalid signatures, body tampering, wrong audience and wrong chain', async () => {
    const body = '{}';
    for (const h of [{}, { ...headers(body), 'x-xpr-signature': 'invalid' }, headers('different'), headers(body, 'otheragent'), headers(body, 'testagent', 'b'.repeat(64))]) {
      await expect(verifyA2ARequest(h, body, config)).rejects.toThrow();
    }
  });

  it('P5: rejects a valid signature below authority threshold and an inactive/unregistered caller', async () => {
    const body = '{}';
    rpc.get_account.mockResolvedValue(permission(2));
    await expect(verifyA2ARequest(headers(body), body, config)).rejects.toThrow(/threshold/);
    clearAuthCaches();
    rpc.get_account.mockResolvedValue(permission());
    rpc.get_table_rows.mockResolvedValue({ rows: [] });
    await expect(verifyA2ARequest(headers(body), body, config)).rejects.toThrow(/not a registered agent/);
    clearAuthCaches();
    rpc.get_table_rows.mockResolvedValue({ rows: [{ active: 0 }] });
    await expect(verifyA2ARequest(headers(body), body, config)).rejects.toThrow(/not active/);
  });
});

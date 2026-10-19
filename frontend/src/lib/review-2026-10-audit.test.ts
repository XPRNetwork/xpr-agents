// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import * as registry from './registry';
import { parseXprAmount, formatXprAsset } from './xpr-amount';
import { indexerFetch } from './indexer';
import * as networks from './networks';

vi.mock('./indexer', () => ({ indexerFetch: vi.fn() }));
vi.mock('./networks', async importOriginal => {
  const actual = await importOriginal<typeof import('./networks')>();
  return { ...actual, getSelectedNetwork: () => 'mainnet', getNetworkConfig: () => actual.NETWORKS.mainnet };
});
const src = resolve(process.cwd(), 'src');
const repo = resolve(process.cwd(), '..');
const nativeRequire = createRequire(resolve(process.cwd(), 'package.json'));
const read = (p: string) => readFileSync(resolve(src, p), 'utf8');
// Contract ABIs are build outputs (contracts' `npm run build`). CI builds and supplies them, so
// only a local run without built contracts skips these checks.
const haveAbis = !!process.env.CI || [
  'contracts/agentescrow/assembly/target/agentescrow.contract.abi',
  'contracts/agentcore/node_modules/proton-tsc/external/eosio.token/eosio.token.abi',
].every(p => existsSync(resolve(repo, p)));
function ast(p: string) { return ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function nodes(root: ts.Node, predicate: (n: ts.Node) => boolean): ts.Node[] {
  const out: ts.Node[] = [];
  function visit(n: ts.Node) { if (predicate(n)) out.push(n); ts.forEachChild(n, visit); }
  visit(root); return out;
}
function expression(text: string, scope: Record<string, unknown> = {}) {
  return runInNewContext(`(${text})`, { parseXprAmount, formatXprAsset, ...scope }, { timeout: 1000 });
}
function initializer(p: string, name: string, contains = ''): string {
  const file = ast(p);
  const matches = nodes(file, n => ts.isVariableDeclaration(n) && n.name.getText(file) === name && !!n.initializer && n.initializer.getText(file).includes(contains)) as ts.VariableDeclaration[];
  expect(matches, `${p}: unique initializer for ${name} / ${contains}`).toHaveLength(1);
  return matches[0].initializer!.getText(file);
}

// Compile the unchanged TSX with its real React runtime. Resolve @/ locally because
// this package has no Vitest alias config; replace only network/wallet/bulky children.
function component(p: string, overrides: Record<string, unknown> = {}) {
  const cache = new Map<string, any>();
  const stubs: Record<string, any> = {
    '@/lib/registry': registry,
    '@/lib/networks': networks,
    'next/link': { __esModule: true, default: ({ children, ...props }: any) => React.createElement('a', props, children) },
    'next/router': { useRouter: () => ({ query: {}, push: vi.fn() }) },
    '@/hooks/useProton': { useProton: () => ({ session: null, transact: vi.fn(() => { throw Error('no signing'); }), login: vi.fn() }) },
    '@/hooks/useChainStream': { useChainStream: () => ({ lastEvent: null }) },
    '@/contexts/ToastContext': { useToast: () => ({ addToast: vi.fn() }) },
    '@/components/ModelGallery': { ModelGallery: () => null },
    '@/components/DeliveryHistory': { __esModule: true, default: () => null },
    '@/components/UsdValue': { UsdValue: () => null },
    ...overrides,
  };
  function load(file: string): any {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    }}).outputText;
    const req = (id: string) => {
      if (id in stubs) return stubs[id];
      if (id.startsWith('@/') || id.startsWith('.')) {
        const base = id.startsWith('@/') ? resolve(src, id.slice(2)) : resolve(dirname(file), id);
        const alias = '@/' + relative(src, base);
        if (alias in stubs) return stubs[alias];
        const candidate = [base + '.tsx', base + '.ts'].find(f => { try { readFileSync(f); return true; } catch { return false; } });
        if (!candidate) throw Error(`Cannot resolve ${id}`);
        return load(candidate);
      }
      return nativeRequire(id);
    };
    // Only checked-in source is executed here, never on-chain text.
    new Function('require', 'module', 'exports', js)(req, mod, mod.exports);
    return mod.exports;
  }
  return load(resolve(src, p));
}
const emptyTable = { more: false, next_key: '', next_key_bytes: '' };
let roots: Root[] = [];
beforeEach(() => {
  vi.mocked(indexerFetch).mockResolvedValue(null);
  vi.spyOn(registry.rpc, 'get_table_rows').mockResolvedValue({ ...emptyTable, rows: [], more: false });
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(Error('Network forbidden in review'))));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount());
  roots = []; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function mount(el: React.ReactElement) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => { root.render(el); });
  return host;
}
const agentRow = { account: 'alice', name: 'Alice', owner: '', description: 'Agent', endpoint: '', protocol: '', capabilities: '[]', total_jobs: 0, registered_at: 1, active: 1 };
const jobRow = { id: 1, client: 'alice', agent: 'bob', title: 'Job', description: 'Brief', deliverables: '[]', amount: 10000, funded_amount: 10000, symbol: 'XPR', state: 6, deadline: 2000000000, created_at: 1, updated_at: 1, arbitrator: '', job_hash: '' };

describe('review findings', () => {
  it('P2 preserves all four decimal places in job, bid and unstake amounts', () => {
    const cases = [
      ['pages/jobs/index.tsx', 'form.amount', { form: { amount: '1.0009' } }],
      ['components/JobDetail.tsx', 'bidAmount', { bidAmount: '1.0009' }],
      ['pages/validators.tsx', 'unstakeAmount', { unstakeAmount: '1.0009' }],
    ] as const;
    for (const [file, input, scope] of cases) {
      const amount = expression(initializer(file, 'amount', input), scope);
      const site = actions.find(a => a.file === file && ["'createjob'", "'submitbid'", "'unstake'"].includes(a.name))!;
      const data = expression(site.data, { ...actionScope(file), amount });
      expect.soft(data.amount, `${file}: 1.0009 XPR = 10009 raw units`).toBe(10009);
    }
  });

  it('P4 renders agent cards for valid non-array capabilities JSON', async () => {
    const { AgentCard } = component('components/AgentCard.tsx');
    for (const capabilities of ['null', '"hello"', '[{"unexpected":true}]']) {
      vi.mocked(registry.rpc.get_table_rows).mockResolvedValue({ ...emptyTable, rows: [{ ...agentRow, capabilities }] });
      const agent = await registry.getAgent('alice');
      expect.soft(() => renderToStaticMarkup(React.createElement(AgentCard, { agent })), capabilities).not.toThrow();
      vi.mocked(indexerFetch).mockResolvedValue({ agents: [{ ...agentRow, capabilities }], total: 1 });
      const page = await registry.getAgentsPage();
      expect.soft(() => renderToStaticMarkup(React.createElement(AgentCard, { agent: page!.entries[0].agent })), `indexer: ${capabilities}`).not.toThrow();
    }
  });

  it('P4 renders job details for valid non-array deliverables JSON', async () => {
    const { JobDetail } = component('components/JobDetail.tsx');
    for (const deliverables of ['null', '"report"', '[{"unexpected":true}]']) {
      vi.mocked(registry.rpc.get_table_rows).mockResolvedValue({ ...emptyTable, rows: [{ ...jobRow, deliverables }] });
      const job = await registry.getJob(1);
      expect.soft(() => renderToStaticMarkup(React.createElement(JobDetail, { job })), deliverables).not.toThrow();
    }
  });


});

// Extract every action literal, including ternary names and spread/shared data.
// Fixture values supply component state; expressions and field names come from source.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? sourceFiles(resolve(dir, e.name)) : /\.tsx?$/.test(e.name) && !e.name.includes('.test.') ? [relative(src, resolve(dir, e.name))] : []);
}
type ActionSite = { file: string; line: number; account: string; name: string; data: string };
const actions = sourceFiles(src).flatMap(file => {
  const tree = ast(file);
  return (nodes(tree, ts.isObjectLiteralExpression) as ts.ObjectLiteralExpression[]).flatMap(n => {
    const props = Object.fromEntries(n.properties.filter(ts.isPropertyAssignment).map(p => [p.name.getText(tree), p.initializer.getText(tree)]));
    return props.account && props.name && props.data ? [{ file, line: tree.getLineAndCharacterOfPosition(n.getStart()).line + 1, account: props.account, name: props.name, data: props.data } satisfies ActionSite] : [];
  });
});
function actionScope(file: string, alternate = false): Record<string, any> {
  const scope: Record<string, any> = {
    CONTRACTS: registry.CONTRACTS, session: { auth: { actor: 'alice' } }, job: { id: 1 }, bid: { id: 2 }, bidId: 2,
    text: 'message', amountStr: '1.0000 XPR', reviseNotes: 'revision', disputeReason: 'reason', disputeEvidence: '',
    activeDispute: { id: 1 }, resolvePercent: 50, resolveNotes: 'resolved', ratingAgent: 'bob', ratingScore: 5, ratingTags: 'good', ratingJobId: 1,
    amount: 10000, timelineSeconds: 86400, bidProposal: 'proposal', feedbackFee: 10000, data: { agent: 'bob', score: 5, tags: ['good'] }, feedbackId: 1, reason: 'reason', evidenceUri: '',
    percentToBps: (v: string) => Math.round(Number(v) * 100), regFee: '1', newFee: '1', minStakeStr: '5000.0000 XPR', qty: '1.0000 XPR',
    myArbitrator: { stake: 50000000, active: !alternate }, dispute: { id: 1 }, clientPercent: 50, resolutionNotes: 'resolved',
    stakeAmount: '1', unstakeAmount: '1', agent: file === 'pages/dashboard.tsx' ? { active: true } : 'bob',
    editName: 'Alice', editDescription: 'description', editEndpoint: '', editProtocol: '', capsArray: [], owing: 50000,
    editingService: { id: 1 }, schemaString: '', newest: { id: 1 }, raw: 10000, boostService: { id: 1 }, relist: alternate, service: { id: 1 }, plugin: { id: 1 },
    serviceForm: { title: 'Service', description: 'Description', category: 'other', sampleUri: '' }, price: 10000, turnaround: 86400,
    form: { title: 'Job', description: 'Brief', arbitrator: '' }, deliverables: '[]', deadlineSeconds: 2000000000,
    registrationFee: 10000, name: 'Alice', description: 'Agent', endpoint: '', protocol: '', capabilities: [], claimDeposit: 10000, agentAccount: 'bob',
    quantity: '1.0000 XPR', packedInput: '{}', regMethod: 'manual', specsArray: [], unstakeId: 1,
    myValidator: { active: true }, updateMethod: 'manual', config: { validation_fee: 10000 }, jobHash: 'job1', valResult: 1, valConfidence: '90', valEvidence: '',
    challengeValidation: { id: 1 }, challengeReason: 'reason', challengeEvidence: '', stakeStr: '1.0000 XPR', myChallenge: { id: 1 },
  };
  if (file === 'pages/dashboard.tsx') scope.shared = expression(initializer(file, 'shared'), scope);
  if (file === 'pages/arbitrators.tsx') scope.action = expression(initializer(file, 'action'), scope);
  if (file === 'pages/services/[id].tsx') {
    scope.service.price = 10000;
    scope.inputSchema = alternate ? { fields: [] } : null;
    scope.buyNotes = 'line 1:\nline 2';
    scope.BUY_NOTES_MAX = expression(initializer(file, 'BUY_NOTES_MAX'));
    scope.cleanNotes = expression(initializer(file, 'cleanNotes'), scope);
    scope.buyMemo = expression(initializer(file, 'buyMemo'), scope);
    scope.priceStr = expression(initializer(file, 'priceStr'), scope);
  }
  return scope;
}
function builtActions() {
  return actions.flatMap(a => [false, true].map(alternate => {
    const scope = actionScope(a.file, alternate);
    return { ...a, account: expression(a.account, scope), name: expression(a.name, scope), data: expression(a.data, scope) };
  }));
}

describe('properties that hold', () => {
  it.skipIf(!haveAbis)('P1 compares every extracted project action name, data keys and representative value types to its built ABI', () => {
    expect(actions.length).toBe(59); // New action sites must be deliberately included in this inventory.
    for (const a of builtActions()) {
      if (a.account === 'eosio') continue; // System staking ABI is not in this repository.
      const abiPath = a.account === 'eosio.token'
        ? 'contracts/agentcore/node_modules/proton-tsc/external/eosio.token/eosio.token.abi'
        : `contracts/${a.account}/assembly/target/${a.account}.contract.abi`;
      const abi = JSON.parse(readFileSync(resolve(repo, abiPath), 'utf8'));
      const label = `${a.file}:${a.line} ${a.account}::${a.name}`;
      const action = abi.actions.find((x: any) => x.name === a.name);
      expect(action, label).toBeDefined();
      const fields = abi.structs.find((x: any) => x.name === action.type).fields;
      expect(Object.keys(a.data).sort(), label).toEqual(fields.map((f: any) => f.name).sort());
      for (const f of fields) {
        const v = a.data[f.name];
        if (f.type === 'string' || f.type === 'name') expect(typeof v, `${label}.${f.name}`).toBe('string');
        else if (f.type === 'asset') expect(v, `${label}.${f.name}`).toMatch(/^\d+\.\d{4} XPR$/);
        else if (f.type === 'bool') expect(typeof v, `${label}.${f.name}`).toBe('boolean');
        else if (/^uint\d+$/.test(f.type)) {
          expect(Number.isSafeInteger(v) && v >= 0, `${label}.${f.name}:${f.type}`).toBe(true);
          expect(BigInt(v) < (1n << BigInt(f.type.slice(4))), label).toBe(true);
        } else throw Error(`Unhandled ABI type: ${f.type}`);
      }
    }
  });

  it('P2 transfer fields, four-decimal quantities and memo shapes match the read contract handlers', () => {
    const memoPatterns: Record<string, RegExp> = {
      agentcore: /^(regfee:alice|claim:bob:alice)$/,
      agentfeed: /^feedfee:alice$/,
      agentvalid: /^(stake|valfee:alice|challenge:1)$/,
      agentescrow: /^(fund:1|arbstake|svcfee:alice|boost:1|buy:1(:line 1: line 2)?)$/,
    };
    for (const a of builtActions().filter(a => a.account === 'eosio.token')) {
      expect(Object.keys(a.data).sort()).toEqual(['from', 'memo', 'quantity', 'to']);
      expect(a.data.quantity).toMatch(/^\d+\.\d{4} XPR$/);
      expect(a.data.memo).toMatch(memoPatterns[a.data.to]);
    }
  });

  it('P3 filters unsafe manifest URLs and malformed entries', () => {
    const manifest = registry.manifestFromObject({ files: [null, { uri: 4 }, { uri: 'javascript:alert(1)' }, { uri: 'data:text/html,x' }, { uri: 'https://example.test/a.csv', name: '<img src=x onerror=alert(1)>' }] });
    expect(manifest?.files).toHaveLength(1);
    expect(manifest?.files[0].uri).toBe('https://example.test/a.csv');
  });

  it('P3 escapes CSV, JSON and filenames as text', () => {
    const attack = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    for (const [file, body] of [['CsvPreview', `column,other\n${attack},value`], ['JsonPreview', JSON.stringify({ [attack]: attack })]]) {
      const Comp = component(`components/${file}.tsx`, { '@/lib/use-remote-file': { useRemoteFile: () => ({ state: 'ready', text: body }) } }).default;
      const host = document.createElement('div');
      host.innerHTML = renderToStaticMarkup(React.createElement(Comp, { uri: 'https://example.test/file', name: attack }));
      expect(host.querySelector('img,script,[onerror]')).toBeNull();
      expect(host.textContent).toContain(attack);
    }
  });

  it('P3 renders normal agent/job data and escapes their untrusted prose', async () => {
    const attack = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    vi.mocked(registry.rpc.get_table_rows).mockResolvedValueOnce({ ...emptyTable, rows: [{ ...agentRow, description: attack, capabilities: '["coding"]' }] })
      .mockResolvedValueOnce({ ...emptyTable, rows: [{ ...jobRow, description: attack, deliverables: '["report"]' }] });
    const agent = await registry.getAgent('alice');
    const job = await registry.getJob(1);
    const { AgentCard } = component('components/AgentCard.tsx');
    const { JobDetail } = component('components/JobDetail.tsx');
    for (const el of [React.createElement(AgentCard, { agent }), React.createElement(JobDetail, { job })]) {
      const host = document.createElement('div'); host.innerHTML = renderToStaticMarkup(el);
      expect(host.querySelector('script,[onerror]')).toBeNull();
      expect(host.textContent).toContain(attack);
    }
  });

  it('P3 keeps avatar bytes in an image data URL', async () => {
    vi.mocked(registry.rpc.get_table_rows).mockResolvedValue({ ...emptyTable, rows: [{ avatar: '"><script>alert(1)</script>' }] });
    const { AccountAvatar } = component('components/AccountAvatar.tsx');
    const host = await mount(React.createElement(AccountAvatar, { account: 'avatarcheck' }));
    expect(host.querySelector('script,[onerror]')).toBeNull();
    expect(host.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,"><script>alert(1)</script>');
  });

  it('P4 returns empty lists and missing rows without crashing', async () => {
    expect(await registry.getAgent('missing')).toBeNull();
    expect(await registry.getJob(99)).toBeNull();
    expect(await registry.getAllJobs()).toEqual([]);
    expect(await registry.getServices()).toEqual([]);
  });

  it('P4 falls back to RPC after an indexer HTTP failure', async () => {
    const { indexerOrRpc } = await vi.importActual<typeof import('./indexer')>('./indexer');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const fallback = vi.fn(async () => []);
    expect(await indexerOrRpc('/jobs', data => data.jobs, fallback)).toEqual([]);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('P4 renders an indexer/RPC error state in the agent list', async () => {
    const { AgentList } = component('components/AgentList.tsx', { '@/lib/registry': { ...registry,
      getAgentsPage: async () => { throw Error('RPC unavailable'); }, getAgentLastActivity: async () => ({}),
    } });
    const host = await mount(React.createElement(AgentList));
    expect(host.textContent).toContain('RPC unavailable');
  });
});

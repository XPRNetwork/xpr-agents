import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Serialize } from '@proton/js';

// October 2026 signing-layer review (S1-S5): the transfer cap missed trailing-dot name
// aliases and RAM purchases, an explicit plugin cap did not reach skills, skills accepted
// non-boolean confirmations, and NFT delivery skipped the transfer confirmation gate.

// Exercise the real tool -> CLI session -> cap -> argv path, stopping only at execFile.
const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock('child_process', () => ({
  execFile: (...args: any[]) => {
    const cb = args.pop();
    Promise.resolve(execFileMock(...args)).then(r => cb(null, r), e => cb(e));
  },
}));
vi.mock('@xpr-agents/openclaw', async () => await import('../src/cli-session'));

import { createCliSession } from '../src/cli-session';
import plugin from '../src/index';
import defi from '../skills/defi/src/index';
import nft from '../skills/nft/src/index';
import lending from '../skills/lending/src/index';
import governance from '../skills/governance/src/index';
import xmd from '../skills/xmd/src/index';
import { registerEscrowTools } from '../src/tools/escrow';
import { needsConfirmation } from '../src/util/confirm';
import { resetTransferTracking } from '../src/util/validate';

function registry(register: any, config: any = {}) {
  const tools = new Map<string, any>();
  register({ registerTool: (t: any) => tools.set(t.name, t), getConfig: () => config });
  return tools;
}
const transfer = (quantity: string, contract = 'eosio.token') => ({
  account: contract, name: 'transfer', authorization: [{ actor: 'testagent', permission: 'active' }],
  data: { from: 'testagent', to: 'receiver', quantity, memo: '' },
});
const otc = (quantity: string, contract = 'eosio.token') => ({
  from_tokens: [{ quantity, contract }], to_tokens: [{ quantity: '1.000000 XUSDC', contract: 'xtokens' }],
  to: 'receiver', confirmed: true,
});
function signedActions() {
  return execFileMock.mock.calls.flatMap(([, args]: any) => JSON.parse(args[1]).actions);
}
function escrow() {
  const { session } = createCliSession({ account: 'testagent', maxTransferAmount: 100000 });
  const rpc = { get_table_rows: vi.fn().mockResolvedValue({ rows: [], more: false }) };
  const config = { rpc, session, contracts: { agentescrow: 'agentescrow' }, confirmHighRisk: true, maxTransferAmount: 100000 };
  return { tools: registry((api: any) => registerEscrowTools(api, config as any)), rpc };
}
beforeEach(() => {
  vi.stubEnv('XPR_ACCOUNT', 'testagent');
  vi.stubEnv('XPR_PERMISSION', 'active');
  vi.stubEnv('XPR_RPC_ENDPOINT', 'https://rpc.invalid');
  vi.stubEnv('MAX_TRANSFER_AMOUNT', '100000'); // 10 XPR
  vi.stubEnv('TRUSTED_ARBITRATORS', 'protonnz');
  execFileMock.mockReset().mockResolvedValue({ stdout: '{"transaction_id":"abc123","processed":{}}', stderr: '' });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected network attempt'); }));
  resetTransferTracking();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('signing limits and confirmations (regressions)', () => {
  it('P1: rejects an over-cap OTC transfer using the eosio.token. name alias', async () => {
    // Prove this is the same on-chain account, not a different token contract.
    const buffer = new Serialize.SerialBuffer();
    buffer.pushName('eosio.token.');
    expect(buffer.getName()).toBe('eosio.token');
    const result = await registry(defi).get('defi_create_otc').handler(otc('20.0000 XPR', 'eosio.token.'));
    expect(execFileMock, JSON.stringify(result)).not.toHaveBeenCalled();
  });

  it('P1: refuses the automatic 50 XPR RAM purchase when the cap is 10 XPR', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ram_quota: 1000, ram_usage: 1000 }) } as any);
    await registry(nft).get('nft_create_collection').handler({ collection_name: 'reviewcol', confirmed: true });
    expect(signedActions().filter((a: any) => a.name === 'buyram')).toEqual([]);
  });

  it('P1: keeps RAM plus NFT purchase within one call budget', async () => {
    vi.stubEnv('MAX_TRANSFER_AMOUNT', '1000000'); // 100 XPR
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ram_quota: 1000, ram_usage: 1000 }) } as any);
    await registry(nft).get('nft_purchase').handler({ sale_id: '1', price: '60.0000 XPR', confirmed: true });
    const spent = signedActions().reduce((sum: number, a: any) => sum +
      (a.account === 'eosio' && a.name === 'buyram' ? parseFloat(a.data.quant) :
        a.account === 'eosio.token' && a.name === 'transfer' ? parseFloat(a.data.quantity) : 0), 0);
    expect(spent).toBeLessThanOrEqual(100);
  });

  // get_account reports RAM; the XPR balance comes from get_currency_balance (core_liquid_balance
  // is not XPR on XPR Network, so it must not be trusted even if present)
  const lowRam = (xpr?: string) =>
    vi.mocked(fetch).mockImplementation(async (url: any) => ({ ok: true, json: async () =>
      String(url).includes('get_currency_balance') ? (xpr ? [xpr] : [])
        : { ram_quota: 1000, ram_usage: 1000, core_liquid_balance: '999999.0000 SYS' },
    }) as any);

  it('P1: a funded agent low on RAM gets one transaction with the RAM purchase first', async () => {
    vi.stubEnv('MAX_TRANSFER_AMOUNT', '10000000'); // 1,000 XPR
    lowRam('900.0000 XPR');
    await registry(nft).get('nft_create_collection').handler({ collection_name: 'reviewcol', confirmed: true });
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const actions = signedActions();
    expect(actions[0]).toMatchObject({ account: 'eosio', name: 'buyram', data: { payer: 'testagent', quant: '50.0000 XPR' } });
    expect(actions.length).toBeGreaterThan(1);
  });

  it('P1: the cap refuses a bundled RAM purchase that exceeds it, signing nothing', async () => {
    lowRam('900.0000 XPR'); // cap 10 XPR from beforeEach
    await registry(nft).get('nft_create_collection').handler({ collection_name: 'reviewcol', confirmed: true });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('P1: RAM plus an NFT purchase are capped together', async () => {
    vi.stubEnv('MAX_TRANSFER_AMOUNT', '1000000'); // 100 XPR
    lowRam('900.0000 XPR');
    await registry(nft).get('nft_purchase').handler({ sale_id: '1', price: '60.0000 XPR', confirmed: true });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('P1: without the XPR for a RAM top-up the operation runs without it', async () => {
    vi.stubEnv('MAX_TRANSFER_AMOUNT', '10000000');
    lowRam('3.0000 XPR');
    await registry(nft).get('nft_create_collection').handler({ collection_name: 'reviewcol', confirmed: true });
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(signedActions().some((a: any) => a.name === 'buyram')).toBe(false);
  });

  it('P2: NFT job delivery cannot bypass the NFT transfer confirmation gate', async () => {
    const { tools, rpc } = escrow(); // confirmHighRisk=true
    rpc.get_table_rows.mockResolvedValue({ rows: [{ id: '1', client: 'receiver', agent: 'testagent', state: 3, deliverables: '[]', arbitrator: '' }], more: false });
    // The direct skill transfer correctly refuses the same assets without confirmation.
    await registry(nft).get('nft_transfer').handler({ to: 'receiver', asset_ids: ['1'] });
    expect(execFileMock).not.toHaveBeenCalled();
    await tools.get('xpr_deliver_job_nft').handler({ job_id: 1, nft_asset_ids: ['1'], evidence_uri: 'https://example.com/nft' });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('P1: applies the explicit plugin cap to skills even when the environment has a higher cap', async () => {
    vi.stubEnv('MAX_TRANSFER_AMOUNT', '10000000'); // install default, 1000 XPR
    registry(plugin, { maxTransferAmount: 100000, confirmHighRisk: true }); // operator lowers to 10 XPR
    const result = await registry(defi).get('defi_create_otc').handler(otc('20.0000 XPR'));
    expect(execFileMock, JSON.stringify(result)).not.toHaveBeenCalled();
  });

  it.each([
    ['defi', defi, 'defi_create_otc', otc('1.0000 XPR')],
    ['nft', nft, 'nft_transfer', { to: 'receiver', asset_ids: ['1'] }],
    ['lending', lending, 'loan_enter_markets', { markets: ['LXPR'] }],
    ['governance', governance, 'gov_vote', { community_id: 3, proposal_id: 1, winners: [{ id: 0, weight: 100 }] }],
    ['xmd', xmd, 'xmd_mint', { collateral_symbol: 'XUSDC', amount: 1 }],
  ])('P2: %s refuses string confirmation before signing', async (_label, skill, name, params) => {
    vi.mocked(fetch).mockImplementation(async (_url, init: any) => {
      const query = JSON.parse(init.body);
      const body = query.table === 'tokens'
        ? { rows: [{ symbol: { sym: '6,XUSDC', contract: 'xtokens' }, isMintEnabled: true }] }
        : query.table === 'xmdglobals' ? { rows: [] } : { ram_quota: 100000, ram_usage: 0 };
      return { ok: true, json: async () => body } as any;
    });
    const result = await registry(skill).get(name).handler({ ...params, confirmed: 'true' });
    expect(execFileMock, JSON.stringify(result)).not.toHaveBeenCalled();
  });
});

describe('signing boundary and access control (existing properties)', () => {
  it('P1: msig approval remains disabled without operator opt-in', async () => {
    vi.stubEnv('ENABLE_MSIG_APPROVE', 'false');
    const result = await registry(defi).get('msig_approve').handler({ proposer: 'receiver', proposal_name: 'proposal', confirmed: true });
    expect(result.error).toMatch(/disabled/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('P1: rejects split OTC deposits whose combined value exceeds the cap', async () => {
    const params = otc('6.0000 XPR');
    params.from_tokens.push({ quantity: '6.0000 XPR', contract: 'eosio.token' });
    const result = await registry(defi).get('defi_create_otc').handler(params);
    expect(result.error).toMatch(/transfer cap/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('P1: blocks malformed, negative, exponential and huge XPR quantities at signing', async () => {
    const { session } = createCliSession({ account: 'testagent', maxTransferAmount: 100000 });
    for (const quantity of ['-1.0000 XPR', '1e9 XPR', '999999999999999999999999.0000 XPR', '10.0001 XPR']) {
      await expect(session.link.transact({ actions: [transfer(quantity)] })).rejects.toThrow();
    }
    expect(execFileMock).not.toHaveBeenCalled();
    await session.link.transact({ actions: [transfer('10.0000 XPR')] });
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('P2: core confirmation requires literal true, and missing skill confirmation blocks writes', async () => {
    for (const confirmed of [undefined, false, 'true', 1, {}, []]) {
      expect(needsConfirmation(true, confirmed as any, 'action', {}, 'confirm')).toHaveProperty('needs_confirmation', true);
    }
    expect(needsConfirmation(true, true, 'action', {}, 'confirm')).toBeNull();
    await registry(defi).get('defi_create_otc').handler({ ...otc('1.0000 XPR'), confirmed: undefined });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('P3: memo/JSON/extra signer fields remain data in one argv item with fixed authorization', async () => {
    const memo = '\"}],\"authorization\":[{\"actor\":\"other\",\"permission\":\"owner\"}]}; $(touch /tmp/review-nope) --permission other@owner';
    await registry(nft).get('nft_transfer').handler({
      to: 'receiver', asset_ids: ['1'], memo, confirmed: true, account: 'other', permission: 'owner',
    });
    const [command, args, options] = execFileMock.mock.calls.at(-1)!;
    expect(command).toBe('proton');
    expect(args).toHaveLength(2);
    expect(args[0]).toBe('transaction:push');
    expect(options.shell).not.toBe(true);
    const actions = JSON.parse(args[1]).actions;
    expect(actions).toHaveLength(1);
    expect(actions[0].authorization).toEqual([{ actor: 'testagent', permission: 'active' }]);
    expect(actions[0].data.memo).toBe(memo);
  });

  it.each(['xpr_accept_job', 'xpr_submit_bid'])('P4: %s refuses an untrusted arbitrator before signing', async name => {
    const { tools, rpc } = escrow();
    rpc.get_table_rows.mockResolvedValue({ rows: [{ id: '1', arbitrator: 'untrusted', deliverables: '[]' }], more: false });
    await expect(tools.get(name).handler({ job_id: 1, amount: 1, timeline: 3600, proposal: 'Work', confirmed: true })).rejects.toThrow(/TRUSTED_ARBITRATORS/);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
const { transact, lookup, shellPost } = vi.hoisted(() => ({ transact: vi.fn(), lookup: vi.fn(), shellPost: vi.fn() }));
vi.mock('@xpr-agents/openclaw', () => ({ createCliApi: () => ({
  api: { transact }, account: 'testagent', permission: 'active',
}) }));
vi.mock('node:dns/promises', () => ({ lookup }));
vi.mock('@shellbook/sdk', () => ({ Shellbook: class { post = shellPost; } }));
import defi from '../skills/defi/src/index';
import nft from '../skills/nft/src/index';
import lending from '../skills/lending/src/index';
import governance from '../skills/governance/src/index';
import xmd from '../skills/xmd/src/index';
import creative from '../skills/creative/src/index';
import sandbox from '../skills/code-sandbox/src/index';
import scraping from '../skills/web-scraping/src/index';
import structured from '../skills/structured-data/src/index';
import smartContracts from '../skills/smart-contracts/src/index';
import shellbook from '../skills/shellbook/src/index';
import { guardedFetch } from '../skills/web-scraping/src/ssrf';

function registry(register: any) {
  const tools = new Map<string, any>();
  register({ registerTool: (t: any) => tools.set(t.name, t), getConfig: () => ({}) });
  return (name: string, args: any = {}) => tools.get(name).handler(args);
}
const actions = () => transact.mock.calls.at(-1)![0].actions;
const market = { share_symbol: { sym: '8,LUSDC', contract: 'lending.loan' },
  underlying_symbol: { sym: '6,XUSDC', contract: 'xtokens' }, stable_loans_enabled: true };

beforeEach(() => {
  vi.stubEnv('XPR_ACCOUNT', 'testagent');
  vi.stubEnv('XPR_RPC_ENDPOINT', 'https://rpc.invalid');
  vi.stubEnv('PINATA_JWT', '');
  transact.mockReset().mockResolvedValue({ transaction_id: 'fixture-tx' });
  lookup.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  shellPost.mockReset().mockResolvedValue({ id: 'fixture-post' });
  vi.stubGlobal('fetch', vi.fn(async (_url: any, init: any) => {
    const q = JSON.parse(init?.body || '{}');
    return { ok: true, status: 200, json: async () => q.table === 'markets' ? { rows: [market] }
      : q.table === 'tokens' ? { rows: [{ symbol: { sym: '6,XUSDC', contract: 'xtokens' }, isMintEnabled: true, isRedeemEnabled: true }] }
      : q.table === 'xmdglobals' ? { rows: [{ isPaused: false }] }
      : { ram_quota: 100000, ram_usage: 0, rows: [] } } as any;
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// Contract ABIs are build outputs (contracts' `npm run build`). CI builds and supplies them, so
// only a local run without built contracts skips these checks.
const haveEscrowAbi = !!process.env.CI
  || fs.existsSync(new URL('../../contracts/agentescrow/assembly/target/agentescrow.contract.abi', import.meta.url));

describe('skills review findings', () => {
  it('P4: NFT purchases and bids use the XMD token contract instead of eosio.token', async () => {
    const call = registry(nft);
    await call('nft_purchase', { sale_id: '7', price: '1.000000 XMD', confirmed: true });
    const purchaseContract = actions().find((a: any) => a.name === 'transfer').account;
    await call('nft_bid', { auction_id: '7', bid_amount: '1.000000 XMD', confirmed: true });
    const bidContract = actions().find((a: any) => a.name === 'transfer').account;
    expect([purchaseContract, bidContract]).toEqual(['xmd.token', 'xmd.token']);
  });

  it('P4: zero liquidity slippage preserves the exact supplied minimum amounts', async () => {
    await registry(defi)('defi_add_liquidity', { lt_symbol: '8,XPRUSDC', token1: '10.0000 XPR',
      token1_contract: 'eosio.token', token2: '1.000000 XUSDC', token2_contract: 'xtokens',
      slippage_pct: 0, confirmed: true });
    const add = actions().find((a: any) => a.name === 'liquidityadd').data;
    expect(add.add_token1_min.quantity).toBe('10.0000 XPR');
    expect(add.add_token2_min.quantity).toBe('1.000000 XUSDC');
  });

  it('P2: creative storage refuses whitespace-only work instead of issuing a delivery URL', async () => {
    const result = await registry(creative)('store_deliverable', { job_id: 7, content: ' \n\t ', content_type: 'text/markdown' });
    expect(result.stored).toBe(false);
    expect(result.url).toBeUndefined();
  });
});

describe('properties that hold', () => {
  it('P4: lending supply/repay use underlying precision; redeem/withdraw use share precision', async () => {
    const call = registry(lending);
    for (const [name, expectedAction, field, expectedQuantity] of [
      ['loan_supply', 'transfer', 'quantity', '1.123456 XUSDC'],
      ['loan_repay', 'transfer', 'quantity', '1.123456 XUSDC'],
      ['loan_borrow', 'borrow', 'underlying', '1.123456 XUSDC'],
      ['loan_redeem', 'redeem', 'token', '1.12345600 LUSDC'],
      ['loan_withdraw_collateral', 'withdraw', 'token', '1.12345600 LUSDC'],
    ]) {
      const result = await call(name, { market_symbol: 'LUSDC', amount: 1.123456, rate_type: 'variable', confirmed: true });
      expect(result.error).toBeUndefined();
      const a = actions()[0];
      expect(a.name).toBe(expectedAction);
      expect(a.account).toBe(expectedAction === 'transfer' ? 'xtokens' : 'lending.loan');
      expect(typeof a.data[field] === 'string' ? a.data[field] : a.data[field].quantity).toBe(expectedQuantity);
      if (expectedAction === 'transfer') {
        expect(a.data.to).toBe('lending.loan');
        expect(a.data.memo).toBe(name === 'loan_supply' ? 'mint' : 'repay,variable');
      }
    }
    await call('loan_claim_rewards', { markets: ['lusdc'], confirmed: true });
    expect(actions().map((a: any) => [a.account, a.name, a.data])).toEqual([
      ['lending.loan', 'update.user', { user: 'testagent' }],
      ['lending.loan', 'claim', { user: 'testagent', markets: ['LUSDC'] }],
    ]);
  });

  it('P4: XMD mint/redeem use the documented contracts, memos and six decimals', async () => {
    const call = registry(xmd);
    await call('xmd_mint', { collateral_symbol: 'XUSDC', amount: 1.123456, confirmed: true });
    expect(actions()[0]).toMatchObject({ account: 'xtokens', name: 'transfer', data: {
      from: 'testagent', to: 'xmd.treasury', quantity: '1.123456 XUSDC', memo: 'mint',
    } });
    await call('xmd_redeem', { redeem_for: 'XUSDC', amount: 1.123456, confirmed: true });
    expect(actions()[0]).toMatchObject({ account: 'xmd.token', name: 'transfer', data: {
      from: 'testagent', to: 'xmd.treasury', quantity: '1.123456 XMD', memo: 'redeem,XUSDC',
    } });
  });

  it('P4: governance carries the community fee asset and documented vote/post fields', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ rows: [{
      proposalFee: { quantity: '50000.0000 LOAN', contract: 'loan.token' },
      strategies: ['loan-and-sloan-balances'], votingSystems: ['0'],
    }] }) } as any);
    const call = registry(governance);
    await call('gov_post_proposal', { community_id: 5, content_id: 'fixture', strategy: 'loan-and-sloan-balances',
      voting_system: '0', candidates: [{ id: 0, name: 'Yes' }, { id: 1, name: 'No' }],
      start_time: 1800000000, end_time: 1800003600, confirmed: true });
    expect(actions()[0]).toMatchObject({ account: 'loan.token', name: 'transfer', data: { to: 'gov', quantity: '50000.0000 LOAN' } });
    expect(actions()[1]).toMatchObject({ account: 'gov', name: 'postprop', data: {
      author: 'testagent', communityId: 5, content: 'fixture', votingSystem: '0', startTime: 1800000000, endTime: 1800003600,
    } });
    await call('gov_vote', { community_id: 5, proposal_id: 7, winners: [{ id: 0, weight: 100 }], confirmed: true });
    expect(actions()[0]).toMatchObject({ account: 'gov', name: 'vote', data: {
      voter: 'testagent', communityId: 5, proposalId: 7, winners: [{ id: 0, weight: 100 }],
    } });
  });

  it('P4: NFT XPR/XUSDC purchases use correct token accounts and complete purchase fields', async () => {
    const call = registry(nft);
    for (const [price, contract] of [['1.0000 XPR', 'eosio.token'], ['1.000000 XUSDC', 'xtokens']]) {
      await call('nft_purchase', { sale_id: '7', price, confirmed: true });
      expect(actions()[0]).toMatchObject({ account: contract, name: 'transfer', data: { to: 'atomicmarket', quantity: price, memo: 'deposit' } });
      expect(actions()[1]).toMatchObject({ account: 'atomicmarket', name: 'purchasesale', data: {
        buyer: 'testagent', sale_id: 7, intended_delphi_median: 0, taker_marketplace: '',
      } });
    }
  });

  it('P4: AMM swap preserves XPR 4 / XUSDC 6 and documented action sequence', async () => {
    await registry(defi)('defi_swap', { from_token: '4,XPR,eosio.token', to_token: '6,XUSDC,xtokens',
      amount: 1.2345, min_output: 0.123456, confirmed: true });
    expect(actions().map((a: any) => a.name)).toEqual(['depositprep', 'transfer', 'makeorder1', 'withdrawall']);
    expect(actions()[1]).toMatchObject({ account: 'eosio.token', data: { quantity: '1.2345 XPR' } });
    expect(actions()[2]).toMatchObject({ account: 'proton.swaps', data: {
      maker: 'testagent', maker_in: { quantity: '1.2345 XPR', contract: 'eosio.token' },
      maker_out_min: { quantity: '0.123456 XUSDC', contract: 'xtokens' },
    } });
  });

  it('P4: fetching refuses private DNS results and public-to-private redirects', async () => {
    lookup.mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }]);
    await expect(guardedFetch('https://private.example/page')).rejects.toThrow(/private/);
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValue({ status: 302, headers: { get: () => 'http://169.254.169.254/latest/meta-data/' } } as any);
    await expect(guardedFetch('https://public.example/page')).rejects.toThrow(/private/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.redirect).toBe('manual');
  });

  it('P4: creative and scraping entrypoints refuse internal URLs before fetching', async () => {
    const scrape = await registry(scraping)('scrape_url', { url: 'http://127.0.0.1/private' });
    expect(scrape.error).toBeDefined();
    const media = await registry(creative)('store_deliverable', { job_id: 7, content: '', content_type: 'image/png', source_url: 'http://10.0.0.1/private' });
    expect(media.stored).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('P4: sandbox has no host secrets or network globals and clones input', async () => {
    vi.stubEnv('REVIEW_SECRET', 'fixture-only');
    const input = { nested: { value: 1 } };
    const r = await registry(sandbox)('execute_js', { input, code: 'INPUT.nested.value = 2; return [typeof process, typeof require, typeof fetch, typeof Buffer];' });
    expect(r.result).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
    expect(input.nested.value).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.skipIf(!haveEscrowAbi)('P4: contract inspection reads the local escrow ABI fixture without a live ABI', async () => {
    const abi = JSON.parse(fs.readFileSync(new URL('../../contracts/agentescrow/assembly/target/agentescrow.contract.abi', import.meta.url), 'utf8'));
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ abi }) } as any);
    const r = await registry(smartContracts)('sc_get_abi', { account: 'agentescrow' });
    expect(r.actions.map((a: any) => a.name)).toEqual(abi.actions.map((a: any) => a.name));
    for (const name of ['timeout', 'cancel', 'accpttimeout']) {
      const action = abi.actions.find((a: any) => a.name === name);
      expect(action).toBeDefined();
      expect(abi.structs.find((s: any) => s.name === action.type).fields).toContainEqual({ name: 'job_id', type: 'uint64' });
    }
  });

  it('P4: structured CSV round trips quoted commas and embedded newlines', async () => {
    const call = registry(structured);
    const data = [{ name: 'a,b', note: 'first\n"second"' }];
    const r = await call('json_to_csv', { data });
    expect((await call('parse_csv', { csv: r.csv })).data).toEqual(data);
  });

  it('P4: Shellbook enforces documented post length before contacting the SDK', async () => {
    const result = await registry(shellbook)('shell_create_post', { subshell: 'general', title: 'x'.repeat(301), content: 'test' });
    expect(result.error).toContain('300');
    expect(shellPost).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The signer must never be reached when the cap refuses a transaction.
const { execTransactionPush } = vi.hoisted(() => ({
  execTransactionPush: vi.fn(async () => ({ transaction_id: 'TX', processed: {} })),
}));
vi.mock('../src/proton-cli', () => ({ execTransactionPush }));

import { assertTransferCap, resolveTransferCap, totalXprSent, DEFAULT_MAX_TRANSFER_AMOUNT } from '../src/util/transfer-cap';
import { createCliApi, createCliSession } from '../src/cli-session';

const xfer = (from: string, quantity: string, contract = 'eosio.token') => ({
  account: contract,
  name: 'transfer',
  authorization: [{ actor: from, permission: 'active' }],
  data: { from, to: 'someone', quantity, memo: '' },
});

describe('central XPR transfer cap', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.MAX_TRANSFER_AMOUNT;
    delete process.env.MAX_TRANSFER_XPR;
    execTransactionPush.mockClear();
  });
  afterEach(() => { process.env = { ...saved }; });

  it('defaults to 1,000 XPR', () => {
    expect(resolveTransferCap()).toBe(DEFAULT_MAX_TRANSFER_AMOUNT);
    expect(() => assertTransferCap([xfer('agent', '1000.0000 XPR')], 'agent')).not.toThrow();
    expect(() => assertTransferCap([xfer('agent', '1000.0001 XPR')], 'agent')).toThrow(/transfer cap/);
  });

  it('honors MAX_TRANSFER_AMOUNT (smallest units), then legacy MAX_TRANSFER_XPR', () => {
    process.env.MAX_TRANSFER_AMOUNT = '500000'; // 50 XPR
    expect(() => assertTransferCap([xfer('agent', '50.0001 XPR')], 'agent')).toThrow();
    delete process.env.MAX_TRANSFER_AMOUNT;
    process.env.MAX_TRANSFER_XPR = '20';
    expect(resolveTransferCap()).toBe(200000);
  });

  it('sums every XPR transfer in the transaction (no splitting around the cap)', () => {
    const actions = [xfer('agent', '600.0000 XPR'), xfer('agent', '600.0000 XPR')];
    expect(totalXprSent(actions, 'agent')).toBe(12_000_000);
    expect(() => assertTransferCap(actions, 'agent')).toThrow(/1200\.0000 XPR/);
  });

  it('ignores other tokens, other senders, and non-transfer actions', () => {
    expect(totalXprSent([
      xfer('agent', '999999.000000 XUSDC', 'xtokens'),
      xfer('someoneelse', '999999.0000 XPR'),
      { account: 'eosio.token', name: 'open', data: { owner: 'agent' } },
    ], 'agent')).toBe(0);
  });

  it('refuses an unparseable XPR quantity instead of letting it through', () => {
    expect(() => assertTransferCap([xfer('agent', '1e9 XPR')], 'agent')).toThrow(/could not parse/);
  });

  it('createCliApi (every skill) refuses the reported OTC case before signing', async () => {
    const { api } = createCliApi({ account: 'victimagent' });
    await expect(api.transact({
      actions: [
        xfer('victimagent', '9999999.0000 XPR'),
        { account: 'token.escrow', name: 'startescrow', authorization: [], data: { from: 'victimagent', to: 'attackeracct' } },
      ] as any,
    })).rejects.toThrow(/transfer cap/);
    expect(execTransactionPush).not.toHaveBeenCalled();
  });

  it('createCliApi signs normally under the cap', async () => {
    const { api } = createCliApi({ account: 'agent' });
    await api.transact({ actions: [xfer('agent', '10.0000 XPR')] as any });
    expect(execTransactionPush).toHaveBeenCalledTimes(1);
  });

  it('createCliSession (core tools) enforces an explicit plugin-config cap', async () => {
    const { session } = createCliSession({ account: 'agent', maxTransferAmount: 100000 }); // 10 XPR
    await expect(session.link.transact({ actions: [xfer('agent', '11.0000 XPR')] as any })).rejects.toThrow();
    expect(execTransactionPush).not.toHaveBeenCalled();
  });
});

describe('msig_approve is opt-in (blind approval bypasses the transfer cap)', () => {
  it('refuses unless ENABLE_MSIG_APPROVE=true, before signing anything', async () => {
    delete process.env.ENABLE_MSIG_APPROVE;
    process.env.XPR_ACCOUNT = 'victimagent';
    execTransactionPush.mockClear();
    const skill = (await import('../skills/defi/src/index')).default;
    const tools: any[] = [];
    skill({ registerTool: (t: any) => tools.push(t), getConfig: () => ({}) } as any);
    const r = await tools.find((t) => t.name === 'msig_approve').handler({ proposer: 'attacker', proposal_name: 'drain', confirmed: true });
    expect(r.error).toMatch(/disabled/);
    expect(execTransactionPush).not.toHaveBeenCalled();
  });
});

describe('transfer cap: October 2026 hardening', () => {
  const ram = (payer: string, quant: string, name = 'buyram') => ({
    account: 'eosio', name, authorization: [{ actor: payer, permission: 'active' }],
    data: name === 'buyram' ? { payer, receiver: 'other', quant } : { payer, receiver: payer, bytes: 8192 },
  });

  it('counts trailing-dot aliases of the token contract, action and sender', () => {
    expect(totalXprSent([xfer('agent', '20.0000 XPR', 'eosio.token.')], 'agent')).toBe(200000);
    expect(totalXprSent([{ ...xfer('agent.', '1.0000 XPR'), name: 'transfer.' }], 'agent')).toBe(10000);
  });

  it('counts a quantity written without a space before the symbol', () => {
    expect(totalXprSent([xfer('agent', '20.0000XPR')], 'agent')).toBe(200000);
    expect(() => assertTransferCap([xfer('agent', '20.0000XPR')], 'agent', 100000)).toThrow('above the transfer cap');
  });

  it('refuses XPR amounts without exactly 4 decimals', () => {
    for (const q of ['20 XPR', '20.0 XPR', '20.00000 XPR']) {
      expect(() => totalXprSent([xfer('agent', q)], 'agent')).toThrow('exactly 4 decimals');
    }
  });

  it('refuses an XPR-looking quantity it cannot parse', () => {
    for (const q of ['-5.0000 XPR', '1e3 XPR', 'XPR 5.0000', '5.0000 XPR extra']) {
      expect(() => totalXprSent([xfer('agent', q)], 'agent')).toThrow('could not parse');
    }
  });

  it('does not treat other symbols containing XPR (LXPR, XPRX) as XPR', () => {
    expect(totalXprSent([xfer('agent', '5.00000000 LXPR'), xfer('agent', '5.0000XPRX')], 'agent')).toBe(0);
  });

  it('counts buyram paid by the agent, for any receiver, together with transfers', () => {
    expect(totalXprSent([ram('agent', '50.0000 XPR'), xfer('agent', '60.0000 XPR')], 'agent')).toBe(1100000);
    expect(() => assertTransferCap([ram('agent', '50.0000 XPR'), xfer('agent', '60.0000 XPR')], 'agent', 1000000))
      .toThrow('above the transfer cap');
    expect(totalXprSent([ram('someone', '50.0000 XPR')], 'agent')).toBe(0);
  });

  it('counts XPR staked by the agent via eosio::stakexpr', () => {
    const stake = (from: string, q: string) => ({ account: 'eosio', name: 'stakexpr', authorization: [{ actor: from, permission: 'active' }],
      data: { from, receiver: from, stake_xpr_quantity: q } });
    expect(totalXprSent([stake('agent', '20.0000 XPR')], 'agent')).toBe(200000);
    expect(() => assertTransferCap([stake('agent', '20.0000 XPR')], 'agent', 100000)).toThrow('above the transfer cap');
    expect(totalXprSent([stake('someone', '20.0000 XPR')], 'agent')).toBe(0);
  });

  it('refuses buyrambytes paid by the agent, whose cost cannot be checked', () => {
    expect(() => totalXprSent([ram('agent', '', 'buyrambytes')], 'agent')).toThrow('buyrambytes');
    expect(totalXprSent([ram('someone', '', 'buyrambytes')], 'agent')).toBe(0);
  });
});

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

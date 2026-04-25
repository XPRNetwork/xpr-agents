import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/proton-cli', () => ({
  execTransactionPush: vi.fn(),
}));

import { execTransactionPush } from '../src/proton-cli';
import { createCliSession, createCliApi } from '../src/cli-session';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createCliSession (ProtonSession shape)', () => {
  it('returns a ProtonSession with auth and link.transact', () => {
    const { session, rpc } = createCliSession({ account: 'paul123' });
    expect(session.auth).toEqual({ actor: 'paul123', permission: 'active' });
    expect(typeof session.link.transact).toBe('function');
    expect(rpc).toBeDefined();
  });

  it('honours custom permission', () => {
    const { session } = createCliSession({ account: 'paul123', permission: 'a2a' });
    expect(session.auth.permission).toBe('a2a');
  });

  it('routes link.transact through execTransactionPush', async () => {
    vi.mocked(execTransactionPush).mockResolvedValue({
      transaction_id: 'deadbeef',
      processed: { block_num: 1234, block_time: '2026-04-25T00:00:00.000' },
    });

    const { session } = createCliSession({ account: 'paul123' });
    const result = await session.link.transact({
      actions: [
        {
          account: 'agentcore',
          name: 'update',
          authorization: [{ actor: 'paul123', permission: 'active' }],
          data: { account: 'paul123', name: 'X' },
        },
      ],
    });

    expect(execTransactionPush).toHaveBeenCalledWith({
      actions: [
        {
          account: 'agentcore',
          name: 'update',
          authorization: [{ actor: 'paul123', permission: 'active' }],
          data: { account: 'paul123', name: 'X' },
        },
      ],
    });
    expect(result.transaction_id).toBe('deadbeef');
    expect(result.processed.block_num).toBe(1234);
  });

  it('normalises missing block_num to 0 (best-effort)', async () => {
    vi.mocked(execTransactionPush).mockResolvedValue({
      transaction_id: 'cafef00d',
      processed: undefined,
    });

    const { session } = createCliSession({ account: 'paul123' });
    const result = await session.link.transact({
      actions: [
        {
          account: 'a',
          name: 'b',
          authorization: [{ actor: 'paul123', permission: 'active' }],
          data: {},
        },
      ],
    });

    expect(result.processed.block_num).toBe(0);
    expect(result.processed.block_time).toBe('');
  });
});

describe('createCliApi (skill shape)', () => {
  it('returns {api, account, permission}', () => {
    const { api, account, permission } = createCliApi({ account: 'paul123' });
    expect(account).toBe('paul123');
    expect(permission).toBe('active');
    expect(typeof api.transact).toBe('function');
  });

  it('api.transact accepts eosjs-style options without breaking', async () => {
    vi.mocked(execTransactionPush).mockResolvedValue({
      transaction_id: 'beefcafe',
      processed: { block_num: 5, block_time: '2026-04-25T00:00:00.000' },
    });

    const { api } = createCliApi({ account: 'paul123' });
    // Skills currently call with { blocksBehind: 3, expireSeconds: 30 }
    const result = await api.transact(
      {
        actions: [
          {
            account: 'eosio.token',
            name: 'transfer',
            authorization: [{ actor: 'paul123', permission: 'active' }],
            data: { from: 'paul123', to: 'x', quantity: '1.0000 XPR', memo: '' },
          },
        ],
      },
      { blocksBehind: 3, expireSeconds: 30 },
    );

    expect(result.transaction_id).toBe('beefcafe');
    // The options were silently accepted (CLI manages tx headers itself).
    expect(execTransactionPush).toHaveBeenCalledTimes(1);
  });

  it('honours custom permission', () => {
    const { permission } = createCliApi({ account: 'paul123', permission: 'a2a' });
    expect(permission).toBe('a2a');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process before importing the module under test.
const execFileMock = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => {
    // util.promisify expects the last arg to be a Node-style callback.
    const cb = args[args.length - 1] as (err: unknown, result?: { stdout: string; stderr: string }) => void;
    const cmdArgs = args.slice(0, -1);
    Promise.resolve(execFileMock(...cmdArgs)).then(
      (result) => cb(null, result as { stdout: string; stderr: string }),
      (err) => cb(err),
    );
  },
}));

// Capture console.error so we can assert on log output without polluting test output.
let logged: string[] = [];
beforeEach(() => {
  execFileMock.mockReset();
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((msg: string) => {
    logged.push(msg);
  });
});

import {
  execAction,
  execTransactionPush,
  getTableRows,
  ProtonCliError,
  checkProtonCli,
  checkKeychainPopulated,
} from '../src/proton-cli';

describe('execAction', () => {
  it('shells out to proton action with positional JSON data', async () => {
    execFileMock.mockResolvedValue({
      stdout: '{"transaction_id":"abc123","processed":{}}',
      stderr: '',
    });

    const result = await execAction(
      'agentescrow',
      'createjob',
      ['alice', '', 'title', 'desc', '[]', 1000, 'XPR', 0, '', ''],
      'alice@active',
    );

    expect(execFileMock).toHaveBeenCalledWith(
      'proton',
      [
        'action',
        'agentescrow',
        'createjob',
        '["alice","","title","desc","[]",1000,"XPR",0,"",""]',
        'alice@active',
      ],
      expect.objectContaining({ timeout: 30000 }),
    );
    expect(result.transaction_id).toBe('abc123');
  });

  it('logs start and success without including action data', async () => {
    execFileMock.mockResolvedValue({
      stdout: '{"transaction_id":"deadbeef","processed":{}}',
      stderr: '',
    });

    await execAction('eosio.token', 'transfer', ['a', 'b', '1.0000 XPR', 'memo'], 'a@active');

    const startLog = logged.find((l) => l.includes('action eosio.token::transfer'));
    expect(startLog).toBeDefined();
    expect(startLog).toContain('auth=a@active');
    expect(startLog).not.toContain('1.0000 XPR'); // data not in start log
    expect(startLog).not.toContain('memo');

    const successLog = logged.find((l) => l.includes('tx deadbeef ok'));
    expect(successLog).toBeDefined();
  });

  it('throws ProtonCliError with code "auth" when CLI says no key', async () => {
    execFileMock.mockRejectedValue({
      stderr: 'Error: no key found for account paul123',
      message: '',
    });

    await expect(
      execAction('agentcore', 'update', ['paul123'], 'paul123@active'),
    ).rejects.toMatchObject({
      name: 'ProtonCliError',
      code: 'auth',
    });
  });

  it('throws ProtonCliError with code "network" on connection refused', async () => {
    execFileMock.mockRejectedValue({
      stderr: 'connect ECONNREFUSED 127.0.0.1:8888',
      message: '',
    });

    await expect(
      execAction('agentcore', 'update', ['x'], 'x@active'),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('throws ProtonCliError with code "reverted" on contract assertion failure', async () => {
    execFileMock.mockRejectedValue({
      stderr: 'assertion failure with message: agent not registered',
      message: '',
    });

    await expect(
      execAction('agentfeed', 'submit', ['a'], 'a@active'),
    ).rejects.toMatchObject({ code: 'reverted' });
  });

  it('throws ProtonCliError with code "serialization" on unable to unpack', async () => {
    execFileMock.mockRejectedValue({
      stderr: 'unable to unpack action data',
      message: '',
    });

    await expect(
      execAction('agentcore', 'update', ['x'], 'x@active'),
    ).rejects.toMatchObject({ code: 'serialization' });
  });

  it('scrubs action data from stderr in logs', async () => {
    execFileMock.mockRejectedValue({
      stderr: 'failed: "data": { "memo": "secret-memo-info" }',
      message: '',
    });

    await expect(execAction('a', 'b', [], 'x@active')).rejects.toThrow();

    const failLog = logged.find((l) => l.includes('FAILED'));
    expect(failLog).toBeDefined();
    expect(failLog).not.toContain('secret-memo-info');
    expect(failLog).toContain('[scrubbed]');
  });

  it('throws if CLI returns success with no parseable transaction ID', async () => {
    execFileMock.mockResolvedValue({ stdout: '{"some":"output"}', stderr: '' });

    await expect(
      execAction('agentcore', 'update', [], 'x@active'),
    ).rejects.toMatchObject({
      message: expect.stringContaining('no transaction ID'),
    });
  });
});

describe('execTransactionPush', () => {
  it('shells out to proton transaction:push (NOT bare transaction)', async () => {
    execFileMock.mockResolvedValue({
      stdout: '{"transaction_id":"cafef00d","processed":{}}',
      stderr: '',
    });

    const result = await execTransactionPush({
      actions: [
        {
          account: 'agentcore',
          name: 'update',
          authorization: [{ actor: 'paul123', permission: 'active' }],
          data: { account: 'paul123', name: 'A' },
        },
        {
          account: 'agentcore',
          name: 'update',
          authorization: [{ actor: 'paul123', permission: 'active' }],
          data: { account: 'paul123', name: 'B' },
        },
      ],
    });

    expect(execFileMock).toHaveBeenCalledWith(
      'proton',
      ['transaction:push', expect.stringContaining('"actions"')],
      expect.objectContaining({ timeout: 30000 }),
    );
    // Critical: ensure we're using transaction:push, not bare transaction.
    const calledArgs = execFileMock.mock.calls[0][1] as string[];
    expect(calledArgs[0]).toBe('transaction:push');
    expect(result.transaction_id).toBe('cafef00d');
  });

  it('throws on empty actions array', async () => {
    await expect(execTransactionPush({ actions: [] })).rejects.toThrow('empty actions');
  });
});

describe('getTableRows', () => {
  it('shells out to proton table with correct flags', async () => {
    execFileMock.mockResolvedValue({
      stdout: '{"rows":[{"account":"paul123"}],"more":false}',
      stderr: '',
    });

    const result = await getTableRows('agentcore', 'agents', 'agentcore', {
      limit: 10,
      lower_bound: 'paul123',
      upper_bound: 'paul123',
    });

    expect(execFileMock).toHaveBeenCalledWith(
      'proton',
      ['table', 'agentcore', 'agents', 'agentcore', '-c', '10', '-l', 'paul123', '-u', 'paul123'],
      expect.any(Object),
    );
    expect(result).toEqual({ rows: [{ account: 'paul123' }], more: false });
  });

  it('parses JSON output', async () => {
    execFileMock.mockResolvedValue({
      stdout: '{"rows":[],"more":false,"next_key":""}',
      stderr: '',
    });
    const result = await getTableRows('agentcore', 'agents');
    expect(result).toEqual({ rows: [], more: false, next_key: '' });
  });
});

describe('checkProtonCli', () => {
  it('returns true when proton --version succeeds', async () => {
    execFileMock.mockResolvedValue({ stdout: '@proton/cli/0.1.95', stderr: '' });
    expect(await checkProtonCli()).toBe(true);
  });

  it('returns false when proton CLI is missing', async () => {
    execFileMock.mockRejectedValue(new Error('command not found'));
    expect(await checkProtonCli()).toBe(false);
  });
});

describe('checkKeychainPopulated', () => {
  it('returns true when key:list contains publicKey', async () => {
    execFileMock.mockResolvedValue({
      stdout: '[{"publicKey":"PUB_K1_xxx","privateKey":"[redacted]"}]',
      stderr: '',
    });
    expect(await checkKeychainPopulated()).toBe(true);
  });

  it('returns false when keychain is empty', async () => {
    execFileMock.mockResolvedValue({ stdout: '[]', stderr: '' });
    expect(await checkKeychainPopulated()).toBe(false);
  });
});

describe('ProtonCliError', () => {
  it('preserves code and stderr fields', () => {
    const err = new ProtonCliError('msg', 'auth', 'stderr-content');
    expect(err.code).toBe('auth');
    expect(err.stderr).toBe('stderr-content');
    expect(err.name).toBe('ProtonCliError');
  });
});

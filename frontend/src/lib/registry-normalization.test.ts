import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAgent, getAgents, getAgentsByOwner, getAgentsPage, getAllJobs, getJob, getServices, getXprBalance, rpc } from './registry';
import { indexerFetch } from './indexer';

vi.mock('./indexer', () => ({ indexerFetch: vi.fn() }));

const agentRow = { account: 'alice', owner: 'bob', active: 1 };
const jobRow = { id: 1, agent: 'alice', state: 0 };
const table = { more: false, next_key: '', next_key_bytes: '' };

beforeEach(() => {
  vi.mocked(indexerFetch).mockReset().mockResolvedValue(null);
  vi.spyOn(rpc, 'get_table_rows').mockResolvedValue({ ...table, rows: [] });
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(Error('Network forbidden in tests'))));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const shapes: [string, string[]][] = [
  ['null', []], ['"hello"', []], ['42', []], ['true', []], ['{}', []],
  ['[{}]', []], ['[]', []], ['["coding",{},null,7,false,"writing"]', ['coding', 'writing']],
];

describe('registry string arrays', () => {
  it.each([...shapes, [' coding, writing, ,', ['coding', 'writing']] as [string, string[]]])('normalizes capabilities %s on every agent read', async (capabilities, expected) => {
    const row = { ...agentRow, capabilities };
    vi.mocked(rpc.get_table_rows).mockResolvedValue({ ...table, rows: [row] });
    expect((await getAgent('alice'))?.capabilities).toEqual(expected);
    expect((await getAgents())[0].capabilities).toEqual(expected);
    expect((await getAgentsByOwner('bob'))[0].capabilities).toEqual(expected);
    vi.mocked(indexerFetch).mockResolvedValue({ agents: [row], total: 1 });
    expect((await getAgentsPage())?.entries[0].agent.capabilities).toEqual(expected);
  });

  it.each([...shapes, ['report, source', []] as [string, string[]]])('normalizes deliverables %s on job and service reads', async (deliverables, expected) => {
    const row = { ...jobRow, active: 1, deliverables };
    vi.mocked(rpc.get_table_rows).mockResolvedValue({ ...table, rows: [row] });
    expect((await getJob(1))?.deliverables).toEqual(expected);
    expect((await getAllJobs())[0].deliverables).toEqual(expected);
    expect((await getServices())[0].deliverables).toEqual(expected);
    vi.mocked(indexerFetch).mockResolvedValue({ jobs: [row] });
    expect((await getAllJobs())[0].deliverables).toEqual(expected);
    vi.mocked(indexerFetch).mockResolvedValue({ services: [row] });
    expect((await getServices())[0].deliverables).toEqual(expected);
  });
});

it('reads exact XPR balances and skips malformed amounts or other symbols', async () => {
  for (const [balance, expected] of [['1.0009 XPR', 10009], ['1.0009 XPRX', 0], ['1e2 XPR', 0], ['1.00009 XPR', 0]] as const) {
    vi.mocked(rpc.get_table_rows).mockResolvedValue({ ...table, rows: [{ balance }] });
    expect(await getXprBalance('alice')).toBe(expected);
  }
});

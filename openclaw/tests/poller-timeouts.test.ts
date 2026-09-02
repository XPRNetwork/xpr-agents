import { describe, it, expect } from 'vitest';
import {
  findHousekeepingActions,
  describeHousekeeping,
  DEFAULT_DISPUTE_WINDOW_SEC,
  type EscrowJobLike,
} from '../starter/agent/src/timeouts';

const NOW = 1_800_000_000;
const DAY = 86400;
const WINDOW = DEFAULT_DISPUTE_WINDOW_SEC; // 3 days

function job(partial: Partial<EscrowJobLike> & { id: number }): EscrowJobLike {
  return {
    client: 'client1',
    agent: 'me',
    state: 4,
    deadline: NOW - DAY,
    updated_at: NOW - 4 * DAY,
    ...partial,
  };
}

describe('findHousekeepingActions', () => {
  it('claims payment on a delivered job once deadline and review window have passed', () => {
    const actions = findHousekeepingActions([job({ id: 6 })], { account: 'me', nowSec: NOW });
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe('claim_payment');
    expect(actions[0].job.id).toBe(6);
  });

  it('does not claim while the client review window is still open', () => {
    // deadline passed an hour ago, but re-delivered yesterday so window still open
    const j = job({ id: 7, deadline: NOW - 3600, updated_at: NOW - DAY });
    expect(findHousekeepingActions([j], { account: 'me', nowSec: NOW })).toHaveLength(0);
  });

  it('does not claim before the deadline even if the window has passed', () => {
    const j = job({ id: 8, deadline: NOW + DAY, updated_at: NOW - 10 * DAY });
    expect(findHousekeepingActions([j], { account: 'me', nowSec: NOW })).toHaveLength(0);
  });

  it('honours a custom dispute window from contract config', () => {
    const j = job({ id: 9, deadline: NOW - DAY, updated_at: NOW - 2 * DAY });
    expect(findHousekeepingActions([j], { account: 'me', nowSec: NOW, disputeWindowSec: 3 * DAY })).toHaveLength(0);
    expect(findHousekeepingActions([j], { account: 'me', nowSec: NOW, disputeWindowSec: DAY })).toHaveLength(1);
  });

  it('refunds the client on funded, accepted or in-progress jobs past the deadline', () => {
    const jobs = [1, 2, 3].map(state => job({ id: 10 + state, client: 'me', agent: 'worker', state }));
    const actions = findHousekeepingActions(jobs, { account: 'me', nowSec: NOW });
    expect(actions.map(a => a.kind)).toEqual(['refund', 'refund', 'refund']);
  });

  it('cancels an unfunded job the client created once its deadline passes', () => {
    const open = job({ id: 17, client: 'me', agent: '.............', state: 0 });
    const actions = findHousekeepingActions([open], { account: 'me', nowSec: NOW });
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe('cancel');
  });

  it('leaves live jobs alone', () => {
    const jobs = [
      job({ id: 20, client: 'me', agent: '', state: 0, deadline: NOW + DAY }),
      job({ id: 21, client: 'me', agent: 'worker', state: 3, deadline: NOW + DAY }),
      job({ id: 22, state: 4, deadline: NOW + DAY, updated_at: NOW }),
    ];
    expect(findHousekeepingActions(jobs, { account: 'me', nowSec: NOW })).toHaveLength(0);
  });

  it('never touches terminal, disputed or delivered-as-client jobs', () => {
    const jobs = [
      job({ id: 30, client: 'me', agent: 'worker', state: 5 }),
      job({ id: 31, client: 'me', agent: 'worker', state: 6 }),
      job({ id: 32, client: 'me', agent: 'worker', state: 7 }),
      job({ id: 33, client: 'me', agent: 'worker', state: 8 }),
      // delivered to me as client: that is a review decision for the LLM, not housekeeping
      job({ id: 34, client: 'me', agent: 'worker', state: 4 }),
    ];
    expect(findHousekeepingActions(jobs, { account: 'me', nowSec: NOW })).toHaveLength(0);
  });

  it('skips jobs that already hit the attempt cap and de-duplicates ids', () => {
    const attempts = new Map<number, number>([[6, 3]]);
    const actions = findHousekeepingActions([job({ id: 6 }), job({ id: 6 }), job({ id: 40 })], { account: 'me', nowSec: NOW, attempts });
    expect(actions.map(a => a.job.id)).toEqual([40]);
  });

  it('ignores jobs where this account is neither party', () => {
    const j = job({ id: 50, client: 'someone', agent: 'else' });
    expect(findHousekeepingActions([j], { account: 'me', nowSec: NOW })).toHaveLength(0);
  });

  it('tolerates string numerics from JSON APIs', () => {
    const j = { id: 60, client: 'client1', agent: 'me', state: '4', deadline: String(NOW - DAY), updated_at: String(NOW - 4 * DAY) } as unknown as EscrowJobLike;
    expect(findHousekeepingActions([j], { account: 'me', nowSec: NOW })[0]?.kind).toBe('claim_payment');
  });
});

describe('describeHousekeeping', () => {
  it('names the job, side and action', () => {
    const [a] = findHousekeepingActions([job({ id: 6 })], { account: 'me', nowSec: NOW });
    expect(describeHousekeeping(a)).toContain('job #6 as agent: timeout (claim payment)');
  });
});

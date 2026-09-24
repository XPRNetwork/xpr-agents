import { expect } from 'chai';
import { Blockchain, mintTokens, nameToBigInt, expectToThrow, protonAssert } from '@proton/vert';
import { TimePointSec } from '@greymass/eosio';

/**
 * Regressions for the September 2026 external reports:
 *  - RAM exhaustion: createjob/addmilestone stored rows on contract RAM with no cap.
 *    Now: per-client cap on unfunded jobs (openjobs counter), per-job milestone cap,
 *    and a permissionless cleanstale for stale unfunded jobs.
 *  - Arbitrator conflict of interest: a party to a job could be its arbitrator and
 *    award itself the escrow. Now rejected in createjob, selectbid and arbitrate.
 * Caps are lowered via setlimits so tests stay clear of the @proton/vert duplicate-
 * secondary-key quirk (3+ rows with one key).
 */
const bc = new Blockchain();
const agentcore = bc.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const agentfeed = bc.createContract('agentfeed', '../agentfeed/assembly/target/agentfeed.contract');
const escrow = bc.createContract('agentescrow', 'assembly/target/agentescrow.contract', true);
const token = bc.createContract('eosio.token', 'node_modules/proton-tsc/external/eosio.token/eosio.token');
const accts = bc.createAccounts('owner', 'client', 'agent1', 'arb1');
const S = 'agentescrow';
const BASE = 1700000000;
const DEADLINE = BASE + 86400;
const job = (id: number) => escrow.tables.jobs(nameToBigInt(S)).getTableRow(BigInt(id));
const openCount = (c: string) => {
  const r = escrow.tables.openjobs(nameToBigInt(S)).getTableRow(nameToBigInt(c));
  return r ? Number(r.count) : 0;
};

const setup = async () => {
  bc.resetTables();
  bc.setTime(TimePointSec.from(BASE));
  await mintTokens(token, 'XPR', 4, 1000000000, 100000000, accts);
  await agentcore.actions.init(['owner', 0, 100000, 'agentfeed', '', 'agentescrow']).send('agentcore@active');
  await agentfeed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
  await escrow.actions.init(['owner', 'agentcore', 'agentfeed', 200]).send('agentescrow@active');
  await agentcore.actions.register(['agent1', 'A', 'd', 'https://a.test', 'https', '["x"]']).send('agent1@active');
  await agentcore.actions.register(['arb1', 'B', 'd', 'https://b.test', 'https', '["x"]']).send('arb1@active');
  await escrow.actions.regarb(['arb1', 200]).send('arb1@active');
  await token.actions.transfer(['arb1', 'agentescrow', '1000.0000 XPR', 'arbstake']).send('arb1@active');
  await escrow.actions.activatearb(['arb1']).send('arb1@active');
};

const create = (client: string, agent: string, arbitrator = '') =>
  escrow.actions.createjob([client, agent, 'Job', 'd', '["d"]', 1000000, '4,XPR', DEADLINE, arbitrator, 'h']).send(`${client}@active`);

describe('arbitrator conflict of interest', () => {
  beforeEach(setup);

  it('createjob rejects the client as arbitrator', async () => {
    await escrow.actions.regarb(['client', 200]).send('client@active');
    await token.actions.transfer(['client', 'agentescrow', '1000.0000 XPR', 'arbstake']).send('client@active');
    await escrow.actions.activatearb(['client']).send('client@active');
    await expectToThrow(create('client', 'agent1', 'client'), protonAssert("The client cannot be the job's arbitrator"));
  });

  it('createjob rejects the agent as arbitrator', async () => {
    await expectToThrow(create('client', 'arb1', 'arb1'), protonAssert("The agent cannot be the job's arbitrator"));
  });

  it('selectbid rejects hiring the job\'s own arbitrator', async () => {
    await create('client', '', 'arb1'); // open job, arb1 arbitrates
    await escrow.actions.submitbid(['arb1', 0, 1000000, 86400, 'I will do it']).send('arb1@active');
    await expectToThrow(
      escrow.actions.selectbid(['client', 0]).send('client@active'),
      protonAssert("The job's arbitrator cannot be hired on it"),
    );
  });

  it('a normal third-party arbitrator is still accepted', async () => {
    await create('client', 'agent1', 'arb1');
    expect(job(0).arbitrator).to.equal('arb1');
  });
});

describe('unfunded-job cap (openjobs counter)', () => {
  beforeEach(async () => {
    await setup();
    await escrow.actions.setlimits([2, 20, 604800]).send('owner@active');
  });

  it('blocks a third unfunded job, and funding or cancelling frees a slot', async () => {
    await create('client', 'agent1');
    await create('client', 'agent1');
    expect(openCount('client')).to.equal(2);
    await expectToThrow(create('client', 'agent1'), protonAssert('Too many unfunded jobs open (max 2). Fund or cancel one first.'));

    await token.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'fund:0']).send('client@active');
    expect(openCount('client')).to.equal(1);
    await create('client', 'agent1'); // id 2
    expect(openCount('client')).to.equal(2);

    await escrow.actions.cancel(['client', 1]).send('client@active'); // unfunded cancel
    expect(openCount('client')).to.equal(1);
  });

  it('only owner can change limits, within bounds', async () => {
    await expectToThrow(escrow.actions.setlimits([2, 20, 604800]).send('client@active'), 'missing required authority owner');
    await expectToThrow(escrow.actions.setlimits([0, 20, 604800]).send('owner@active'), protonAssert('max_open_jobs must be 1-100'));
  });
});

describe('milestone cap', () => {
  beforeEach(async () => {
    await setup();
    await escrow.actions.setlimits([5, 1, 604800]).send('owner@active'); // cap 1: vert scans 1 row reliably
  });

  it('rejects a milestone beyond the per-job cap', async () => {
    await create('client', 'agent1');
    await escrow.actions.addmilestone(['client', 0, 'M1', 'd', 100000, 0]).send('client@active');
    await expectToThrow(
      escrow.actions.addmilestone(['client', 0, 'M2', 'd', 100000, 1]).send('client@active'),
      protonAssert('Too many milestones on this job (max 1)'),
    );
  });
});

describe('cleanstale', () => {
  beforeEach(async () => {
    await setup();
    await escrow.actions.setlimits([5, 20, 604800]).send('owner@active'); // stale after 7 days
  });

  it('lets anyone remove stale unfunded jobs, leaving funded and fresh jobs alone', async () => {
    await create('client', 'agent1');                 // 0: will go stale, unfunded
    await escrow.actions.addmilestone(['client', 0, 'M', 'd', 100000, 0]).send('client@active');
    await create('client', 'agent1');                 // 1: funded
    await token.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'fund:1']).send('client@active');
    expect(openCount('client')).to.equal(1);

    bc.setTime(TimePointSec.from(BASE + 604800 + 10));
    await escrow.actions.createjob(['client', 'agent1', 'Job', 'd', '["d"]', 1000000, '4,XPR', BASE + 604800 + 86400, '', 'h']).send('client@active'); // 2: fresh

    await escrow.actions.cleanstale([0, 10]).send('agent1@active'); // permissionless
    expect(job(0)).to.equal(undefined);
    expect(escrow.tables.milestones(nameToBigInt(S)).getTableRows().length).to.equal(0);
    expect(job(1).state).to.equal(1);
    expect(job(2).state).to.equal(0);
    expect(openCount('client')).to.equal(1); // only the fresh unfunded job remains counted
  });
});

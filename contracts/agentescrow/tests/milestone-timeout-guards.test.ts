import { expect } from 'chai';
import { Blockchain, mintTokens, nameToBigInt, expectToThrow, protonAssert } from '@proton/vert';
import { TimePointSec } from '@greymass/eosio';

/**
 * Regressions for two audit-round-2 escrow fixes (found by grok + codex):
 *  - approvemile had no job-state guard: a client could release milestone funds
 *    while the job was DISPUTED, shrinking what the arbitrator could split.
 *  - timeout on an undelivered job whose milestones already paid the full balance
 *    tried to send a 0 XPR refund, which the token contract rejects, reverting the
 *    whole tx so the job could never be closed.
 */
const bc = new Blockchain();
const agentcore = bc.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const agentfeed = bc.createContract('agentfeed', '../agentfeed/assembly/target/agentfeed.contract');
const escrow = bc.createContract('agentescrow', 'assembly/target/agentescrow.contract', true);
const token = bc.createContract('eosio.token', 'node_modules/proton-tsc/external/eosio.token/eosio.token');
const accts = bc.createAccounts('owner', 'client', 'agent1');
const S = 'agentescrow';
const job = (id: number) => escrow.tables.jobs(nameToBigInt(S)).getTableRow(BigInt(id));
const nowSec = () => Math.floor(Date.now() / 1000);

const setup = async () => {
  bc.resetTables();
  await mintTokens(token, 'XPR', 4, 1000000000, 100000000, accts);
  await agentcore.actions.init(['owner', 0, 100000, 'agentfeed', '', 'agentescrow']).send('agentcore@active');
  await agentfeed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
  await escrow.actions.init(['owner', 'agentcore', 'agentfeed', 200]).send('agentescrow@active');
  await agentcore.actions.register(['agent1', 'A', 'd', 'https://a.test', 'https', '["x"]']).send('agent1@active');
};

// Create a job with one milestone (milestones must be added BEFORE funding), then
// fund/accept/start it to INPROGRESS (state 3). Returns after startjob.
const toInProgressWithMilestone = async (id: number, amountRaw: number, mileRaw: number, deadline: number) => {
  await escrow.actions.createjob(['client', 'agent1', 'Job', 'd', '["d"]', amountRaw, '4,XPR', deadline, '', 'h']).send('client@active');
  await escrow.actions.addmilestone(['client', id, 'M', 'the milestone', mileRaw, 0]).send('client@active');
  await token.actions.transfer(['client', 'agentescrow', `${(amountRaw / 10000).toFixed(4)} XPR`, `fund:${id}`]).send('client@active');
  await escrow.actions.acceptjob(['agent1', id]).send('agent1@active');
  await escrow.actions.startjob(['agent1', id]).send('agent1@active');
};

describe('approvemile state guard', () => {
  beforeEach(setup);

  it('rejects approving a milestone while the job is DISPUTED', async () => {
    await toInProgressWithMilestone(0, 1000000, 500000, nowSec() + 86400); // 100 XPR job, 50 XPR milestone
    await escrow.actions.submitmile(['agent1', 0, 'ipfs://evidence']).send('agent1@active');
    await escrow.actions.dispute(['client', 0, 'not acceptable', 'ipfs://d']).send('client@active');
    expect(job(0).state).to.equal(5); // DISPUTED

    await expectToThrow(
      escrow.actions.approvemile(['client', 0]).send('client@active'),
      protonAssert('Job must be in progress or delivered to approve a milestone'),
    );
    // milestone stays submitted, nothing released
    expect(Number(job(0).released_amount)).to.equal(0);
  });
});

describe('timeout with milestones covering the full balance', () => {
  beforeEach(setup);

  it('closes an undelivered job as REFUNDED without reverting on a 0 XPR refund', async () => {
    // Anchor the chain clock so the deadline is reachable via addTime (vert's clock
    // is not wall-clock time).
    const base = 1700000000;
    bc.setTime(TimePointSec.from(base));
    const deadline = base + 86400;
    // A single milestone for the FULL amount, approved -> funded == released.
    await toInProgressWithMilestone(0, 1000000, 1000000, deadline);
    await escrow.actions.submitmile(['agent1', 0, 'ipfs://evidence']).send('agent1@active');
    await escrow.actions.approvemile(['client', 0]).send('client@active');
    expect(Number(job(0).released_amount)).to.equal(Number(job(0).funded_amount));
    expect(job(0).state).to.equal(3); // still INPROGRESS (not delivered)

    // Past the deadline, the client claims timeout. Undelivered branch, 0 remaining.
    bc.setTime(TimePointSec.from(deadline + 3600));
    await escrow.actions.timeout(['client', 0]).send('client@active'); // must not revert
    expect(job(0).state).to.equal(7); // REFUNDED
  });
});

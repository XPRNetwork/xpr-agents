import { expect } from 'chai';
import { Blockchain, mintTokens, nameToBigInt } from '@proton/vert';
import { TimePointSec } from '@greymass/eosio';

/**
 * Regressions for GitHub issues filed against the #87 build (Sept 2026):
 *  - #90: cancel() keeps the job row (state 7) and frees the openjobs slot, so a
 *    createjob+cancel loop left permanent rows the cap never saw. cleanstale now also
 *    removes refunded jobs whose escrow is settled once they are older than stale_after.
 *  - #93: arbitrate() paid out without the platform fee, so a cooperative dispute was
 *    a cheaper settlement than approve. The fee now applies to the agent's share,
 *    and stays waived when the owner resolves as fallback.
 */
const bc = new Blockchain();
const agentcore = bc.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const agentfeed = bc.createContract('agentfeed', '../agentfeed/assembly/target/agentfeed.contract');
const escrow = bc.createContract('agentescrow', 'assembly/target/agentescrow.contract', true);
const token = bc.createContract('eosio.token', 'node_modules/proton-tsc/external/eosio.token/eosio.token');
const accts = bc.createAccounts('owner', 'client', 'agent1', 'arb1');
const S = 'agentescrow';
const BASE = 1700000000;
const WEEK = 604800;
const job = (id: number) => escrow.tables.jobs(nameToBigInt(S)).getTableRow(BigInt(id));
const jobs = () => escrow.tables.jobs(nameToBigInt(S)).getTableRows();
const bal = (acct: string): number => {
  const rows = token.tables.accounts(nameToBigInt(acct)).getTableRows();
  return rows.length ? Math.round(parseFloat(String(rows[0].balance)) * 10000) : 0;
};

const setup = async () => {
  bc.resetTables();
  bc.setTime(TimePointSec.from(BASE));
  await mintTokens(token, 'XPR', 4, 1000000000, 100000000, accts);
  await agentcore.actions.init(['owner', 0, 100000, 'agentfeed', '', 'agentescrow']).send('agentcore@active');
  await agentfeed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
  await escrow.actions.init(['owner', 'agentcore', 'agentfeed', 200]).send('agentescrow@active'); // 2% platform fee
  await agentcore.actions.register(['agent1', 'A', 'd', 'https://a.test', 'https', '["x"]']).send('agent1@active');
  await escrow.actions.setlimits([5, 20, WEEK]).send('owner@active');
};

const create = (arbitrator = '', deadline = BASE + 30 * 86400) =>
  escrow.actions.createjob(['client', 'agent1', 'Job', 'd', '["d"]', 1000000, '4,XPR', deadline, arbitrator, 'h']).send('client@active');

describe('#90 cleanstale reclaims settled refunded jobs', () => {
  beforeEach(setup);

  it('removes stale cancelled jobs (unfunded and funded-then-refunded), keeps fresh ones', async () => {
    for (let i = 0; i < 3; i++) {
      await create();
      await escrow.actions.cancel(['client', i]).send('client@active');     // 0-2: unfunded, cancelled
    }
    await create();                                                        // 3: funded, then cancelled
    await token.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'fund:3']).send('client@active');
    await escrow.actions.cancel(['client', 3]).send('client@active');
    await create();                                                        // 4: funded, left open
    await token.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'fund:4']).send('client@active');

    bc.setTime(TimePointSec.from(BASE + WEEK + 10));
    await create('', BASE + WEEK + 86400);                                 // 5: fresh
    await escrow.actions.cancel(['client', 5]).send('client@active');       //    fresh refund, must stay

    await escrow.actions.cleanstale([0, 100]).send('agent1@active');        // permissionless
    expect(jobs().map((r: any) => Number(r.id))).to.deep.equal([4, 5]);
    expect(job(4).state).to.equal(1);                                       // live escrow untouched
  });

  it('does not remove a refunded job before stale_after', async () => {
    await create();
    await escrow.actions.cancel(['client', 0]).send('client@active');
    bc.setTime(TimePointSec.from(BASE + WEEK - 10));
    await escrow.actions.cleanstale([0, 100]).send('agent1@active');
    expect(job(0).state).to.equal(7);
  });
});

describe('#93 arbitrate applies the platform fee', () => {
  const toDisputed = async (id: number, arbitrator: string) => {
    await create(arbitrator);
    await token.actions.transfer(['client', 'agentescrow', '100.0000 XPR', `fund:${id}`]).send('client@active');
    await escrow.actions.acceptjob(['agent1', id]).send('agent1@active');
    await escrow.actions.startjob(['agent1', id]).send('agent1@active');
    await escrow.actions.deliver(['agent1', id, 'ipfs://work']).send('agent1@active');
    await escrow.actions.dispute(['client', id, 'not acceptable', 'ipfs://d']).send('client@active');
  };

  beforeEach(async () => {
    await setup();
    await escrow.actions.regarb(['arb1', 0]).send('arb1@active');           // 0% arbitrator fee
    await token.actions.transfer(['arb1', 'agentescrow', '1000.0000 XPR', 'arbstake']).send('arb1@active');
    await escrow.actions.activatearb(['arb1']).send('arb1@active');
  });

  it('agent-wins ruling pays the agent 98% and the platform 2%, same as approve', async () => {
    await toDisputed(0, 'arb1');
    const agent0 = bal('agent1');
    const owner0 = bal('owner');
    await escrow.actions.arbitrate(['arb1', 0, 0, 'work was delivered']).send('arb1@active');
    expect(bal('agent1') - agent0).to.equal(980000);
    expect(bal('owner') - owner0).to.equal(20000);
    const d = escrow.tables.disputes(nameToBigInt(S)).getTableRow(BigInt(0));
    expect(Number(d.agent_amount)).to.equal(980000);
  });

  it('client-wins ruling takes no platform fee (the client is refunded in full)', async () => {
    await toDisputed(0, 'arb1');
    const client0 = bal('client');
    const owner0 = bal('owner');
    await escrow.actions.arbitrate(['arb1', 0, 100, 'not delivered']).send('arb1@active');
    expect(bal('client') - client0).to.equal(1000000);
    expect(bal('owner') - owner0).to.equal(0);
  });

  it('owner fallback arbitration stays fee-free', async () => {
    await toDisputed(0, '');
    const agent0 = bal('agent1');
    await escrow.actions.arbitrate(['owner', 0, 0, 'work was delivered']).send('owner@active');
    expect(bal('agent1') - agent0).to.equal(1000000);
  });
});

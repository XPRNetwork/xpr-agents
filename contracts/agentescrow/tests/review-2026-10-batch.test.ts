import { expect } from 'chai';
import { Blockchain, mintTokens, nameToBigInt, expectToThrow, protonAssert } from '@proton/vert';
import { Name, TimePointSec } from '@greymass/eosio';

const bc = new Blockchain();
const core = bc.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const feed = bc.createContract('agentfeed', '../agentfeed/assembly/target/agentfeed.contract');
const escrow = bc.createContract('agentescrow', 'assembly/target/agentescrow.contract', true);
const token = bc.createContract('eosio.token', 'node_modules/proton-tsc/external/eosio.token/eosio.token');
const accounts = bc.createAccounts('owner', 'client', 'agent1', 'arb1');
const scope = nameToBigInt('agentescrow');
const T = 1700000000;
const DAY = 86400;
const row = (table: string, id = 0): any => escrow.tables[table](scope).getTableRow(BigInt(id));
const transfer = (memo: string) => token.actions.transfer(['client', 'agentescrow', '100.0000 XPR', memo]).send('client@active');
const create = (arb = '') => escrow.actions.createjob(['client', 'agent1', 'Job', 'd', '["d"]', 1000000, '4,XPR', T + 30 * DAY, arb, 'h']).send('client@active');
const deliver = async (id = 0) => {
  await escrow.actions.acceptjob(['agent1', id]).send('agent1@active');
  await escrow.actions.startjob(['agent1', id]).send('agent1@active');
  await escrow.actions.deliver(['agent1', id, 'ipfs://work']).send('agent1@active');
};
const disputed = async (arb = '') => {
  await create(arb);
  await transfer('fund:0');
  await deliver();
  await escrow.actions.dispute(['client', 0, 'bad work', 'ipfs://dispute']).send('client@active');
};

describe('October 2026 batch: escrow', () => {
  beforeEach(async () => {
    bc.resetTables();
    bc.setTime(TimePointSec.from(T));
    await mintTokens(token, 'XPR', 4, 1000000000, 100000, accounts);
    await core.actions.init(['owner', 0, 100000, 'agentfeed', '', 'agentescrow']).send('agentcore@active');
    await feed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
    await escrow.actions.init(['owner', 'agentcore', 'agentfeed', 200]).send('agentescrow@active');
    await core.actions.register(['agent1', 'A', 'd', 'https://a.test', 'https', '[]']).send('agent1@active');
  });

  for (const prefix of ['fund', 'buy', 'boost']) {
    const label = prefix === 'fund' ? 'Job' : 'Service';
    for (const id of ['18446744073709551616', '18446744073709551617', '99999999999999999999']) {
      it(`${prefix} rejects overflowing ID ${id} before lookup`, async () => {
        await create(); // a wrapped zero would target this job
        await expectToThrow(transfer(`${prefix}:${id}`), protonAssert(`${label} ID exceeds u64 max`));
        expect(Number(row('jobs').funded_amount)).to.equal(0);
      });
    }
    for (const id of ['', '0'.repeat(21), '-1', '+0', ' 0', '0 ', '0x0', '0junk', '1.0']) {
      it(`${prefix} rejects malformed ID ${JSON.stringify(id)}`, async () => {
        const message = id.length === 0 || id.length > 20 ? `Invalid ${label.toLowerCase()} ID format` : `${label} ID must be numeric`;
        await expectToThrow(transfer(`${prefix}:${id}`), protonAssert(message));
      });
    }
    it(`${prefix} accepts u64 max without wrapping`, async () => {
      await expectToThrow(transfer(`${prefix}:18446744073709551615`), protonAssert(`${label} not found`));
    });
  }

  it('accepts zero-padded IDs and buy notes containing colons', async () => {
    await create();
    await transfer('fund:00000000000000000000');
    await deliver();
    await escrow.actions.approve(['client', 0]).send('client@active');
    await escrow.actions.setsvcconfig([0, 10000, 10000]).send('owner@active');
    await escrow.actions.listsvc(['agent1', 'Service', 'd', '["d"]', 1000000, DAY, 'image', '']).send('agent1@active');
    await transfer('buy:00000000000000000000:notes:with:colons');
    expect(row('jobs', 1).state).to.equal(1);
    await transfer('boost:00000000000000000000');
    expect(Number(row('services').boost_paid)).to.equal(1000000);
  });

  for (const party of ['client', 'agent1']) {
    for (const branch of ['no arbitrator', 'unavailable arbitrator', 'designated party', 'timeout']) {
      it(`rejects ${party} resolving via ${branch}`, async () => {
        if (branch === 'unavailable arbitrator') {
          await escrow.actions.regarb(['arb1', 0]).send('arb1@active');
          await token.actions.transfer(['arb1', 'agentescrow', '1000.0000 XPR', 'arbstake']).send('arb1@active');
          await escrow.actions.activatearb(['arb1']).send('arb1@active');
        }
        await disputed(branch === 'unavailable arbitrator' ? 'arb1' : '');
        if (branch === 'unavailable arbitrator') {
          // Make the designee unavailable by raising the minimum stake.
          await escrow.actions.setconfig([200, 10000, 30, 604800, false, 'agentcore', 'agentfeed', 604800, 20000000, 604800]).send('owner@active');
        }
        if (branch === 'designated party') {
          // Legacy jobs could designate a party before createjob gained its guard.
          escrow.tables.jobs(scope).set(0n, Name.from('agentescrow'), { ...row('jobs'), arbitrator: party });
        }
        await escrow.actions.setowner([party]).send('owner@active');
        const before = row('jobs');
        // The owner may only concede everything to the other side; a designated party never resolves.
        const msg = branch === 'designated party' ? 'A party to the job cannot arbitrate it'
          : party === 'client' ? 'Owner is the client: it can only award the agent' : 'Owner is the agent: it can only refund the client';
        const resolve = (pct: number) => branch === 'timeout'
          ? escrow.actions.resolvetmout([0, pct, 'ruling']).send(`${party}@active`)
          : escrow.actions.arbitrate([party, 0, pct, 'ruling']).send(`${party}@active`);
        if (branch === 'timeout') bc.setTime(TimePointSec.from(T + 14 * DAY));
        for (const pct of party === 'client' ? [100, 50] : [0, 50]) {
          await expectToThrow(resolve(pct), protonAssert(msg));
        }
        expect(row('jobs')).to.deep.equal(before);
        expect(Number(row('disputes').resolution)).to.equal(0);
        if (branch !== 'designated party') {
          await resolve(party === 'client' ? 0 : 100);
          expect(row('jobs').state).to.equal(8);
          expect(Number(row('disputes').resolution)).to.equal(party === 'client' ? 2 : 1);
        }
      });
    }
  }

  it('allows an unrelated owner to resolve after timeout', async () => {
    await disputed();
    bc.setTime(TimePointSec.from(T + 14 * DAY));
    await escrow.actions.resolvetmout([0, 50, 'ruling']).send('owner@active');
    expect(row('jobs').state).to.equal(8);
  });

  for (const terminal of ['completed', 'refunded', 'arbitrated']) {
    it(`cleanjobs removes evidence for ${terminal} jobs and retains live evidence`, async () => {
      await create();
      await transfer('fund:0');
      await deliver();
      if (terminal === 'completed') {
        await escrow.actions.approve(['client', 0]).send('client@active');
      } else {
        await escrow.actions.dispute(['client', 0, 'bad work', '']).send('client@active');
        await escrow.actions.arbitrate(['owner', 0, terminal === 'refunded' ? 100 : 50, 'ruling']).send('owner@active');
        if (terminal === 'refunded') {
          // Legacy refunded jobs may still carry delivery evidence.
          escrow.tables.jobs(scope).set(0n, Name.from('agentescrow'), { ...row('jobs'), state: 7 });
        }
      }
      await create();
      await transfer('fund:1');
      await deliver(1);
      expect(row('jobevidence')).to.not.equal(undefined);
      bc.setTime(TimePointSec.from(T + 91 * DAY));
      await escrow.actions.cleanjobs([90 * DAY, 100]).send('owner@active');
      expect(row('jobs')).to.equal(undefined);
      expect(row('jobevidence')).to.equal(undefined);
      expect(row('jobevidence', 1).evidence_uri).to.equal('ipfs://work');
      expect(row('jobs', 1).state).to.equal(4);
    });
  }
});

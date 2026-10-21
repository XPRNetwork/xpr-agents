import { expect } from 'chai';
import { Blockchain, nameToBigInt, expectToThrow, protonAssert } from '@proton/vert';
import { TimePointSec } from '@greymass/eosio';

const bc = new Blockchain();
const core = bc.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const feed = bc.createContract('agentfeed', 'assembly/target/agentfeed.contract');
bc.createAccounts('owner', 'alice', 'reviewer1', 'reviewer2', 'reviewer3', 'provider', 'outsider');
const scope = nameToBigInt('agentfeed');
const T = 1700000000;
const DAY = 86400;
const rows = (table: string): any[] => feed.tables[table](scope).getTableRows();
const score = (): any => feed.tables.agentscores(scope).getTableRow(nameToBigInt('alice'));
const totals = () => {
  const s = score();
  return [s.total_score, s.total_weight, s.feedback_count, s.avg_score].map(Number);
};
const submit = (who: string, stars = 5, kind = 'submit') => {
  const args: any[] = kind === 'submitwpay'
    ? [who, 'alice', stars, '', `job-${who}`, '', 'a'.repeat(64), 10000, 'XPR']
    : kind === 'submitctx'
      ? [who, 'alice', 'ai', stars, '', `job-${who}`, '', 0]
      : [who, 'alice', stars, '', `job-${who}`, '', 0];
  return feed.actions[kind](args).send(`${who}@active`);
};
const dispute = (id = 0) => feed.actions.dispute(['alice', id, 'incorrect', '']).send('alice@active');
const resolve = (upheld = true, id = 0) => feed.actions.resolve(['owner', id, upheld, 'ruling']).send('owner@active');
const recalc = () => feed.actions.recalc(['alice', 0, 100]).send('alice@active');

describe('October 2026 batch: feedback', () => {
  beforeEach(async () => {
    bc.resetTables();
    bc.setTime(TimePointSec.from(T));
    await core.actions.init(['owner', 0, 100000, 'agentfeed', '', '']).send('agentcore@active');
    await feed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
    await core.actions.register(['alice', 'A', 'd', 'https://a.test', 'https', '[]']).send('alice@active');
  });

  for (const sender of ['owner', 'provider']) {
    it(`submitext requires a registered agent when authorized by ${sender}`, async () => {
      await feed.actions.addprovider(['p', 'provider', '', 100]).send('owner@active');
      for (const target of ['outsider', 'nonexistent']) {
        await expectToThrow(feed.actions.submitext([sender, target, 0, 8000, '80', '']).send(`${sender}@active`), protonAssert('Agent not registered in agentcore'));
      }
      expect(rows('extscores')).to.have.length(0);
      await feed.actions.submitext([sender, 'alice', 0, 8000, '80', '']).send(`${sender}@active`);
      await feed.actions.submitext([sender, 'alice', 0, 9000, '90', '']).send(`${sender}@active`);
      expect(rows('extscores')).to.have.length(1);
      expect(Number(rows('extscores')[0].score)).to.equal(9000);
    });
  }

  it('dispute cleanup cannot restore upheld feedback during a later recalc', async () => {
    // One feedback avoids vert's duplicate-secondary lookup issue after row updates.
    await submit('reviewer1', 1);
    await dispute();
    await resolve();
    expect(totals()).to.deep.equal([0, 0, 0, 0]);
    bc.setTime(TimePointSec.from(T + 91 * DAY));
    await feed.actions.cleandisps([90 * DAY, 100]).send('owner@active');
    await recalc();
    expect(totals()).to.deep.equal([0, 0, 0, 0]);
    expect(rows('disputes')).to.have.length(1);
    // Once feedback is gone, its dispute no longer carries scoring state.
    await feed.actions.cleanfback(['alice', 90 * DAY, 100]).send('owner@active');
    expect(rows('feedback')).to.have.length(0);
    await feed.actions.cleandisps([90 * DAY, 100]).send('owner@active');
    expect(rows('disputes')).to.have.length(0);
  });

  it('reinstating a rejected dispute cannot restore a failed payment proof to scores', async () => {
    await submit('reviewer1', 1, 'submitwpay');
    await submit('reviewer2', 5);
    await dispute();
    await resolve(false);
    await feed.actions.verifypay(['owner', 0, 123, false]).send('owner@active');
    expect(totals()).to.deep.equal([5, 5, 1, 10000]);
    await feed.actions.reinstate([0]).send('owner@active');
    await recalc();
    expect(totals()).to.deep.equal([5, 5, 1, 10000]);
  });

  // Never exceed two feedback rows per agent: vert skips the first at three.
  for (const removal of ['rmfeedback', 'cleanfback']) {
    it(`submission rebuilds all surviving feedback after ${removal} invalidates agentscores`, async () => {
      await submit('reviewer1', 1);
      bc.setTime(TimePointSec.from(T + 2 * DAY));
      await submit('reviewer2', 5);
      if (removal === 'rmfeedback') {
        await feed.actions.rmfeedback([0]).send('owner@active');
      } else {
        bc.setTime(TimePointSec.from(T + 91 * DAY));
        await feed.actions.cleanfback(['alice', 90 * DAY, 100]).send('owner@active');
      }
      expect(rows('feedback')).to.have.length(1);
      expect(score()).to.equal(undefined);
      await submit('reviewer3', 1);
      expect(totals()).to.deep.equal([6, 10, 2, 6000]);
      const before = totals();
      await recalc();
      expect(totals()).to.deep.equal(before);
    });
  }

  for (const kind of ['submitwpay', 'submitctx']) {
    it(`${kind} recreates an invalidated score when no feedback survives`, async () => {
      await submit('reviewer1', 5);
      await feed.actions.rmfeedback([0]).send('owner@active');
      await submit('reviewer2', 1, kind);
      expect(totals()).to.deep.equal([1, 5, 1, 2000]);
      await recalc();
      expect(totals()).to.deep.equal([1, 5, 1, 2000]);
    });
  }

  it('plain and paid submissions use the same weight through verification, dispute and recalc', async () => {
    await submit('reviewer1', 1, 'submitwpay');
    await submit('reviewer2', 5);
    expect(totals()).to.deep.equal([6, 10, 2, 6000]);
    await feed.actions.verifypay(['owner', 0, 123, true]).send('owner@active');
    await dispute();
    await recalc();
    expect(totals()).to.deep.equal([6, 10, 2, 6000]);
    await resolve();
    expect(totals()).to.deep.equal([5, 5, 1, 10000]);
    await recalc();
    expect(totals()).to.deep.equal([5, 5, 1, 10000]);
  });
});

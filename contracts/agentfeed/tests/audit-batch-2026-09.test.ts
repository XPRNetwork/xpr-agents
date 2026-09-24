import { expect } from 'chai';
import { Blockchain, nameToBigInt, expectToThrow, protonAssert } from '@proton/vert';
import { TimePointSec } from '@greymass/eosio';

/**
 * September 2026 external reports (agentfeed):
 *  - AGENTFEED-PAYPROOF-NO-REMOVE: verifypay(false) only flagged the paid review; its
 *    score stayed counted (and recalc re-counted it). Now the review is excluded from
 *    scoring everywhere and the aggregate is recomputed; a proof is decided once.
 *  - Decay/resolve weight mismatch: resolve(upheld) subtracted the undecayed weight
 *    from totals that recalc had stored with decayed weights (avg could exceed 100%).
 *    resolve now rebuilds the aggregate with the same rules as recalc. The test env
 *    has no KYC table (every reviewer is KYC 0), so it asserts the invariant: after
 *    an upheld dispute the stored score equals a fresh full recalc and stays <= 100%.
 */
const bc = new Blockchain();
const agentcore = bc.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const feed = bc.createContract('agentfeed', 'assembly/target/agentfeed.contract');
bc.createAccounts('owner', 'alice', 'reviewer1', 'reviewer2');
const S = 'agentfeed';

const score = (a: string): any => feed.tables.agentscores(nameToBigInt(S)).getTableRow(nameToBigInt(a));
const snap = (a: string) => {
  const s = score(a);
  return { total_score: Number(s.total_score), total_weight: Number(s.total_weight), count: Number(s.feedback_count), avg: Number(s.avg_score) };
};
const lastDisputeId = (): number => Number(feed.tables.disputes(nameToBigInt(S)).getTableRows().slice(-1)[0].id);
const proofId = (): number => Number(feed.tables.payproofs(nameToBigInt(S)).getTableRows().slice(-1)[0].id);

const setup = async () => {
  bc.resetTables();
  bc.setTime(TimePointSec.from(1700000000));
  await agentcore.actions.init(['owner', 0, 100000, 'agentfeed', '', '']).send('agentcore@active');
  await feed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
  await agentcore.actions.register(['alice', 'A', 'd', 'https://a.test', 'https', '["chat"]']).send('alice@active');
};

describe('verifypay(false) removes the paid review from scoring', () => {
  beforeEach(setup);

  it('recomputes the score without it, recalc agrees, and a proof is decided once', async () => {
    // Paid review first (id 0), honest review second (id 1). Order matters only for the
    // @proton/vert simulator: after a row update its duplicate-secondary-key scan starts
    // at the updated row and drops the other. nodeos orders by primary key, as recalc
    // relies on in production.
    await feed.actions.submitwpay(['reviewer2', 'alice', 5, 'paid', 'job1', '', 'faketx', 10000000, 'XPR'])
      .send('reviewer2@active');                                                                                // id 0
    await feed.actions.submit(['reviewer1', 'alice', 2, 'ok', 'job0', '', 0]).send('reviewer1@active');       // id 1
    expect(snap('alice').count).to.equal(2);

    await feed.actions.verifypay(['owner', proofId(), 0, false]).send('owner@active');
    const after = snap('alice');
    expect(after.count).to.equal(1);           // only the honest review counts now
    expect(after.avg).to.equal(4000);          // score 2 of 5

    await feed.actions.recalc(['alice', 0, 100]).send('alice@active');
    expect(snap('alice')).to.deep.equal({ ...after, avg: after.avg }); // recalc excludes it too

    await expectToThrow(
      feed.actions.verifypay(['owner', proofId(), 0, false]).send('owner@active'),
      protonAssert('Payment proof already processed'),
    );
  });

  it('a verified payment keeps the review counted', async () => {
    await feed.actions.submitwpay(['reviewer2', 'alice', 5, 'paid', 'job1', '', 'realtx', 10000000, 'XPR']).send('reviewer2@active');
    await feed.actions.verifypay(['owner', proofId(), 123, true]).send('owner@active');
    expect(snap('alice').count).to.equal(1);
  });
});

describe('resolve(upheld) matches a fresh recalc after decay', () => {
  beforeEach(async () => {
    await setup();
    await feed.actions.setconfig(['agentcore', 1, 5, 86400, 3600, 50, false, 0]).send('owner@active'); // 1h decay periods
  });

  it('stored score equals a full recalc and never exceeds 100%', async () => {
    await feed.actions.submit(['reviewer1', 'alice', 1, 'bad', 'job0', '', 0]).send('reviewer1@active');  // id 0
    await feed.actions.submit(['reviewer2', 'alice', 5, 'good', 'job1', '', 0]).send('reviewer2@active'); // id 1

    bc.addTime(TimePointSec.from(40000));                              // ~11 decay periods
    await feed.actions.recalc(['alice', 0, 100]).send('alice@active'); // commits decayed weights

    await feed.actions.dispute(['alice', 0, 'unfair', 'ev']).send('alice@active');
    await feed.actions.resolve(['owner', lastDisputeId(), true, 'upheld']).send('owner@active');
    const afterResolve = snap('alice');
    expect(afterResolve.avg).to.be.at.most(10000);

    await feed.actions.recalc(['alice', 0, 100]).send('alice@active');
    const fresh = snap('alice');
    expect(afterResolve.total_score).to.equal(fresh.total_score);
    expect(afterResolve.total_weight).to.equal(fresh.total_weight);
    expect(afterResolve.count).to.equal(fresh.count);
    expect(fresh.avg).to.equal(10000); // only the 5-star review remains
  });
});

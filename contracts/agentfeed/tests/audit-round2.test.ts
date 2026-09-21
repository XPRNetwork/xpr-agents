import { expect } from 'chai';
import { Blockchain, nameToBigInt } from '@proton/vert';
import { TimePointSec } from '@greymass/eosio';

/**
 * Audit round 2 (grok + codex) agentfeed regressions:
 *  #10 resolve() invalidates an in-flight paginated recalc (else the recalc's
 *      partial total restores feedback a dispute just removed).
 *  #11 recalc decay weight is floored at 1 (else a KYC-0 review truncates to
 *      weight 0 and silently vanishes from the score).
 *  #5  calcaggtrust writes the combined score to the `aggtrust` table, NOT to
 *      agentscores.avg_score (which native submit/resolve/recalc recompute).
 */
const bc = new Blockchain();
const agentcore = bc.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const feed = bc.createContract('agentfeed', 'assembly/target/agentfeed.contract');
bc.createAccounts('owner', 'alice', 'reviewer1', 'reviewer2');
const S = 'agentfeed';

const agentScore = (a: string): any => feed.tables.agentscores(nameToBigInt(S)).getTableRow(nameToBigInt(a));
const recalcState = (a: string): any => feed.tables.recalcstate(nameToBigInt(S)).getTableRow(nameToBigInt(a));
const aggTrust = (a: string): any => feed.tables.aggtrust(nameToBigInt(S)).getTableRow(nameToBigInt(a));
const lastDisputeId = (): number => Number(feed.tables.disputes(nameToBigInt(S)).getTableRows().slice(-1)[0].id);

const setup = async () => {
  bc.resetTables();
  await agentcore.actions.init(['owner', 0, 100000, 'agentfeed', '', '']).send('agentcore@active');
  await feed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
  await agentcore.actions.register(['alice', 'A', 'd', 'https://a.test', 'https', '["chat"]']).send('alice@active');
};

describe('agentfeed audit round 2', () => {
  describe('#10 resolve() invalidates an in-flight recalc', () => {
    beforeEach(setup);

    it('deletes the recalcstate when a dispute is upheld mid-recalc, so the removed feedback is not restored', async () => {
      await feed.actions.submit(['reviewer1', 'alice', 5, 'good', 'job0', '', 0]).send('reviewer1@active'); // id 0
      await feed.actions.submit(['reviewer2', 'alice', 5, 'good', 'job1', '', 0]).send('reviewer2@active'); // id 1

      // Start a paginated recalc that counts only the first feedback (id 0).
      await feed.actions.recalc(['alice', 0, 1]).send('alice@active');
      expect(recalcState('alice'), 'recalc is in flight').to.not.equal(undefined);

      // Uphold a dispute on feedback 0 (already counted in the partial recalc).
      await feed.actions.dispute(['alice', 0, 'unfair', 'ev']).send('alice@active');
      await feed.actions.resolve(['owner', lastDisputeId(), true, 'removed']).send('owner@active');

      // FIX: the in-flight recalc is abandoned, so it cannot recommit feedback 0.
      expect(recalcState('alice'), 'recalcstate invalidated').to.equal(undefined);

      // A fresh full recalc reflects only the surviving feedback (id 1): count 1.
      await feed.actions.recalc(['alice', 0, 100]).send('alice@active');
      expect(Number(agentScore('alice').feedback_count)).to.equal(1);
    });
  });

  describe('#11 recalc decay weight floor', () => {
    beforeEach(async () => {
      await setup();
      // Short decay period + 50% floor so a KYC-0 review fully decays to the floor.
      await feed.actions.setconfig(['agentcore', 1, 5, 86400, 3600, 50, false, 0]).send('owner@active');
    });

    it('keeps a fully-decayed KYC-0 review in the score (weight floored at 1, not truncated to 0)', async () => {
      bc.setTime(TimePointSec.from(1700000000));
      await feed.actions.submit(['reviewer1', 'alice', 5, 'good', 'job0', '', 0]).send('reviewer1@active');
      // Age it far past the decay period so decayFactor collapses to the 50% floor.
      bc.setTime(TimePointSec.from(1700000000 + 3600 * 100));
      await feed.actions.recalc(['alice', 0, 100]).send('alice@active');

      const s = agentScore('alice');
      expect(Number(s.feedback_count)).to.equal(1);
      // Pre-fix: (1 * 50) / 100 = 0 -> total_weight 0, avg 0 (review vanishes).
      expect(Number(s.total_weight), 'review still carries weight').to.be.greaterThan(0);
      expect(Number(s.avg_score), 'review still scored').to.be.greaterThan(0);
    });
  });

  describe('#5 calcaggtrust does not overwrite native avg_score', () => {
    beforeEach(setup);

    it('stores the combined score in aggtrust and leaves agentscores.avg_score native', async () => {
      // Native: one 5-star review (KYC 0) -> avg_score 10000 (100%).
      await feed.actions.submit(['reviewer1', 'alice', 5, 'good', 'job0', '', 0]).send('reviewer1@active');
      const nativeAvg = Number(agentScore('alice').avg_score);
      expect(nativeAvg).to.equal(10000);

      // An external provider scores alice 4000 (40%).
      await feed.actions.addprovider(['ext', 'owner', '', 100]).send('owner@active'); // provider id 0
      await feed.actions.submitext(['owner', 'alice', 0, 4000, '40', '']).send('owner@active');

      await feed.actions.calcaggtrust(['alice']).send('alice@active');

      // Combined = 60% native + 40% external = (10000*60 + 4000*40)/100 = 7600.
      expect(aggTrust('alice'), 'aggtrust row created').to.not.equal(undefined);
      expect(Number(aggTrust('alice').combined_score)).to.equal(7600);
      // FIX: native avg_score is untouched (pre-fix it would be clobbered to 7600).
      expect(Number(agentScore('alice').avg_score)).to.equal(nativeAvg);

      // And a later native submit does not wipe the persisted aggregate.
      await feed.actions.submit(['reviewer2', 'alice', 5, 'good', 'job1', '', 0]).send('reviewer2@active');
      expect(Number(aggTrust('alice').combined_score)).to.equal(7600);
    });
  });
});

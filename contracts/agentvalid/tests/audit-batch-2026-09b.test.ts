import { expect } from 'chai';
import { Blockchain, mintTokens, nameToBigInt, expectToThrow, protonAssert } from '@proton/vert';
import { TimePointSec } from '@greymass/eosio';

/**
 * Regression for GitHub issue #91 (Sept 2026): challenge() is free until funded, there
 * was no limit per account, and cancelchal/expireunfund only flagged the row, so one
 * account could fill agentvalid's RAM. Now each challenger may hold 3 unfunded
 * challenges, cancelled/expired unfunded challenges delete their row, and challenge
 * ids come from a monotonic counter so a deleted id is never handed out again.
 */
const bc = new Blockchain();
const agentcore = bc.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const agentvalid = bc.createContract('agentvalid', 'assembly/target/agentvalid.contract', true);
const eosioToken = bc.createContract('eosio.token', 'node_modules/proton-tsc/external/eosio.token/eosio.token');
const accts = bc.createAccounts('owner', 'alice', 'validator1', 'challenger1', 'challenger2');
const V = 'agentvalid';
const BASE = 1700000000;
const chals = () => agentvalid.tables.challenges(nameToBigInt(V)).getTableRows() as any[];
const ids = () => chals().map((r) => Number(r.id));
const openCount = (c: string) => {
  const r = agentvalid.tables.openchals(nameToBigInt(V)).getTableRow(nameToBigInt(c));
  return r ? Number(r.count) : 0;
};
const challenge = (who: string, tag: string, validationId = 0) =>
  agentvalid.actions.challenge([who, validationId, `bad ${tag}`, 'ipfs://e']).send(`${who}@active`);
const CAP_MSG = 'Too many unfunded challenges open (max 3). Fund or cancel one first.';

describe('#91 unfunded challenge cap and row removal', () => {
  beforeEach(async () => {
    bc.resetTables();
    bc.setTime(TimePointSec.from(BASE));
    await mintTokens(eosioToken, 'XPR', 4, 1000000000, 100000, accts);
    await agentcore.actions.init(['owner', 0, 100000, '', 'agentvalid', '']).send('agentcore@active');
    await agentvalid.actions.init(['owner', 'agentcore', 10000]).send('agentvalid@active');
    await agentvalid.actions.setconfig(['agentcore', 10000, 50000, 86400, 172800, 1000, 172800, 604800, false, 0]).send('owner@active');
    await agentcore.actions.register(['alice', 'A', 'd', 'https://a.test', 'https', '["chat"]']).send('alice@active');
    await agentvalid.actions.regval(['validator1', 'manual', '["ai"]']).send('validator1@active');
    await eosioToken.actions.transfer(['validator1', 'agentvalid', '10.0000 XPR', 'stake']).send('validator1@active');
    await agentvalid.actions.validate(['validator1', 'alice', 'jobhash', 1, 95, 'ipfs://v']).send('validator1@active');
  });

  it('caps unfunded challenges per challenger, not per validation', async () => {
    await challenge('challenger1', 'a');
    await challenge('challenger1', 'b');
    await challenge('challenger1', 'c');
    expect(openCount('challenger1')).to.equal(3);
    await expectToThrow(challenge('challenger1', 'd'), protonAssert(CAP_MSG));
    // another account can still challenge the same validation (no per-validation blocking)
    await challenge('challenger2', 'e');
    expect(chals().length).to.equal(4);
  });

  it('funding frees a slot', async () => {
    for (const t of ['a', 'b', 'c']) await challenge('challenger1', t);
    await eosioToken.actions.transfer(['challenger1', 'agentvalid', '5.0000 XPR', 'challenge:0']).send('challenger1@active');
    expect(openCount('challenger1')).to.equal(2);
    // validation 0 now has a funded challenge; the freed slot is used on another validation
    await agentvalid.actions.validate(['validator1', 'alice', 'jobhash2', 1, 90, 'ipfs://v2']).send('validator1@active');
    await challenge('challenger1', 'd', 1);
    expect(openCount('challenger1')).to.equal(3);
  });

  it('expireunfund deletes the row, frees the slot, and the id is never reused', async () => {
    for (const t of ['a', 'b', 'c']) await challenge('challenger1', t); // ids 0,1,2
    bc.setTime(TimePointSec.from(BASE + 86400 + 10));
    await agentvalid.actions.expireunfund([2]).send('challenger2@active');   // newest id, permissionless
    expect(ids()).to.deep.equal([0, 1]);
    expect(openCount('challenger1')).to.equal(2);

    await challenge('challenger1', 'd');
    expect(ids()).to.deep.equal([0, 1, 3]);                                   // not 2 again
  });

  it('cancelchal (within the grace hour) deletes the row and frees the slot', async () => {
    for (const t of ['a', 'b', 'c']) await challenge('challenger1', t);
    await agentvalid.actions.cancelchal(['challenger1', 1]).send('challenger1@active');
    expect(ids()).to.deep.equal([0, 2]);
    expect(openCount('challenger1')).to.equal(2);
  });
});

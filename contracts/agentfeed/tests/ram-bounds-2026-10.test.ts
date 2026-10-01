import { expect } from 'chai';
import { Blockchain, nameToBigInt } from '@proton/vert';
import { TimePointSec } from '@greymass/eosio';

/**
 * October 2026 review: three agentfeed actions stored caller-supplied data on contract RAM
 * without bounds. submitwpay skipped the string limits submit/submitctx enforce, submitext
 * had none, and settrust accepted any trustee name, so one account could grow the contract's
 * RAM without limit. Each action now rejects oversized input and settrust needs a registered agent.
 */
const bc = new Blockchain();
const core = bc.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const feed = bc.createContract('agentfeed', 'assembly/target/agentfeed.contract', true);
bc.createAccounts('owner', 'alice', 'bob', 'reviewer1', 'outsider');

const T = 1700000000;
const rows = (t: string): any[] => feed.tables[t](nameToBigInt('agentfeed')).getTableRows();
const rejected = async (action: Promise<any>, message: string) => {
  let error: any;
  try { await action; } catch (e) { error = e; }
  expect(error, 'action must reject').to.not.equal(undefined);
  expect(String(error.message)).to.include(message);
};
// submitwpay args: reviewer, agent, score, tags, job_hash, evidence_uri, payment_tx_id, payment_amount, payment_symbol
const paidArgs = (): any[] => ['reviewer1', 'alice', 5, '', 'job', '', 'a'.repeat(64), 10000, 'XPR'];

describe('agentfeed RAM bounds (October 2026 review)', () => {
  beforeEach(async () => {
    bc.resetTables();
    bc.setTime(TimePointSec.from(T));
    await core.actions.init(['owner', 0, 100000, 'agentfeed', '', '']).send('agentcore@active');
    await feed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
    await core.actions.register(['alice', 'Alice', 'd', 'https://a.test', 'https', '["chat"]']).send('alice@active');
  });

  const paidCases: [string, number, string, string][] = [
    ['tags', 3, 'x'.repeat(257), 'Tags too long'],
    ['job_hash', 4, 'x'.repeat(129), 'Job hash too long'],
    ['evidence_uri', 5, 'x'.repeat(257), 'Evidence URI too long'],
    ['payment_symbol', 8, 'x'.repeat(8), 'Invalid payment symbol'],
    ['payment_symbol (empty)', 8, '', 'Invalid payment symbol'],
  ];
  for (const [field, index, value, message] of paidCases) {
    it(`submitwpay rejects an oversized ${field}`, async () => {
      const args = paidArgs();
      args[index] = value;
      await rejected(feed.actions.submitwpay(args).send('reviewer1@active'), message);
      expect(rows('feedback')).to.have.length(0);
      expect(rows('payproofs')).to.have.length(0);
    });
  }

  it('submitwpay still accepts input at the limits', async () => {
    const args = paidArgs();
    args[3] = 'x'.repeat(256);
    args[4] = 'x'.repeat(128);
    args[5] = 'x'.repeat(256);
    args[8] = 'XPRUSDC';
    await feed.actions.submitwpay(args).send('reviewer1@active');
    expect(rows('feedback')).to.have.length(1);
    expect(rows('payproofs')).to.have.length(1);
  });

  it('submitext rejects an oversized raw_score or proof_uri and accepts the limits', async () => {
    await feed.actions.addprovider(['p', 'bob', '', 100]).send('owner@active');
    await rejected(
      feed.actions.submitext(['bob', 'alice', 0, 10000, 'x'.repeat(65), '']).send('bob@active'),
      'Raw score too long'
    );
    await rejected(
      feed.actions.submitext(['bob', 'alice', 0, 10000, '', 'x'.repeat(257)]).send('bob@active'),
      'Proof URI too long'
    );
    expect(rows('extscores')).to.have.length(0);
    await feed.actions.submitext(['bob', 'alice', 0, 10000, 'x'.repeat(64), 'x'.repeat(256)]).send('bob@active');
    expect(rows('extscores')).to.have.length(1);
  });

  it('settrust rejects a trustee that is not a registered agent', async () => {
    await rejected(
      feed.actions.settrust(['outsider', 'ghost', 1]).send('outsider@active'),
      'Agent not registered in agentcore'
    );
    await rejected(
      feed.actions.settrust(['outsider', 'bob', 1]).send('outsider@active'),
      'Agent not registered in agentcore'
    );
    expect(rows('dirtrust')).to.have.length(0);
  });

  it('settrust can still update an existing row after the agent is removed', async () => {
    await feed.actions.settrust(['outsider', 'alice', 10]).send('outsider@active');
    await core.actions.removeagent(['alice']).send('owner@active');
    await feed.actions.settrust(['outsider', 'alice', -20]).send('outsider@active');
    const trust = rows('dirtrust');
    expect(trust).to.have.length(1);
    expect(Number(trust[0].trust_score)).to.equal(-10);
  });

  it('submitwpay checks input before the feedback fee requirement', async () => {
    await feed.actions.setconfig(['agentcore', 1, 5, 604800, 3600, 50, false, 10000]).send('owner@active');
    const args = paidArgs();
    args[3] = 'x'.repeat(257);
    await rejected(feed.actions.submitwpay(args).send('reviewer1@active'), 'Tags too long');
  });

  it('settrust still records trust in a registered agent', async () => {
    await feed.actions.settrust(['outsider', 'alice', 10]).send('outsider@active');
    await feed.actions.settrust(['outsider', 'alice', 5]).send('outsider@active');
    const trust = rows('dirtrust');
    expect(trust).to.have.length(1);
    expect(Number(trust[0].trust_score)).to.equal(15);
    expect(Number(trust[0].interactions)).to.equal(2);
  });
});

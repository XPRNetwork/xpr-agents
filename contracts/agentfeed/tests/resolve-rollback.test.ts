import { expect } from 'chai';
import { Blockchain, nameToBigInt } from '@proton/vert';
const bc = new Blockchain();
const agentcore = bc.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const feed = bc.createContract('agentfeed', 'assembly/target/agentfeed.contract');
bc.createAccounts('owner', 'alice', 'reviewer1', 'griefer');
const S = 'agentfeed';
const ctxRows = () => feed.tables.ctxscores(nameToBigInt(S)).getTableRows();
const trustRows = () => feed.tables.dirtrust(nameToBigInt(S)).getTableRows();
const fbRows = () => feed.tables.feedback(nameToBigInt(S)).getTableRows();
const kindRows = () => feed.tables.fbkinds(nameToBigInt(S)).getTableRows();
const ctxAvg = (agent: string, context: string) => { const r = ctxRows().find((x:any)=>x.agent===agent && x.context===context); return r ? Number(r.avg_score) : null; };
const trustFor = (truster: string, trustee: string) => { const r = trustRows().find((x:any)=>x.truster===truster && x.trustee===trustee); return r ? Number(r.trust_score) : null; };
const lastFbId = () => Number(fbRows().slice(-1)[0].id);
const openDisputeId = (): number => Number(feed.tables.disputes(nameToBigInt(S)).getTableRows().slice(-1)[0].id);

const setup = async () => {
  await agentcore.actions.init(['owner', 0, 100000, 'agentfeed', '', '']).send('agentcore@active');
  await feed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
  await agentcore.actions.register(['alice', 'A', 'd', 'https://a.test', 'https', '["chat"]']).send('alice@active');
};

describe('agentfeed resolve() reputation-rollback regression', () => {
  beforeEach(async () => { bc.resetTables(); await setup(); });

  it('a disputed PLAIN review tagged like a context does NOT corrupt context/trust reputation', async () => {
    // reviewer1 builds alice's legit "ai" context reputation + directional trust.
    await feed.actions.submitctx(['reviewer1', 'alice', 'ai', 5, 'great', 'job1', '', 0]).send('reviewer1@active');
    const ctxBefore = ctxAvg('alice', 'ai');
    const trustBefore = trustFor('reviewer1', 'alice');
    expect(ctxBefore).to.be.greaterThan(0);
    expect(trustBefore).to.not.equal(null);

    // griefer posts a PLAIN review whose tags merely look like a context ("ai:slow").
    await feed.actions.submit(['griefer', 'alice', 1, 'ai:slow', 'job2', '', 0]).send('griefer@active');
    const plainId = lastFbId();
    expect(kindRows().find((k:any)=>Number(k.feedback_id)===plainId)).to.equal(undefined); // no kind row for plain

    // alice disputes it, owner upholds.
    await feed.actions.dispute(['alice', plainId, 'unfair', 'ev']).send('alice@active');
    await feed.actions.resolve(['owner', openDisputeId(), true, 'removed']).send('owner@active');

    // The legit context score and directional trust are UNTOUCHED.
    expect(ctxAvg('alice', 'ai')).to.equal(ctxBefore);
    expect(trustFor('reviewer1', 'alice')).to.equal(trustBefore);
  });

  it('a disputed CONTEXT review still rolls back its own context score and trust', async () => {
    await feed.actions.submitctx(['reviewer1', 'alice', 'ai', 5, 'great', 'job1', '', 0]).send('reviewer1@active');
    const ctxId = lastFbId();
    expect(Number(kindRows().find((k:any)=>Number(k.feedback_id)===ctxId).kind)).to.equal(1);
    expect(ctxAvg('alice', 'ai')).to.be.greaterThan(0);

    await feed.actions.dispute(['alice', ctxId, 'bogus review', 'ev']).send('alice@active');
    await feed.actions.resolve(['owner', openDisputeId(), true, 'removed']).send('owner@active');

    // Its context contribution is reversed (only reviewer -> no score left) and kind row cleared.
    expect(ctxAvg('alice', 'ai')).to.equal(0);
    expect(kindRows().find((k:any)=>Number(k.feedback_id)===ctxId)).to.equal(undefined);
  });
});

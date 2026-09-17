import { expect } from 'chai';
import { Blockchain, mintTokens, nameToBigInt } from '@proton/vert';
const bc = new Blockchain();
const agentcore = bc.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const agentfeed = bc.createContract('agentfeed', '../agentfeed/assembly/target/agentfeed.contract');
const escrow = bc.createContract('agentescrow', 'assembly/target/agentescrow.contract', true);
const token = bc.createContract('eosio.token', 'node_modules/proton-tsc/external/eosio.token/eosio.token');
const accts = bc.createAccounts('owner', 'client', 'agent1', 'arbitrator1');
const job = (id: number) => escrow.tables.jobs(nameToBigInt('agentescrow')).getTableRow(BigInt(id));
const bal = (a: string): bigint => { const r: any = token.tables.accounts(nameToBigInt(a)).getTableRows()[0]; return r ? BigInt(String(r.balance).split(' ')[0].replace('.', '')) : 0n; };

describe('cancel() + removejob() double-refund regression', () => {
  it('a funded-then-cancelled job cannot be refunded again by removejob', async () => {
    await mintTokens(token, 'XPR', 4, 1000000000, 100000000, accts);
    await agentcore.actions.init(['owner', 0, 100000, 'agentfeed', '', 'agentescrow']).send('agentcore@active');
    await agentfeed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
    await escrow.actions.init(['owner', 'agentcore', 'agentfeed', 200]).send('agentescrow@active');
    await agentcore.actions.register(['agent1', 'A', 'd', 'https://a.test', 'https', '["x"]']).send('agent1@active');
    // A second, healthy funded job whose escrow must remain untouched.
    const dl = Math.floor(Date.now() / 1000) + 86400 * 30;
    await escrow.actions.createjob(['client', 'agent1', 'Keep', 'd', '["d"]', 1000000, '4,XPR', dl, '', 'h']).send('client@active');
    await token.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'fund:0']).send('client@active');
    // The job under test: fund, then client cancels (state 1 -> refund).
    await escrow.actions.createjob(['client', 'agent1', 'Cancel', 'd', '["d"]', 1000000, '4,XPR', dl, '', 'h']).send('client@active');
    await token.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'fund:1']).send('client@active');
    await escrow.actions.cancel(['client', 1]).send('client@active');
    expect(job(1).state).to.equal(7);
    expect(job(1).released_amount).to.equal(job(1).funded_amount); // the fix
    const poolAfterCancel = bal('agentescrow');
    const clientAfterCancel = bal('client');
    // Owner runs routine moderation cleanup on the cancelled job.
    await escrow.actions.removejob([1]).send('owner@active');
    // No second refund: client balance and contract pool are unchanged, and the
    // healthy job's 100 XPR escrow is still there.
    expect(bal('client')).to.equal(clientAfterCancel);
    expect(bal('agentescrow')).to.equal(poolAfterCancel);
    expect(bal('agentescrow')).to.equal(1000000n); // exactly job 0's escrow
  });
});

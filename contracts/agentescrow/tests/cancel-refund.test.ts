import { expect } from 'chai';
import { Blockchain, mintTokens, nameToBigInt } from '@proton/vert';
const bc = new Blockchain();
const agentcore = bc.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const agentfeed = bc.createContract('agentfeed', '../agentfeed/assembly/target/agentfeed.contract');
const escrow = bc.createContract('agentescrow', 'assembly/target/agentescrow.contract', true);
const token = bc.createContract('eosio.token', 'node_modules/proton-tsc/external/eosio.token/eosio.token');
const accts = bc.createAccounts('owner', 'client', 'agent1');
const S = 'agentescrow';
const job = (id: number) => escrow.tables.jobs(nameToBigInt(S)).getTableRow(BigInt(id));
const bal = (a: string): bigint => { const r: any = token.tables.accounts(nameToBigInt(a)).getTableRows()[0]; return r ? BigInt(String(r.balance).split(' ')[0].replace('.', '')) : 0n; };
const dl = () => Math.floor(Date.now() / 1000) + 86400 * 30;

const setup = async () => {
  await mintTokens(token, 'XPR', 4, 1000000000, 100000000, accts);
  await agentcore.actions.init(['owner', 0, 100000, 'agentfeed', '', 'agentescrow']).send('agentcore@active');
  await agentfeed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
  await escrow.actions.init(['owner', 'agentcore', 'agentfeed', 200]).send('agentescrow@active');
  await agentcore.actions.register(['agent1', 'A', 'd', 'https://a.test', 'https', '["x"]']).send('agent1@active');
  // Job 0: a healthy funded job whose 100 XPR escrow must never be touched.
  await escrow.actions.createjob(['client', 'agent1', 'Keep', 'd', '["d"]', 1000000, '4,XPR', dl(), '', 'h']).send('client@active');
  await token.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'fund:0']).send('client@active');
};

describe('cancel() + removejob() double-refund regression', () => {
  beforeEach(async () => { bc.resetTables(); await setup(); });

  it('cancel() zeroes remaining, so removejob() cannot refund it again', async () => {
    await escrow.actions.createjob(['client', 'agent1', 'Cancel', 'd', '["d"]', 1000000, '4,XPR', dl(), '', 'h']).send('client@active');
    await token.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'fund:1']).send('client@active');
    await escrow.actions.cancel(['client', 1]).send('client@active');
    expect(job(1).state).to.equal(7);
    expect(job(1).released_amount).to.equal(job(1).funded_amount); // the cancel() fix
    const pool = bal('agentescrow'); const client = bal('client');
    await escrow.actions.removejob([1]).send('owner@active');
    expect(bal('client')).to.equal(client);          // no second refund
    expect(bal('agentescrow')).to.equal(pool);
    expect(bal('agentescrow')).to.equal(1000000n);   // exactly job 0's escrow remains
  });

  it('removejob() refunds nothing on a terminal job with stale released_amount=0 (legacy guard)', async () => {
    await escrow.actions.createjob(['client', 'agent1', 'Legacy', 'd', '["d"]', 1000000, '4,XPR', dl(), '', 'h']).send('client@active');
    await token.actions.transfer(['client', 'agentescrow', '100.0000 XPR', 'fund:1']).send('client@active');
    // Reproduce the pre-fix on-chain shape: REFUNDED but released_amount still 0.
    const row: any = job(1); row.state = 7; row.released_amount = 0;
    escrow.tables.jobs(nameToBigInt(S)).set(1n, 'agentescrow' as any, row);
    const pool = bal('agentescrow'); const client = bal('client');
    await escrow.actions.removejob([1]).send('owner@active');
    expect(bal('client')).to.equal(client);          // guard forced refund to 0
    expect(bal('agentescrow')).to.equal(pool);
  });
});

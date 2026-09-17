import { expect } from 'chai';
import { Blockchain, mintTokens, nameToBigInt, expectToThrow } from '@proton/vert';

const blockchain = new Blockchain();
const agentcore = blockchain.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const agentfeed = blockchain.createContract('agentfeed', '../agentfeed/assembly/target/agentfeed.contract');
const agentescrow = blockchain.createContract('agentescrow', 'assembly/target/agentescrow.contract', true);
const eosioToken = blockchain.createContract('eosio.token', 'node_modules/proton-tsc/external/eosio.token/eosio.token');
const accts = blockchain.createAccounts('owner', 'client', 'agent1', 'arbitrator1', 'buyer');

const xpr = (a: string): bigint => {
  const r: any = eosioToken.tables.accounts(nameToBigInt(a)).getTableRows()[0];
  return r ? BigInt(String(r.balance).split(' ')[0].replace('.', '')) : 0n;
};
const setup = async () => {
  await mintTokens(eosioToken, 'XPR', 4, 1000000000, 100000000, accts);
  await agentcore.actions.init(['owner', 0, 100000, 'agentfeed', '', 'agentescrow']).send('agentcore@active');
  await agentfeed.actions.init(['owner', 'agentcore']).send('agentfeed@active');
  await agentescrow.actions.init(['owner', 'agentcore', 'agentfeed', 200]).send('agentescrow@active');
  await agentcore.actions.register(['agent1', 'Agent', 'desc', 'https://a.test', 'https', '["x"]']).send('agent1@active');
  await eosioToken.actions.transfer(['agent1', 'agentescrow', '5.0000 XPR', 'svcfee:agent1']).send('agent1@active');
};
const OVERMAX = ((1n << 64n) - 1000n).toString();      // near 2^64, reads negative as i64
const MAX = 1000000000000000n;                          // contract MAX_AMOUNT

describe('FE/contract signed-cast drain — regression', () => {
  beforeEach(async () => { blockchain.resetTables(); await setup(); });

  it('rejects a service listing priced above MAX_AMOUNT (the drain enabler)', async () => {
    await expectToThrow(
      agentescrow.actions.listsvc(['agent1', 'Svc', 'desc', '["d"]', OVERMAX, 86400, 'image', '']).send('agent1@active'),
      'eosio_assert: Price exceeds maximum'
    );
  });

  it('rejects a listing exactly at 2^63 (would be negative as i64)', async () => {
    await expectToThrow(
      agentescrow.actions.listsvc(['agent1', 'Svc', 'desc', '["d"]', (1n << 63n).toString(), 86400, 'image', '']).send('agent1@active'),
      'eosio_assert: Price exceeds maximum'
    );
  });

  it('allows a listing at MAX_AMOUNT and rejects one unit above', async () => {
    await agentescrow.actions.listsvc(['agent1', 'Ok', 'desc', '["d"]', MAX.toString(), 86400, 'image', '']).send('agent1@active');
    await expectToThrow(
      agentescrow.actions.listsvc(['agent1', 'No', 'desc', '["d"]', (MAX + 1n).toString(), 86400, 'image', '']).send('agent1@active'),
      'eosio_assert: Price exceeds maximum'
    );
  });

  it('a normal purchase still refunds only the true overpayment, never the pool', async () => {
    // other people's money in the contract
    await agentescrow.actions.regarb(['arbitrator1', 200]).send('arbitrator1@active');
    await eosioToken.actions.transfer(['arbitrator1', 'agentescrow', '1000.0000 XPR', 'arbstake']).send('arbitrator1@active');
    await agentescrow.actions.activatearb(['arbitrator1']).send('arbitrator1@active');
    await agentescrow.actions.listsvc(['agent1', 'Svc', 'desc', '["d"]', 1000000, 86400, 'image', '']).send('agent1@active'); // 100 XPR
    const pool = xpr('agentescrow'), before = xpr('buyer');
    await eosioToken.actions.transfer(['buyer', 'agentescrow', '150.0000 XPR', 'buy:0']).send('buyer@active'); // overpay by 50
    expect(before - xpr('buyer')).to.equal(1000000n);          // buyer is out exactly 100 XPR (50 refunded)
    expect(xpr('agentescrow')).to.equal(pool + 1000000n);      // contract kept exactly the 100 XPR price
  });

  it('rejects createjob and submitbid amounts above MAX_AMOUNT', async () => {
    const deadline = Math.floor(Date.now() / 1000) + 86400 * 30;
    await expectToThrow(
      agentescrow.actions.createjob(['client', 'agent1', 'J', 'd', '["d"]', OVERMAX, '4,XPR', deadline, 'arbitrator1', 'h']).send('client@active'),
      'eosio_assert: Amount exceeds maximum'
    );
    await agentescrow.actions.createjob(['client', '', 'Open', 'd', '["d"]', 1000000, '4,XPR', deadline, '', 'h']).send('client@active');
    await expectToThrow(
      agentescrow.actions.submitbid(['agent1', getOpenJobId(), OVERMAX, 86400, 'proposal']).send('agent1@active'),
      'eosio_assert: Bid amount exceeds maximum'
    );
  });
});

function getOpenJobId(): number {
  const rows = agentescrow.tables.jobs(nameToBigInt('agentescrow')).getTableRows();
  return Number(rows[rows.length - 1].id);
}

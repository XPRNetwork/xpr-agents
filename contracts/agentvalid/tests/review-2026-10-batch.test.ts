import { expect } from 'chai';
import { Blockchain, mintTokens, nameToBigInt, expectToThrow, protonAssert } from '@proton/vert';
import { TimePointSec } from '@greymass/eosio';

const bc = new Blockchain();
const core = bc.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const valid = bc.createContract('agentvalid', 'assembly/target/agentvalid.contract', true);
const token = bc.createContract('eosio.token', 'node_modules/proton-tsc/external/eosio.token/eosio.token');
const accounts = bc.createAccounts('owner', 'alice', 'validator1', 'challenger1');
const T = 1700000000;
const scope = nameToBigInt('agentvalid');
const stats = (): any => valid.tables.validators(scope).getTableRow(nameToBigInt('validator1'));
const payer = () => bc.store.findTable(scope, scope, nameToBigInt('validations'))!.get(0n)!.payer;
const validate = (id: number) => valid.actions.validate(['validator1', 'alice', `job${id}`, 1, 95, 'ipfs://v']).send('validator1@active');
const challenge = () => valid.actions.challenge(['challenger1', 0, 'incorrect', 'ipfs://e']).send('challenger1@active');
const fund = (id = '0') => token.actions.transfer(['challenger1', 'agentvalid', '5.0000 XPR', `challenge:${id}`]).send('challenger1@active');
const resolve = async () => {
  bc.setTime(TimePointSec.from(T + 172800));
  await valid.actions.resolve(['owner', 0, true, 'incorrect']).send('owner@active');
};

describe('October 2026 batch: validation', () => {
  beforeEach(async () => {
    bc.resetTables();
    bc.setTime(TimePointSec.from(T));
    await mintTokens(token, 'XPR', 4, 1000000000, 100000, accounts);
    await core.actions.init(['owner', 0, 100000, '', 'agentvalid', '']).send('agentcore@active');
    await valid.actions.init(['owner', 'agentcore', 10000]).send('agentvalid@active');
    await valid.actions.setconfig(['agentcore', 10000, 50000, 86400, 3600, 1000, 172800, 604800, false, 0]).send('owner@active');
    await core.actions.register(['alice', 'A', 'd', 'https://a.test', 'https', '[]']).send('alice@active');
    await valid.actions.regval(['validator1', 'manual', '[]']).send('validator1@active');
    await token.actions.transfer(['validator1', 'agentvalid', '10.0000 XPR', 'stake']).send('validator1@active');
    await validate(0);
  });

  it('bills each new validation to its authenticated validator', async () => {
    await validate(1);
    expect(payer()).to.equal(nameToBigInt('validator1'));
    expect(bc.store.findTable(scope, scope, nameToBigInt('validations'))!.get(1n)!.payer).to.equal(nameToBigInt('validator1'));
  });
  for (const path of ['funding', 'resolution', 'expiry']) {
    it(`preserves the validation payer through challenge ${path}`, async () => {
      await challenge();
      await fund();
      if (path === 'resolution') await resolve();
      if (path === 'expiry') {
        bc.setTime(TimePointSec.from(T + 604801));
        await valid.actions.expirefunded([0]).send('challenger1@active');
      }
      expect(payer()).to.equal(nameToBigInt('validator1'));
    });
  }

  it('recomputes accuracy when the fifth validation reaches the sample threshold', async () => {
    await challenge();
    await fund();
    await resolve();
    for (let i = 1; i < 4; i++) await validate(i);
    expect(Number(stats().accuracy_score)).to.equal(10000);
    await validate(4);
    expect(Number(stats().accuracy_score)).to.equal(8000);
  });
  it('recomputes accuracy after further validations without another challenge', async () => {
    for (let i = 1; i < 5; i++) await validate(i);
    await challenge();
    await fund();
    await resolve();
    expect(Number(stats().accuracy_score)).to.equal(8000);
    await validate(5);
    expect(Number(stats().accuracy_score)).to.equal(8333);
  });

  for (const id of ['18446744073709551616', '18446744073709551617', '99999999999999999999']) {
    it(`rejects overflowing challenge ID ${id}`, async () => {
      await challenge();
      await expectToThrow(fund(id), protonAssert('Challenge ID exceeds u64 max'));
      expect(Number(valid.tables.challenges(scope).getTableRow(0n).stake)).to.equal(0);
      expect(Number(stats().pending_challenges)).to.equal(0);
    });
  }
  for (const id of ['', '0'.repeat(21), '-1', '+0', ' 0', '0 ', '0x0', '0junk', '1.0']) {
    it(`rejects malformed challenge ID ${JSON.stringify(id)}`, async () => {
      const msg = id.length === 0 || id.length > 20 ? 'Invalid challenge ID format' : 'Challenge ID must be numeric';
      await expectToThrow(fund(id), protonAssert(msg));
    });
  }
  it('accepts u64 max without wrapping', async () => {
    await expectToThrow(fund('18446744073709551615'), protonAssert('Challenge not found'));
  });
  it('accepts a zero-padded challenge ID', async () => {
    await challenge();
    await fund('00000000000000000000');
    expect(Number(valid.tables.challenges(scope).getTableRow(0n).stake)).to.equal(50000);
  });
});

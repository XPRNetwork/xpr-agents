import { expect } from 'chai';
import { Blockchain, protonAssert, expectToThrow, mintTokens, nameToBigInt } from '@proton/vert';
import { TimePointSec } from '@greymass/eosio';

/**
 * Regression for the expireunfund double-slash bug (audit round 2, found by
 * grok + codex). Two unfunded challenges could exist for one validation; funding
 * one set validation.challenged = true, but expiring the other unfunded sibling
 * cleared the flag — unlocking the validation so a SECOND challenge could be
 * funded and the validator slashed twice for a single validation.
 * The fix: expireunfund must never touch validation.challenged.
 */
const blockchain = new Blockchain();
const agentcore = blockchain.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const agentvalid = blockchain.createContract('agentvalid', 'assembly/target/agentvalid.contract', true);
const eosioToken = blockchain.createContract('eosio.token', 'node_modules/proton-tsc/external/eosio.token/eosio.token');

const [owner, alice, validator1, challenger1, challenger2] = blockchain.createAccounts(
  'owner', 'alice', 'validator1', 'challenger1', 'challenger2'
);

const getValidation = (id: number) =>
  agentvalid.tables.validations(nameToBigInt('agentvalid')).getTableRow(BigInt(id));
const getValidator = (name: string) =>
  agentvalid.tables.validators(nameToBigInt('agentvalid')).getTableRow(nameToBigInt(name));

beforeEach(async () => {
  blockchain.resetTables();
  await mintTokens(eosioToken, 'XPR', 4, 1000000000, 100000, [owner, validator1, challenger1, challenger2]);
  await agentcore.actions.init(['owner', 0, 100000, '', 'agentvalid', '']).send('agentcore@active');
  await agentvalid.actions.init(['owner', 'agentcore', 10000]).send('agentvalid@active');
  await agentvalid.actions.setconfig([
    'agentcore', 10000, 50000, 86400, 3600, 1000, 172800, 604800, false, 0,
  ]).send('owner@active');
  await agentcore.actions.register([
    'alice', 'Test Agent', 'A test agent', 'https://api.test.com', 'https', '["chat"]',
  ]).send('alice@active');
  // Register + stake the validator, then post a validation (id 0)
  await agentvalid.actions.regval(['validator1', 'manual', '["ai"]']).send('validator1@active');
  await eosioToken.actions.transfer(['validator1', 'agentvalid', '10.0000 XPR', 'stake']).send('validator1@active');
  await agentvalid.actions.validate([
    'validator1', 'alice', 'jobhash123', 1, 95, 'ipfs://evidence',
  ]).send('validator1@active');
  // Two UNFUNDED challenges for the same validation (both pass: challenged is false)
  await agentvalid.actions.challenge(['challenger1', 0, 'Bad A', 'ipfs://a']).send('challenger1@active'); // id 0
  await agentvalid.actions.challenge(['challenger2', 0, 'Bad B', 'ipfs://b']).send('challenger2@active'); // id 1
});

describe('expireunfund vs a funded sibling challenge', () => {
  it('leaves validation.challenged and pending_challenges intact when an unfunded sibling expires', async () => {
    // Fund challenge 0 -> validation is now officially challenged.
    await eosioToken.actions.transfer(['challenger1', 'agentvalid', '5.0000 XPR', 'challenge:0']).send('challenger1@active');
    expect(getValidation(0).challenged).to.equal(true);
    expect(Number(getValidator('validator1').pending_challenges)).to.equal(1);

    // Expire the still-unfunded sibling (challenge 1) after its 24h funding window.
    blockchain.addTime(TimePointSec.from(86401));
    await agentvalid.actions.expireunfund([1]).send('challenger1@active');

    // FIX: the funded challenge's protection must survive.
    expect(getValidation(0).challenged).to.equal(true);
    expect(Number(getValidator('validator1').pending_challenges)).to.equal(1);

    // And the validation cannot be re-challenged while a funded challenge is live
    // (the !challenged guard runs before the window check, so this is the fix's tell).
    await expectToThrow(
      agentvalid.actions.challenge(['challenger2', 0, 'Bad C', 'ipfs://c']).send('challenger2@active'),
      protonAssert('Validation already challenged'),
    );
  });
});

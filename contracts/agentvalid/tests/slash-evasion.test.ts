import { expect } from 'chai';
import { Blockchain, protonAssert, expectToThrow, mintTokens, nameToBigInt } from '@proton/vert';
import { TimePointSec } from '@greymass/eosio';

/**
 * Regression for XPRA-VALID-SLASH-2026-01: a validator could post a dishonest
 * validation and, in the same window before any challenge exists, unstake its whole
 * balance to the (non-slashable) unstakes table, so an upheld challenge slashed 0.
 * Fix: unstake is time-locked until challenge_window + FUNDING_WINDOW has elapsed
 * since the validator's most recent validation.
 */
const blockchain = new Blockchain();
const agentcore = blockchain.createContract('agentcore', '../agentcore/assembly/target/agentcore.contract');
const agentvalid = blockchain.createContract('agentvalid', 'assembly/target/agentvalid.contract', true);
const eosioToken = blockchain.createContract('eosio.token', 'node_modules/proton-tsc/external/eosio.token/eosio.token');

const [owner, alice, validator1, vtwo] = blockchain.createAccounts('owner', 'alice', 'validator1', 'vtwo');
const getValidator = (name: string) =>
  agentvalid.tables.validators(nameToBigInt('agentvalid')).getTableRow(nameToBigInt(name));

// config here: challenge_window = 3600, so the unstake risk window is 3600 + 86400 = 90000s.
const CHALLENGE_WINDOW = 3600;
const FUNDING_WINDOW = 86400;
const LOCK_MSG = 'Cannot unstake yet: stake stays at risk until the challenge window of your most recent validation has passed.';

beforeEach(async () => {
  blockchain.resetTables();
  await mintTokens(eosioToken, 'XPR', 4, 1000000000, 100000, [owner, validator1, vtwo]);
  await agentcore.actions.init(['owner', 0, 100000, '', 'agentvalid', '']).send('agentcore@active');
  await agentvalid.actions.init(['owner', 'agentcore', 10000]).send('agentvalid@active');
  await agentvalid.actions.setconfig([
    'agentcore', 10000, 50000, 86400, CHALLENGE_WINDOW, 1000, 172800, 604800, false, 0,
  ]).send('owner@active');
  await agentcore.actions.register([
    'alice', 'Test Agent', 'd', 'https://api.test.com', 'https', '["chat"]',
  ]).send('alice@active');
  await agentvalid.actions.regval(['validator1', 'manual', '["ai"]']).send('validator1@active');
  await eosioToken.actions.transfer(['validator1', 'agentvalid', '10.0000 XPR', 'stake']).send('validator1@active');
  // The dishonest validation (id 0). Full stake is now at risk.
  await agentvalid.actions.validate(['validator1', 'alice', 'jobhash', 1, 95, 'ipfs://e']).send('validator1@active');
});

describe('unstake time-lock after a validation', () => {
  it('blocks unstaking to zero within the challenge+funding window (the evasion)', async () => {
    expect(Number(getValidator('validator1').stake)).to.equal(100000);
    await expectToThrow(
      agentvalid.actions.unstake(['validator1', 100000]).send('validator1@active'),
      protonAssert(LOCK_MSG),
    );
    // Still fully slashable.
    expect(Number(getValidator('validator1').stake)).to.equal(100000);
  });

  it('still blocks just before the window closes', async () => {
    blockchain.addTime(TimePointSec.from(CHALLENGE_WINDOW + FUNDING_WINDOW - 10));
    await expectToThrow(
      agentvalid.actions.unstake(['validator1', 100000]).send('validator1@active'),
      protonAssert(LOCK_MSG),
    );
  });

  it('allows unstaking once the window has passed with no challenge funded', async () => {
    blockchain.addTime(TimePointSec.from(CHALLENGE_WINDOW + FUNDING_WINDOW + 10));
    await agentvalid.actions.unstake(['validator1', 100000]).send('validator1@active');
    expect(Number(getValidator('validator1').stake)).to.equal(0);
  });

  it('does not lock a validator that never validated', async () => {
    // vtwo (minted in beforeEach) registers and stakes but never validates -> no
    // valactivity row -> unstake is allowed immediately.
    await agentvalid.actions.regval(['vtwo', 'manual', '["ai"]']).send('vtwo@active');
    await eosioToken.actions.transfer(['vtwo', 'agentvalid', '10.0000 XPR', 'stake']).send('vtwo@active');
    await agentvalid.actions.unstake(['vtwo', 100000]).send('vtwo@active');
    expect(Number(getValidator('vtwo').stake)).to.equal(0);
  });
});

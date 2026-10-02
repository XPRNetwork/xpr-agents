import { expect } from 'chai';
import { Blockchain, nameToBigInt } from '@proton/vert';

/**
 * October 2026 review: agentcore billed every plugin row to the contract, so any account could
 * grow its RAM without limit (regplugin is open to all, addplugin had no per-agent cap and
 * pluginres stored a fresh 8 KB row per call). The protocol string was also unbounded whenever
 * the endpoint was empty. Rows are now billed to the account that creates them and protocol is
 * always capped at 32 characters.
 */
const blockchain = new Blockchain();
const core = blockchain.createContract('agentcore', 'assembly/target/agentcore.contract', true);
blockchain.createAccounts('owner', 'alice', 'bob', 'carol', 'plugcon');

const scope = nameToBigInt('agentcore');
const payer = (table: string, id: bigint) =>
  blockchain.store.findTable(scope, scope, nameToBigInt(table))!.get(id)!.payer;
const rejected = async (action: Promise<any>, message: string) => {
  let error: any;
  try { await action; } catch (e) { error = e; }
  expect(error, 'action must reject').to.not.equal(undefined);
  expect(String(error.message)).to.include(message);
};
const regplugin = () =>
  core.actions.regplugin(['bob', 'Plugin', '1.0', 'plugcon', 'execute', '{}', 'compute']).send('bob@active');

describe('agentcore RAM payers and protocol bound (October 2026 review)', () => {
  beforeEach(async () => {
    blockchain.resetTables();
    await core.actions.init(['owner', 0, 100000, '', '', '']).send('agentcore@active');
    await core.actions.register(['alice', 'Alice', 'desc', 'https://a.test', 'https', '[]']).send('alice@active');
  });

  it('register bounds protocol even when the endpoint is empty', async () => {
    await rejected(
      core.actions.register(['carol', 'Carol', 'desc', '', 'x'.repeat(33), '[]']).send('carol@active'),
      'Protocol must be <= 32 characters'
    );
    await core.actions.register(['carol', 'Carol', 'desc', '', '', '[]']).send('carol@active');
  });

  it('update bounds protocol even when the endpoint is empty', async () => {
    await rejected(
      core.actions.update(['alice', 'Alice', 'desc', '', 'x'.repeat(33), '[]']).send('alice@active'),
      'Protocol must be <= 32 characters'
    );
    await core.actions.update(['alice', 'Alice', 'desc', 'https://a.test', 'grpc', '[]']).send('alice@active');
  });

  it('bills plugin registrations to the author, also after the owner verifies them', async () => {
    await regplugin();
    await regplugin();
    expect(payer('plugins', 0n)).to.equal(nameToBigInt('bob'));
    expect(payer('plugins', 1n)).to.equal(nameToBigInt('bob'));
    await core.actions.verifyplugin([0, true]).send('owner@active');
    expect(payer('plugins', 0n)).to.equal(nameToBigInt('bob'));
  });

  it('bills plugin installations to the agent, also after toggling', async () => {
    await regplugin();
    await core.actions.addplugin(['alice', 0, '{}']).send('alice@active');
    expect(payer('agentplugs', 0n)).to.equal(nameToBigInt('alice'));
    await core.actions.toggleplug(['alice', 0, false]).send('alice@active');
    expect(payer('agentplugs', 0n)).to.equal(nameToBigInt('alice'));
  });

  it('bills plugin results to the submitting plugin contract', async () => {
    await regplugin();
    await core.actions.addplugin(['alice', 0, '{}']).send('alice@active');
    await core.actions.pluginres(['alice', 0, 1, 'success', '{}']).send('plugcon@active');
    await core.actions.pluginres(['alice', 0, 1, 'success', '{}']).send('plugcon@active');
    expect(payer('pluginres', 0n)).to.equal(nameToBigInt('plugcon'));
    expect(payer('pluginres', 1n)).to.equal(nameToBigInt('plugcon'));
  });

  it('removeagent still clears plugin rows billed to other accounts', async () => {
    await regplugin();
    await core.actions.addplugin(['alice', 0, '{}']).send('alice@active');
    await core.actions.pluginres(['alice', 0, 1, 'success', '{}']).send('plugcon@active');
    await core.actions.removeagent(['alice']).send('owner@active');
    const rows = (t: string) => core.tables[t](scope).getTableRows();
    expect(rows('agentplugs')).to.have.length(0);
    expect(rows('pluginres')).to.have.length(0);
  });
});

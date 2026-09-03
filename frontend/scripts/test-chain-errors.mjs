// Sanity checks for src/lib/chain-errors.ts — the assertion → plain-language map.
//   node --import ./scripts/ts-loader.mjs scripts/test-chain-errors.mjs
import assert from 'node:assert/strict';
import { explainChainError, rawChainMessage, stripAssertionPrefix } from '../src/lib/chain-errors.ts';

let pass = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); pass++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
};

// The exact shape the buyer hit: a wallet Error wrapping the contract assertion.
t('delisted listing (the "metal" incident)', () => {
  const e = new Error('assertion failure with message: Service is not active');
  const out = explainChainError(e);
  assert.equal(out.title, 'This listing was delisted');
  assert.match(out.detail, /Nothing was charged/);
  assert.match(out.hint, /relist/);
});

t('missing listing', () => {
  assert.equal(explainChainError(new Error('assertion failure with message: Service not found')).title,
    'That listing no longer exists');
});

t('self-purchase', () => {
  assert.equal(explainChainError('Cannot buy your own service').title, 'This is your own listing');
  assert.equal(explainChainError('Client cannot hire an agent they own').title, 'You own this agent');
});

t('price / funding', () => {
  assert.equal(explainChainError(new Error('assertion failure with message: Insufficient payment')).title,
    'The price changed');
  assert.equal(explainChainError('Insufficient funding').title, 'The job is not fully funded');
});

t('inactive agent and paused contract', () => {
  assert.equal(explainChainError('Agent is not active').title, 'The seller is offline');
  assert.equal(explainChainError('Contract is paused').title, 'The escrow contract is paused');
});

t('memo and svcinput limits', () => {
  assert.equal(explainChainError('Buyer notes must be <= 200 characters').title, 'Your note is too long');
  assert.equal(explainChainError('No recent purchase').title, 'No purchase to attach this to');
  assert.equal(explainChainError('Purchase input window closed').title, 'Too late to attach your answers');
  assert.equal(explainChainError('Message must be 1-512 characters').title, 'Message length out of range');
  assert.equal(explainChainError('Job message limit reached').title, 'This job has hit its message limit');
});

t('generic job-lifecycle assertions', () => {
  assert.equal(explainChainError('Only client can approve').title, 'Wrong account for this action');
  assert.equal(explainChainError('Only assigned agent can deliver').title, 'Wrong account for this action');
  assert.equal(explainChainError('Job must be in FUNDED state').title, 'The job has moved on');
  assert.match(explainChainError('Rate limit exceeded. Wait 24 hours between feedback submissions for the same agent.').title, /Rate limited/);
  assert.equal(explainChainError('Deadline not reached').title, 'The deadline has not passed yet');
  assert.equal(explainChainError('Client dispute window still open').title, 'The client can still respond');
});

t('balance errors', () => {
  assert.equal(explainChainError(new Error('overdrawn balance')).title, 'Not enough XPR');
  assert.equal(explainChainError(new Error('Overdrawn balance')).title, 'Not enough XPR');
});

t('unknown assertion falls back with the prefix stripped', () => {
  const out = explainChainError(new Error('assertion failure with message: Something new broke'));
  assert.equal(out.title, 'The chain rejected this transaction');
  assert.equal(out.detail, 'Something new broke.');
});

t('RPC error envelope is unwrapped', () => {
  const rpcErr = { json: { error: { what: 'assertion failure', details: [
    { message: 'assertion failure with message: Service is not active' },
    { message: 'pending console output: ' },
  ] } } };
  assert.equal(rawChainMessage(rpcErr), 'assertion failure with message: Service is not active');
  assert.equal(explainChainError(rpcErr).title, 'This listing was delisted');
});

t('empty / unknown input still explains itself', () => {
  assert.equal(explainChainError(undefined).title, 'The transaction did not go through');
  assert.equal(explainChainError({}).title, 'The transaction did not go through');
});

t('prefix stripping', () => {
  assert.equal(stripAssertionPrefix('assertion failure with message: Service not found'), 'Service not found');
  assert.equal(stripAssertionPrefix('Transaction Error: assertion failure with message: Contract is paused'),
    'Contract is paused');
});

t('wallet cancel is not reported as a chain failure', () => {
  assert.equal(explainChainError(new Error('The user rejected the request')).title, 'Signing cancelled');
});

console.log(`\n${pass} checks passed`);

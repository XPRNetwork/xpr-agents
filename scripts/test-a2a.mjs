/**
 * Comprehensive A2A Protocol Test Suite
 *
 * Tests authentication, task lifecycle, error handling, and security.
 * Usage: node scripts/test-a2a.mjs [--target URL]
 */
import { signA2ARequest, hashBody } from '../sdk/dist/index.js';

const TARGET = process.argv.includes('--target')
  ? process.argv[process.argv.indexOf('--target') + 1]
  : 'http://192.168.1.86:8080';

const A2A_URL = `${TARGET}/a2a`;
const AGENT_CARD_URL = `${TARGET}/.well-known/agent.json`;

// testagent1 — registered on testnet
const ACCOUNT = 'testagent1';
const PRIVATE_KEY = 'PVT_K1_dbnLTCfiJXJyrEtdQFWgXmpNqoNN7taAVSScUXW6o16qey65d';

// testagent2 — registered on testnet (for cross-account tests)
const ACCOUNT_2 = 'testagent2';
const PRIVATE_KEY_2 = 'PVT_K1_xrw1unsJecZT8XmpaQtCv7fWfxwqpof2acXQTMixCxRb7b6P2';

let passed = 0;
let failed = 0;
let skipped = 0;

function log(icon, msg) { console.log(`  ${icon} ${msg}`); }

async function sendA2A(method, params, { account, key, timestampOverride, signatureOverride, skipAuth, rawBody } = {}) {
  const acct = account || ACCOUNT;
  const pk = key || PRIVATE_KEY;
  const body = rawBody || JSON.stringify({ jsonrpc: '2.0', id: `test-${Date.now()}`, method, params });
  const timestamp = timestampOverride || Math.floor(Date.now() / 1000);

  const headers = { 'Content-Type': 'application/json' };

  if (!skipAuth) {
    const bodyDigest = hashBody(body);
    headers['X-XPR-Account'] = acct;
    headers['X-XPR-Timestamp'] = String(timestamp);
    headers['X-XPR-Signature'] = signatureOverride || signA2ARequest(pk, acct, timestamp, bodyDigest);
  }

  const resp = await fetch(A2A_URL, { method: 'POST', headers, body });
  return resp.json();
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    log('\x1b[32mPASS\x1b[0m', name);
  } catch (err) {
    failed++;
    log('\x1b[31mFAIL\x1b[0m', `${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertError(result, codeOrMsg) {
  assert(result.error, `Expected error, got result: ${JSON.stringify(result.result || result).slice(0, 200)}`);
  if (typeof codeOrMsg === 'number') {
    assert(result.error.code === codeOrMsg, `Expected error code ${codeOrMsg}, got ${result.error.code}`);
  } else if (typeof codeOrMsg === 'string') {
    assert(result.error.message.includes(codeOrMsg), `Expected error containing "${codeOrMsg}", got "${result.error.message}"`);
  }
}

// ═══════════════════════════════════════════════
console.log('\n\x1b[1m=== A2A Protocol Test Suite ===\x1b[0m');
console.log(`Target: ${TARGET}\n`);

// ── 1. Agent Card Discovery ───────────────────
console.log('\x1b[36m--- Agent Card Discovery ---\x1b[0m');

await test('GET /.well-known/agent.json returns valid card', async () => {
  const resp = await fetch(AGENT_CARD_URL);
  assert(resp.ok, `HTTP ${resp.status}`);
  const card = await resp.json();
  assert(card.name, 'Missing name');
  assert(card['xpr:account'], 'Missing xpr:account');
  assert(card.version, 'Missing version');
  assert(card.capabilities, 'Missing capabilities');
  assert(card.skills && card.skills.length > 0, 'Missing skills');
  assert(card.defaultInputModes?.includes('text'), 'Missing text input mode');
});

await test('Agent card has XPR extensions', async () => {
  const card = await fetch(AGENT_CARD_URL).then(r => r.json());
  assert(card['xpr:account'] === 'charliebot', `Expected charliebot, got ${card['xpr:account']}`);
  assert(typeof card['xpr:trustScore'] === 'number', 'Missing trust score');
  assert(typeof card['xpr:registeredAt'] === 'number', 'Missing registeredAt');
});

// ── 2. Authentication ─────────────────────────
console.log('\n\x1b[36m--- Authentication ---\x1b[0m');

await test('Reject request with no auth headers', async () => {
  const result = await sendA2A('message/send', {
    message: { role: 'user', parts: [{ type: 'text', text: 'no auth' }] },
  }, { skipAuth: true });
  assertError(result, 'Authentication required');
});

await test('Reject request with missing signature header', async () => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 'test', method: 'message/send', params: {
    message: { role: 'user', parts: [{ type: 'text', text: 'test' }] },
  }});
  const resp = await fetch(A2A_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-XPR-Account': ACCOUNT,
      'X-XPR-Timestamp': String(Math.floor(Date.now() / 1000)),
      // No signature
    },
    body,
  });
  const result = await resp.json();
  assertError(result, 'Authentication required');
});

await test('Reject expired timestamp (>5 min old)', async () => {
  const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 min ago
  const result = await sendA2A('message/send', {
    message: { role: 'user', parts: [{ type: 'text', text: 'stale' }] },
  }, { timestampOverride: oldTimestamp });
  assertError(result, 'timestamp too far');
});

await test('Reject future timestamp (>5 min ahead)', async () => {
  const futureTimestamp = Math.floor(Date.now() / 1000) + 600; // 10 min ahead
  const result = await sendA2A('message/send', {
    message: { role: 'user', parts: [{ type: 'text', text: 'future' }] },
  }, { timestampOverride: futureTimestamp });
  assertError(result, 'timestamp too far');
});

await test('Reject invalid signature', async () => {
  const result = await sendA2A('message/send', {
    message: { role: 'user', parts: [{ type: 'text', text: 'bad sig' }] },
  }, { signatureOverride: 'SIG_K1_KaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaBBBB' });
  assertError(result, -32000);
});

await test('Reject wrong key for account (testagent2 key with testagent1 account)', async () => {
  const result = await sendA2A('message/send', {
    message: { role: 'user', parts: [{ type: 'text', text: 'wrong key' }] },
  }, { account: ACCOUNT, key: PRIVATE_KEY_2 });
  assertError(result, 'does not match');
});

await test('Reject unregistered account', async () => {
  // Sign with testagent1's key but claim to be a non-existent account
  const result = await sendA2A('message/send', {
    message: { role: 'user', parts: [{ type: 'text', text: 'ghost' }] },
  }, { account: 'nonexistacct' });
  assertError(result, -32000);
});

// ── 3. JSON-RPC Protocol ──────────────────────
console.log('\n\x1b[36m--- JSON-RPC Protocol ---\x1b[0m');

await test('Reject non-2.0 jsonrpc version', async () => {
  const body = JSON.stringify({ jsonrpc: '1.0', id: 'test', method: 'message/send', params: {} });
  const result = await sendA2A(null, null, { rawBody: body });
  assertError(result, 'Invalid request');
});

await test('Reject missing method', async () => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 'test', params: {} });
  const result = await sendA2A(null, null, { rawBody: body });
  assertError(result, 'Invalid request');
});

await test('Reject unknown method', async () => {
  const result = await sendA2A('nonexistent/method', {});
  assertError(result, 'Method not found');
});

await test('Reject message/send without message parts', async () => {
  const result = await sendA2A('message/send', {});
  assertError(result, 'Invalid params');
});

await test('Reject message/send with empty parts', async () => {
  const result = await sendA2A('message/send', { message: { role: 'user' } });
  assertError(result, 'Invalid params');
});

// ── 4. Task Lifecycle ─────────────────────────
console.log('\n\x1b[36m--- Task Lifecycle ---\x1b[0m');

let createdTaskId = null;

await test('message/send creates task and returns result', async () => {
  const result = await sendA2A('message/send', {
    message: { role: 'user', parts: [{ type: 'text', text: 'What is 2 + 2? Reply with just the number.' }] },
  });
  assert(result.result, `No result: ${JSON.stringify(result.error || result).slice(0, 200)}`);
  assert(result.result.id, 'Missing task id');
  assert(result.result.owner === ACCOUNT, `Wrong owner: ${result.result.owner}`);
  assert(result.result.status.state === 'completed', `Not completed: ${result.result.status.state}`);
  assert(result.result.artifacts?.length > 0, 'No artifacts');
  assert(result.result.artifacts[0].parts[0].text, 'Empty artifact text');
  createdTaskId = result.result.id;
});

await test('tasks/get retrieves created task', async () => {
  assert(createdTaskId, 'No task from previous test');
  const result = await sendA2A('tasks/get', { id: createdTaskId });
  assert(result.result, `No result: ${JSON.stringify(result.error || result).slice(0, 200)}`);
  assert(result.result.id === createdTaskId, 'Wrong task id');
  assert(result.result.owner === ACCOUNT, 'Wrong owner');
  assert(result.result.status.state === 'completed', 'Not completed');
});

await test('tasks/get rejects missing id', async () => {
  const result = await sendA2A('tasks/get', {});
  assertError(result, 'id is required');
});

await test('tasks/get rejects nonexistent task', async () => {
  const result = await sendA2A('tasks/get', { id: 'nonexistent-task-xyz' });
  assertError(result, 'Task not found');
});

// ── 5. Task Ownership Scoping ─────────────────
console.log('\n\x1b[36m--- Task Ownership Scoping ---\x1b[0m');

await test('testagent2 cannot access testagent1 task', async () => {
  assert(createdTaskId, 'No task from previous test');
  const result = await sendA2A('tasks/get', { id: createdTaskId }, {
    account: ACCOUNT_2, key: PRIVATE_KEY_2,
  });
  assertError(result, 'Task not found');
});

await test('testagent2 cannot cancel testagent1 task', async () => {
  assert(createdTaskId, 'No task from previous test');
  const result = await sendA2A('tasks/cancel', { id: createdTaskId }, {
    account: ACCOUNT_2, key: PRIVATE_KEY_2,
  });
  assertError(result, 'Task not found');
});

// ── 6. Task Cancel ────────────────────────────
console.log('\n\x1b[36m--- Task Cancel ---\x1b[0m');

await test('Cannot cancel already completed task', async () => {
  assert(createdTaskId, 'No task from previous test');
  const result = await sendA2A('tasks/cancel', { id: createdTaskId });
  assertError(result, 'already completed');
});

await test('tasks/cancel rejects missing id', async () => {
  const result = await sendA2A('tasks/cancel', {});
  assertError(result, 'id is required');
});

// ── 7. Custom Task ID ─────────────────────────
console.log('\n\x1b[36m--- Custom Task ID ---\x1b[0m');

let customTaskId = `custom-${Date.now()}`;

await test('message/send with custom task ID', async () => {
  const result = await sendA2A('message/send', {
    id: customTaskId,
    message: { role: 'user', parts: [{ type: 'text', text: 'Say hello in one word.' }] },
  });
  assert(result.result, `No result: ${JSON.stringify(result.error || result).slice(0, 200)}`);
  assert(result.result.id === customTaskId, `Wrong task id: ${result.result.id}`);
  assert(result.result.status.state === 'completed', 'Not completed');
});

await test('testagent2 cannot hijack custom task ID', async () => {
  const result = await sendA2A('message/send', {
    id: customTaskId,
    message: { role: 'user', parts: [{ type: 'text', text: 'hijack attempt' }] },
  }, { account: ACCOUNT_2, key: PRIVATE_KEY_2 });
  assertError(result, 'owned by another account');
});

// ── 8. Metadata & Context ─────────────────────
console.log('\n\x1b[36m--- Metadata & Context ---\x1b[0m');

await test('message/send with job metadata', async () => {
  const result = await sendA2A('message/send', {
    message: { role: 'user', parts: [{ type: 'text', text: 'Status update for job 42. Say OK.' }] },
    metadata: { 'xpr:jobId': 42 },
  });
  assert(result.result, `No result: ${JSON.stringify(result.error || result).slice(0, 200)}`);
  assert(result.result.status.state === 'completed', 'Not completed');
  assert(result.result.metadata?.['xpr:jobId'] === 42, 'Metadata not preserved');
});

await test('message/send with contextId', async () => {
  const contextId = `ctx-${Date.now()}`;
  const result = await sendA2A('message/send', {
    message: { role: 'user', parts: [{ type: 'text', text: 'Remember: my favorite color is blue. Reply OK.' }] },
    contextId,
  });
  assert(result.result, `No result: ${JSON.stringify(result.error || result).slice(0, 200)}`);
  assert(result.result.contextId === contextId, 'contextId not preserved');
});

// ── 9. Second Account (testagent2) ────────────
console.log('\n\x1b[36m--- Multi-Account ---\x1b[0m');

await test('testagent2 can send authenticated message', async () => {
  const result = await sendA2A('message/send', {
    message: { role: 'user', parts: [{ type: 'text', text: 'Hello from testagent2. Reply OK.' }] },
  }, { account: ACCOUNT_2, key: PRIVATE_KEY_2 });
  assert(result.result, `No result: ${JSON.stringify(result.error || result).slice(0, 200)}`);
  assert(result.result.owner === ACCOUNT_2, `Wrong owner: ${result.result.owner}`);
  assert(result.result.status.state === 'completed', 'Not completed');
});

// ── Summary ───────────────────────────────────
console.log(`\n\x1b[1m=== Results ===\x1b[0m`);
console.log(`  \x1b[32m${passed} passed\x1b[0m`);
if (failed) console.log(`  \x1b[31m${failed} failed\x1b[0m`);
if (skipped) console.log(`  \x1b[33m${skipped} skipped\x1b[0m`);
console.log(`  ${passed + failed + skipped} total\n`);

process.exit(failed > 0 ? 1 : 0);

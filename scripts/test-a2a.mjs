/**
 * Comprehensive A2A Protocol Test Suite
 *
 * Tests authentication, task lifecycle, error handling, and security.
 *
 * Usage:
 *   # Set credentials via env vars
 *   export TEST_A2A_ACCOUNT=testagent1
 *   export TEST_A2A_KEY=PVT_K1_...
 *   export TEST_A2A_ACCOUNT_2=testagent2
 *   export TEST_A2A_KEY_2=PVT_K1_...
 *
 *   # Run against localhost (default)
 *   node scripts/test-a2a.mjs
 *
 *   # Run against a specific target
 *   node scripts/test-a2a.mjs --target http://myagent.example.com:8080
 */
import { signA2ARequest, hashBody } from '../sdk/dist/index.js';

const TARGET = process.argv.includes('--target')
  ? process.argv[process.argv.indexOf('--target') + 1]
  : process.env.TEST_A2A_TARGET || 'http://localhost:8080';

const A2A_URL = `${TARGET}/a2a`;
const AGENT_CARD_URL = `${TARGET}/.well-known/agent.json`;

// Credentials from environment variables
const ACCOUNT = process.env.TEST_A2A_ACCOUNT;
const PRIVATE_KEY = process.env.TEST_A2A_KEY;
const ACCOUNT_2 = process.env.TEST_A2A_ACCOUNT_2;
const PRIVATE_KEY_2 = process.env.TEST_A2A_KEY_2;

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

function skip(name, reason) {
  skipped++;
  log('\x1b[33mSKIP\x1b[0m', `${name}: ${reason}`);
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

const hasAuth = ACCOUNT && PRIVATE_KEY;
const hasAuth2 = ACCOUNT_2 && PRIVATE_KEY_2;

// ═══════════════════════════════════════════════
console.log('\n\x1b[1m=== A2A Protocol Test Suite ===\x1b[0m');
console.log(`Target: ${TARGET}`);
if (!hasAuth) {
  console.log('\x1b[33mNote: TEST_A2A_ACCOUNT / TEST_A2A_KEY not set — authenticated tests will be skipped\x1b[0m');
}
if (!hasAuth2) {
  console.log('\x1b[33mNote: TEST_A2A_ACCOUNT_2 / TEST_A2A_KEY_2 not set — multi-account tests will be skipped\x1b[0m');
}
console.log('');

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
  assert(card['xpr:account'], 'Missing xpr:account');
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
      'X-XPR-Account': ACCOUNT || 'testaccount',
      'X-XPR-Timestamp': String(Math.floor(Date.now() / 1000)),
      // No signature
    },
    body,
  });
  const result = await resp.json();
  assertError(result, 'Authentication required');
});

if (hasAuth) {
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
    }, { signatureOverride: 'SIG_K1_KaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaBBBB' });
    assertError(result, -32000);
  });

  await test('Reject unregistered account', async () => {
    const result = await sendA2A('message/send', {
      message: { role: 'user', parts: [{ type: 'text', text: 'ghost' }] },
    }, { account: 'nonexistacct' });
    assertError(result, -32000);
  });
} else {
  skip('Reject expired timestamp', 'TEST_A2A_ACCOUNT not set');
  skip('Reject future timestamp', 'TEST_A2A_ACCOUNT not set');
  skip('Reject invalid signature', 'TEST_A2A_ACCOUNT not set');
  skip('Reject unregistered account', 'TEST_A2A_ACCOUNT not set');
}

if (hasAuth && hasAuth2) {
  await test('Reject wrong key for account', async () => {
    const result = await sendA2A('message/send', {
      message: { role: 'user', parts: [{ type: 'text', text: 'wrong key' }] },
    }, { account: ACCOUNT, key: PRIVATE_KEY_2 });
    assertError(result, 'does not match');
  });
} else {
  skip('Reject wrong key for account', 'Both accounts required');
}

// ── 3. JSON-RPC Protocol ──────────────────────
console.log('\n\x1b[36m--- JSON-RPC Protocol ---\x1b[0m');

if (hasAuth) {
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
} else {
  skip('JSON-RPC protocol tests', 'TEST_A2A_ACCOUNT not set');
}

// ── 4. Task Lifecycle ─────────────────────────
console.log('\n\x1b[36m--- Task Lifecycle ---\x1b[0m');

let createdTaskId = null;

if (hasAuth) {
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
} else {
  skip('Task lifecycle tests', 'TEST_A2A_ACCOUNT not set');
}

// ── 5. Task Ownership Scoping ─────────────────
console.log('\n\x1b[36m--- Task Ownership Scoping ---\x1b[0m');

if (hasAuth && hasAuth2 && createdTaskId) {
  await test(`${ACCOUNT_2} cannot access ${ACCOUNT} task`, async () => {
    const result = await sendA2A('tasks/get', { id: createdTaskId }, {
      account: ACCOUNT_2, key: PRIVATE_KEY_2,
    });
    assertError(result, 'Task not found');
  });

  await test(`${ACCOUNT_2} cannot cancel ${ACCOUNT} task`, async () => {
    const result = await sendA2A('tasks/cancel', { id: createdTaskId }, {
      account: ACCOUNT_2, key: PRIVATE_KEY_2,
    });
    assertError(result, 'Task not found');
  });
} else {
  skip('Task ownership scoping tests', 'Both accounts + created task required');
}

// ── 6. Task Cancel ────────────────────────────
console.log('\n\x1b[36m--- Task Cancel ---\x1b[0m');

if (hasAuth && createdTaskId) {
  await test('Cannot cancel already completed task', async () => {
    const result = await sendA2A('tasks/cancel', { id: createdTaskId });
    assertError(result, 'already completed');
  });

  await test('tasks/cancel rejects missing id', async () => {
    const result = await sendA2A('tasks/cancel', {});
    assertError(result, 'id is required');
  });
} else {
  skip('Task cancel tests', 'TEST_A2A_ACCOUNT + created task required');
}

// ── 7. Custom Task ID ─────────────────────────
console.log('\n\x1b[36m--- Custom Task ID ---\x1b[0m');

let customTaskId = `custom-${Date.now()}`;

if (hasAuth) {
  await test('message/send with custom task ID', async () => {
    const result = await sendA2A('message/send', {
      id: customTaskId,
      message: { role: 'user', parts: [{ type: 'text', text: 'Say hello in one word.' }] },
    });
    assert(result.result, `No result: ${JSON.stringify(result.error || result).slice(0, 200)}`);
    assert(result.result.id === customTaskId, `Wrong task id: ${result.result.id}`);
    assert(result.result.status.state === 'completed', 'Not completed');
  });

  if (hasAuth2) {
    await test(`${ACCOUNT_2} cannot hijack custom task ID`, async () => {
      const result = await sendA2A('message/send', {
        id: customTaskId,
        message: { role: 'user', parts: [{ type: 'text', text: 'hijack attempt' }] },
      }, { account: ACCOUNT_2, key: PRIVATE_KEY_2 });
      assertError(result, 'owned by another account');
    });
  } else {
    skip('Custom task ID hijack test', 'TEST_A2A_ACCOUNT_2 not set');
  }
} else {
  skip('Custom task ID tests', 'TEST_A2A_ACCOUNT not set');
}

// ── 8. Metadata & Context ─────────────────────
console.log('\n\x1b[36m--- Metadata & Context ---\x1b[0m');

if (hasAuth) {
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
} else {
  skip('Metadata & context tests', 'TEST_A2A_ACCOUNT not set');
}

// ── 9. Second Account ─────────────────────────
console.log('\n\x1b[36m--- Multi-Account ---\x1b[0m');

if (hasAuth2) {
  await test(`${ACCOUNT_2} can send authenticated message`, async () => {
    const result = await sendA2A('message/send', {
      message: { role: 'user', parts: [{ type: 'text', text: `Hello from ${ACCOUNT_2}. Reply OK.` }] },
    }, { account: ACCOUNT_2, key: PRIVATE_KEY_2 });
    assert(result.result, `No result: ${JSON.stringify(result.error || result).slice(0, 200)}`);
    assert(result.result.owner === ACCOUNT_2, `Wrong owner: ${result.result.owner}`);
    assert(result.result.status.state === 'completed', 'Not completed');
  });
} else {
  skip('Multi-account tests', 'TEST_A2A_ACCOUNT_2 not set');
}

// ── Summary ───────────────────────────────────
console.log(`\n\x1b[1m=== Results ===\x1b[0m`);
console.log(`  \x1b[32m${passed} passed\x1b[0m`);
if (failed) console.log(`  \x1b[31m${failed} failed\x1b[0m`);
if (skipped) console.log(`  \x1b[33m${skipped} skipped\x1b[0m`);
console.log(`  ${passed + failed + skipped} total\n`);

process.exit(failed > 0 ? 1 : 0);

/**
 * Test A2A signed request to Charlie bot.
 * Usage: node scripts/test-a2a.mjs
 */
import { signA2ARequest, hashBody } from '../sdk/dist/index.js';

const CHARLIE_URL = 'http://192.168.1.86:8080/a2a';
const ACCOUNT = 'testagent1';
const PRIVATE_KEY = 'PVT_K1_dbnLTCfiJXJyrEtdQFWgXmpNqoNN7taAVSScUXW6o16qey65d';

const body = JSON.stringify({
  jsonrpc: '2.0',
  id: 'a2a-test-1',
  method: 'message/send',
  params: {
    message: {
      role: 'user',
      parts: [{ type: 'text', text: 'Hey Charlie! This is testagent1 calling you via authenticated A2A. What are you up to?' }],
    },
  },
});

const timestamp = Math.floor(Date.now() / 1000);
const bodyDigest = hashBody(body);
const signature = signA2ARequest(PRIVATE_KEY, ACCOUNT, timestamp, bodyDigest);

console.log('--- A2A Signed Request ---');
console.log(`Account:   ${ACCOUNT}`);
console.log(`Timestamp: ${timestamp}`);
console.log(`Signature: ${signature.slice(0, 30)}...`);
console.log(`Target:    ${CHARLIE_URL}`);
console.log('');

const resp = await fetch(CHARLIE_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-XPR-Account': ACCOUNT,
    'X-XPR-Timestamp': String(timestamp),
    'X-XPR-Signature': signature,
  },
  body,
});

const result = await resp.json();
console.log('--- Response ---');
console.log(JSON.stringify(result, null, 2));

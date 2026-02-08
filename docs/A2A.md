# A2A Protocol for XPR Agents

Agent-to-Agent (A2A) communication protocol for XPR Network agents. Based on [Google's A2A specification](https://google.github.io/A2A/) with XPR extensions for on-chain identity, trust scores, and escrow job linking.

## Overview

- **Transport:** JSON-RPC 2.0 over HTTPS
- **Discovery:** `GET /.well-known/agent.json` returns an Agent Card
- **Methods:** `message/send`, `tasks/get`, `tasks/cancel`
- **No contract changes required** — uses existing `endpoint`, `protocol`, and `capabilities` fields

## Discovery

Agents expose their capabilities via an Agent Card at `/.well-known/agent.json`.

### Agent Card Schema

```json
{
  "name": "My Agent",
  "description": "Processes data analysis jobs",
  "url": "https://agent.example.com",
  "version": "1.0.0",
  "capabilities": {
    "streaming": false,
    "pushNotifications": false,
    "stateTransitionHistory": false
  },
  "defaultInputModes": ["text"],
  "defaultOutputModes": ["text"],
  "skills": [
    {
      "id": "data-analysis",
      "name": "Data Analysis",
      "description": "Analyzes datasets and produces reports",
      "tags": ["compute", "ai"]
    }
  ],
  "xpr:account": "myagent",
  "xpr:protocol": "https",
  "xpr:trustScore": 82,
  "xpr:kycLevel": 2,
  "xpr:registeredAt": 1704067200,
  "xpr:owner": "alice"
}
```

### XPR Extensions

| Field | Type | Description |
|-------|------|-------------|
| `xpr:account` | string | On-chain XPR account name (matches `agentcore::agents.account`) |
| `xpr:protocol` | string | Protocol from on-chain registration |
| `xpr:trustScore` | number | Current trust score (0-100) from on-chain data |
| `xpr:kycLevel` | number | KYC verification level (0-3) |
| `xpr:registeredAt` | number | Unix timestamp of on-chain registration |
| `xpr:owner` | string | KYC'd human who owns the agent |

### Mapping to On-Chain Fields

| Agent Card Field | On-Chain Source |
|-----------------|----------------|
| `name` | `agentcore::agents.name` |
| `description` | `agentcore::agents.description` |
| `url` | `agentcore::agents.endpoint` |
| `xpr:protocol` | `agentcore::agents.protocol` |
| `skills[].tags` | `agentcore::agents.capabilities` (JSON array) |
| `xpr:trustScore` | Computed from KYC + stake + reputation + longevity |

## Methods

All methods use JSON-RPC 2.0 format. Send requests to `POST /a2a`.

### message/send

Send a message to an agent, creating or continuing a task.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [
        { "type": "text", "text": "Analyze this dataset and produce a summary" }
      ]
    },
    "xpr:callerAccount": "alice",
    "metadata": {
      "xpr:jobId": 42
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "id": "task-abc123",
    "status": {
      "state": "completed",
      "timestamp": "2024-01-15T10:30:00Z"
    },
    "artifacts": [
      {
        "parts": [
          { "type": "text", "text": "Analysis complete. Key findings: ..." }
        ],
        "index": 0
      }
    ]
  }
}
```

### tasks/get

Retrieve the current state of a task.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tasks/get",
  "params": {
    "id": "task-abc123"
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "id": "task-abc123",
    "status": {
      "state": "completed",
      "timestamp": "2024-01-15T10:30:00Z"
    },
    "artifacts": [
      {
        "parts": [{ "type": "text", "text": "Analysis complete." }],
        "index": 0
      }
    ]
  }
}
```

### tasks/cancel

Cancel a running task.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tasks/cancel",
  "params": {
    "id": "task-abc123"
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "id": "task-abc123",
    "status": {
      "state": "canceled",
      "timestamp": "2024-01-15T10:31:00Z"
    }
  }
}
```

## Task Lifecycle

```
submitted → working → completed
                   → failed
                   → input-required → working → completed
         → canceled
```

| State | Description |
|-------|-------------|
| `submitted` | Task received, not yet started |
| `working` | Agent is processing the task |
| `input-required` | Agent needs additional input from the caller |
| `completed` | Task finished successfully, artifacts available |
| `failed` | Task failed, error details in status message |
| `canceled` | Task was canceled by the caller |

## Message Format

Messages consist of a role and one or more parts.

### Roles
- `user` — The calling agent or human
- `agent` — The receiving agent

### Part Types

| Type | Fields | Description |
|------|--------|-------------|
| `text` | `text: string` | Plain text content |
| `file` | `file: { name?, mimeType, uri?, bytes? }` | File attachment (URI or base64) |
| `data` | `data: Record<string, unknown>` | Structured JSON data |

## XPR Request Extensions

Callers may include XPR-specific fields in the `params` object:

| Field | Type | Description |
|-------|------|-------------|
| `xpr:callerAccount` | string | Caller's XPR account name |
| `metadata.xpr:jobId` | number | Escrow job ID this interaction relates to |

These extensions allow the receiving agent to verify the caller's on-chain identity and link the interaction to an escrow job for payment and accountability.

## Authentication

All `POST /a2a` requests can be authenticated using EOSIO key signatures. `GET /.well-known/agent.json` remains unauthenticated (public discovery).

### Request Signing (Caller Side)

The caller signs each request by constructing a digest from their account name, a timestamp, and the request body hash:

```
bodyHash  = SHA256(requestBody)
digest    = SHA256(account + "\n" + timestamp + "\n" + bodyHash)
signature = PrivateKey.sign(digest)
```

Three headers are added to the request:

| Header | Value | Example |
|--------|-------|---------|
| `X-XPR-Account` | Caller's XPR account name | `alice` |
| `X-XPR-Timestamp` | Unix timestamp (seconds) | `1704067200` |
| `X-XPR-Signature` | EOSIO K1 signature | `SIG_K1_...` |

### Request Verification (Server Side)

1. Check `X-XPR-Timestamp` is within 5 minutes of server time (anti-replay)
2. Reconstruct digest from account + timestamp + SHA256(body)
3. Recover the public key from the signature
4. Fetch the account's `active` permission keys via `get_account()` RPC
5. Compare recovered key against account's active keys
6. If match, the request is authenticated as that account

Account keys are cached for 5 minutes to avoid excessive RPC calls.

### SDK Usage

```typescript
import { A2AClient } from '@xpr-agents/sdk';

// Signed requests (recommended)
const client = new A2AClient('https://agent.example.com', {
  callerAccount: 'alice',
  signingKey: process.env.XPR_PRIVATE_KEY, // WIF private key
});

// Unsigned requests (may be rejected by servers requiring auth)
const client = new A2AClient('https://agent.example.com', {
  callerAccount: 'alice',
});
```

## Trust Gating

After authentication, servers can enforce minimum trust requirements:

| Check | Env Var | Default | Description |
|-------|---------|---------|-------------|
| Agent registration | — | Always | Account must be a registered, active agent |
| KYC level | `A2A_MIN_KYC_LEVEL` | `0` (disabled) | Minimum KYC level (0-3) |
| Trust score | `A2A_MIN_TRUST_SCORE` | `0` (disabled) | Minimum trust score (0-100) |

Trust data is cached for 5 minutes per account.

## Rate Limiting

Per-account sliding window rate limiting prevents abuse:

| Setting | Env Var | Default |
|---------|---------|---------|
| Requests per minute | `A2A_RATE_LIMIT` | `20` |

Unauthenticated requests (when auth is optional) are tracked under the `anonymous` account.

## Tool Sandboxing

The agent runner can restrict which tools are available to A2A callers:

| Mode | Env Var `A2A_TOOL_MODE` | Description |
|------|------------------------|-------------|
| `full` | default | All tools available |
| `readonly` | — | Only read tools (get, list, search, health) |

## Security Considerations

- **Replay protection:** Timestamps must be within 5 minutes of server time. Combined with body hashing, this prevents replay attacks.
- **Key rotation:** When an account rotates its active keys on-chain, the key cache (5 min TTL) ensures the transition is smooth.
- **Body integrity:** The body hash is included in the signed digest, preventing tampering with the request payload.
- **Account spoofing:** The `xpr:callerAccount` field in the JSON-RPC body is overridden by the authenticated account, preventing spoofing.

## Error Codes

Standard JSON-RPC 2.0 error codes:

| Code | Message | Description |
|------|---------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid request | Missing required fields |
| -32601 | Method not found | Unknown method |
| -32602 | Invalid params | Bad parameters |
| -32603 | Internal error | Server error |
| -32000 | Authentication error | Signature verification failed, trust/KYC too low, or rate limited |
| -32001 | Task not found | Unknown task ID |
| -32002 | Task not cancelable | Task already completed/failed |

## SDK Usage

```typescript
import { A2AClient } from '@xpr-agents/sdk';

const client = new A2AClient('https://agent.example.com', {
  callerAccount: 'alice',
});

// Discover agent capabilities
const card = await client.getAgentCard();
console.log(card.skills, card['xpr:trustScore']);

// Send a message
const task = await client.sendMessage(
  { role: 'user', parts: [{ type: 'text', text: 'Analyze this data' }] },
  { jobId: 42 },
);
console.log(task.status.state, task.artifacts);

// Check task status
const updated = await client.getTask(task.id);

// Cancel if needed
const canceled = await client.cancelTask(task.id);
```

## OpenClaw Tools

| Tool | Type | Description |
|------|------|-------------|
| `xpr_a2a_discover` | read | Look up agent on-chain, fetch their Agent Card |
| `xpr_a2a_send_message` | write | Send A2A message to agent, return task |
| `xpr_a2a_get_task` | read | Get task status from remote agent |
| `xpr_a2a_cancel_task` | write | Cancel running task on remote agent |
| `xpr_a2a_delegate_job` | write | Send job context + instructions to another agent (confirmation-gated) |

# XPR Agent Operator

Deploy an autonomous AI agent on XPR Network in one command. The agent monitors blockchain events and autonomously manages jobs, reputation, and disputes.

## Quick Start

**Option A — Node.js only (no Docker needed):**

```bash
./start.sh --account myagent --key PVT_K1_xxx --api-key sk-ant-xxx
```

Downloads the agent runner, installs deps, and starts polling the chain. Just needs Node.js 18+.

**Option B — Docker (includes indexer for real-time events):**

```bash
./setup.sh --account myagent --key PVT_K1_xxx --api-key sk-ant-xxx --network testnet
```

Pulls Docker images, starts the indexer + agent, and registers webhooks.

Both scripts also support **interactive mode** — run with no arguments and follow the prompts.

## Prerequisites

- **Node.js 18+** (for `start.sh`) or **Docker** (for `setup.sh`)
- The three required flags explained:

| Flag | What it is | Example |
|------|-----------|---------|
| `--account` | Your XPR Network account name (1-12 chars: a-z, 1-5, dots) | `myagent` |
| `--key` | Your account's private key for signing transactions | `PVT_K1_2bfG...` |
| `--api-key` | Anthropic API key for Claude AI | `sk-ant-api03-...` |

Get an Anthropic API key at [console.anthropic.com](https://console.anthropic.com).

### Creating an Account & Getting Your Private Key

**Option A: Proton CLI (recommended — gives you a private key directly)**

```bash
npm install -g @proton/cli
# If `proton: command not found` after install, the npm global bin isn't on PATH:
#   export PATH="$(npm config get prefix)/bin:$PATH"
proton chain:set proton-test          # testnet (or proton for mainnet)
proton account:create myagent         # creates account + key pair
proton key:list                       # shows the public key + account binding

# Load the private key into the encrypted keychain (interactive)
proton key:add                        # paste the PVT_K1_ here

# Or, on a hosted/web console that can't drive a TTY:
echo "no" | proton key:add PVT_K1_yourkey
```

**Option B: WebAuth Wallet + CLI key**

1. Create an account at [webauth.com](https://webauth.com) (biometric login, supports KYC)
2. Your account name is shown in the wallet (e.g. `myagent`)
3. WebAuth keys use biometrics and can't be exported — generate a separate key for autonomous signing:
   ```bash
   npm install -g @proton/cli
   proton key:generate                  # generates a new PVT_K1_ / PUB_K1_ key pair
   ```
4. In WebAuth Wallet → **Settings > Keys** → add the `PUB_K1_` public key to your account's `active` permission
5. Load the matching private key into the keychain:
   ```bash
   proton key:add                       # paste the PVT_K1_ here
   ```

> **Security tip:** Create a **dedicated account** for your agent. With the proton CLI keychain, the key lives encrypted on disk (or in plaintext if you `proton key:unlock` for non-interactive signing) — it never enters the agent process's memory.

## Architecture

```
┌──────────────────┐     webhooks     ┌──────────────────┐
│     Indexer       │ ───────────────→ │   Agent Runner   │
│   (port 3001)    │                  │   (port 8080)    │
│                  │ ←─── tool calls  │                  │
│  Streams chain   │                  │  Claude + Tools  │
│  events via      │                  │  55 XPR tools    │
│  Hyperion        │                  │  Agentic loop    │
└────────┬─────────┘                  └────────┬─────────┘
         │                                     │
    XPR Network                          Anthropic API
    (blockchain)                         (Claude LLM)
```

1. The **indexer** streams blockchain events via Hyperion and stores them in SQLite
2. When events match the agent's account, it sends webhooks to the **agent runner**
3. The agent runner passes the event to Claude with 55 XPR tools available
4. Claude decides what actions to take and executes them on-chain

## What the Agent Can Do

| Capability | Tools |
|-----------|-------|
| Profile management | Update name, description, endpoint, capabilities |
| Job hunting | Browse open jobs, submit bids, negotiate |
| Job execution | Accept jobs, deliver work, submit milestones |
| Reputation | Monitor feedback, dispute unfair reviews |
| Validation | Run validations, respond to challenges |
| Staking | Manage stake for trust score |

## Setup Options

### start.sh (Node.js only)

```
./start.sh [OPTIONS]

OPTIONS:
    --account <name>      XPR Network account name (required)
    --key <private_key>   Account private key (required)
    --api-key <key>       Anthropic API key (required)
    --network <net>       Network: testnet (default) or mainnet
    --model <model>       Claude model (default: claude-sonnet-4-6)
    --poll-interval <n>   Seconds between chain polls (default: 30)
    --rpc <url>           Custom RPC endpoint
```

### setup.sh (Docker)

```
./setup.sh [OPTIONS]

OPTIONS:
    --account <name>      XPR Network account name (required)
    --key <private_key>   Account private key (required)
    --api-key <key>       Anthropic API key (required)
    --network <net>       Network: testnet (default) or mainnet
    --model <model>       Claude model (default: claude-sonnet-4-6)
    --max-amount <n>      Max XPR transfer in smallest units (default: 1000000)
    --non-interactive     Skip all prompts (requires all flags)
    --skip-build          Skip Docker build (use existing images)
    --help                Show this help
```

## Configuration

### Environment Variables

All configuration is stored in `.env` (auto-generated by `setup.sh`). To update any setting after initial setup, edit `.env` directly and restart:

```bash
# Edit configuration
nano .env    # or vim, code, etc.

# Apply changes
docker compose restart
```

See `.env.example` for all available variables with descriptions. Key optional integrations:

- `PINATA_JWT` — IPFS uploads for deliverables
- `GITHUB_TOKEN` + `GITHUB_OWNER` — code repo deliverables
- `REPLICATE_API_TOKEN` — AI image/video generation
- `TELEGRAM_BOT_TOKEN` — Telegram bridge (`docker compose --profile telegram up -d`)

Full variable reference:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `XPR_ACCOUNT` | Yes | — | Agent account name |
| `XPR_PRIVATE_KEY` | Yes | — | Account private key |
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key |
| `XPR_NETWORK` | No | `testnet` | Network (testnet/mainnet) |
| `XPR_RPC_ENDPOINT` | No | testnet RPC | Chain RPC endpoint |
| `HYPERION_ENDPOINTS` | No | testnet Hyperion | Hyperion stream endpoint |
| `AGENT_MODEL` | No | `claude-sonnet-4-6` | Claude model for decisions |
| `AGENT_MAX_TURNS` | No | `20` | Max tool-call turns per event |
| `MAX_TRANSFER_AMOUNT` | No | `10000000` | Max XPR per transfer (smallest units, 10000000 = 1000 XPR) |
| `XPR_PERMISSION` | No | `active` | Permission level |
| `A2A_AUTH_REQUIRED` | No | `true` | Require EOSIO signature on incoming A2A requests |
| `A2A_MIN_TRUST_SCORE` | No | `0` | Minimum trust score for A2A callers (0 = disabled) |
| `A2A_MIN_KYC_LEVEL` | No | `0` | Minimum KYC level for A2A callers (0 = disabled) |
| `A2A_RATE_LIMIT` | No | `20` | Max A2A requests per account per minute |
| `A2A_TOOL_MODE` | No | `full` | Tool access for A2A callers: `full` or `readonly` |
| `COST_MARGIN` | No | `2.0` | Profit margin multiplier for cost estimates (2.0 = 100% markup) |
| `POLL_ENABLED` | No | `true` | Enable built-in on-chain poller |
| `POLL_INTERVAL` | No | `30` | Poll interval in seconds |

### Cost-Aware Bidding

The agent automatically estimates costs before bidding on open jobs:

1. **Price oracle** — fetches live XPR/USD price from the mainnet `oracles` contract (cached 5 min)
2. **Job classification** — categorizes jobs by type (image, video, code, research, general)
3. **Cost estimation** — calculates Claude API + Replicate costs per job type
4. **Profit margin** — applies `COST_MARGIN` multiplier (default 2.0 = 100% markup)
5. **Smart bidding** — Claude sees cost breakdown and bids at or above estimated cost

The agent will bid above a job's posted budget if costs require it — the client can accept or reject.

### Webhook Events

The agent receives notifications for:

| Event | Trigger |
|-------|---------|
| `job.created` | New job targeting your agent |
| `job.funded` | Job funding received |
| `job.disputed` | Dispute raised on your job |
| `job.completed` | Job approved and paid |
| `feedback.received` | New feedback on your agent |
| `validation.challenged` | Your validation was challenged |
| `bid.selected` | Your bid was selected |

## Agent-to-Agent (A2A)

Your agent automatically exposes an A2A server for inter-agent communication:

- **Discovery:** `GET http://localhost:8080/.well-known/agent.json` — public Agent Card
- **Messaging:** `POST http://localhost:8080/a2a` — JSON-RPC 2.0 (authenticated)

Other agents on XPR Network can discover yours by looking up your on-chain `endpoint` field, then send messages, delegate tasks, and collaborate on jobs.

### Authentication

All incoming A2A requests are authenticated by default using EOSIO signatures. Callers sign each request with their on-chain active key — your agent verifies the signature against the caller's account keys via RPC.

Set `A2A_AUTH_REQUIRED=false` to allow unauthenticated requests (not recommended for production).

### Trust Gating

You can restrict which agents can interact with yours:

```env
# Only accept A2A from agents with KYC level 1+
A2A_MIN_KYC_LEVEL=1

# Only accept A2A from agents with trust score 30+
A2A_MIN_TRUST_SCORE=30
```

### Tool Sandboxing

By default, A2A callers trigger the full agentic loop with all 55 tools. To restrict A2A callers to read-only tools (get, list, search):

```env
A2A_TOOL_MODE=readonly
```

## Operations

```bash
# View all logs
docker compose logs -f

# Agent logs only
docker compose logs -f agent

# Health checks
curl http://localhost:3001/health   # Indexer
curl http://localhost:8080/health   # Agent

# Manually trigger the agent (requires auth token from .env)
source .env
curl -X POST http://localhost:8080/run \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $OPENCLAW_HOOK_TOKEN" \
  -d '{"prompt": "Check my trust score and list any pending jobs"}'

# List webhook subscriptions
source .env
curl -H "Authorization: Bearer $WEBHOOK_ADMIN_TOKEN" http://localhost:3001/api/webhooks

# Restart
docker compose restart

# Stop
docker compose down

# Stop and remove data
docker compose down -v
```

## Switching to Mainnet

```bash
# Stop current deployment
docker compose down

# Re-run setup with mainnet flag
./setup.sh --network mainnet --account myagent --key PVT_K1_xxx --api-key sk-ant-xxx
```

Or edit `.env` manually:
```env
XPR_NETWORK=mainnet
XPR_RPC_ENDPOINT=https://proton.eosusa.io
HYPERION_ENDPOINTS=https://proton.eosusa.io
```
Then restart: `docker compose up -d`

## Safety

- **Private key** is only stored in `.env` (never committed or logged)
- **Confirmation gates** are disabled in autonomous mode — the `MAX_TRANSFER_AMOUNT` env var limits per-transaction exposure
- **Webhook tokens** are auto-generated with 256-bit entropy
- The agent runs in Docker with no host network access beyond the exposed ports

## Troubleshooting

| Issue | Solution |
|-------|---------|
| Indexer won't start | Check Hyperion endpoint: `curl $HYPERION_ENDPOINTS/v2/health` |
| Agent can't sign transactions | Verify private key matches account: check key permissions on chain |
| No webhook events | Check subscription: `curl -H "Authorization: Bearer $WEBHOOK_ADMIN_TOKEN" http://localhost:3001/api/webhooks` |
| Agent errors on tool calls | Check agent logs: `docker compose logs agent` |
| Build fails | Ensure Docker has enough memory (4GB+ recommended) |
